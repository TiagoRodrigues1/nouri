import { OpenAPIHono } from "@hono/zod-openapi";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import { z } from "zod";
import type { AppDatabase } from "../db/database.js";
import { error, errorSchema } from "../http-error.js";
import { authorizationSchema, connectionStatusSchema, disconnectResultSchema, syncResultSchema, syncStateSchema, wearableProviderSchema } from "./contract.js";
import type { WearableProvider } from "./contract.js";
import { connectionFor, stateLifetimeMs, stateOwner, unconfiguredStatus, type Connection } from "./connections.js";
import { oauthCallbackPath, type CloudProvider } from "./provider.js";
import { syncState, type Wearables } from "./sync-queue.js";

const integrationPath = "/v1/integrations/:provider";

const notConfigured = "This service is not set up on this server. Add its settings to .env and restart Nouri.";

type Env = { Variables: { userId: string } };

// Secure follows the redirect URI, since a proxy terminating HTTPS hands the app a plain http request.
function stateCookie(id: WearableProvider, secure: boolean) {
  return { name: `nouri_${id}_state`, options: { path: oauthCallbackPath(id), httpOnly: true, sameSite: "Lax" as const, secure } };
}

export function integrationRoutes(db: AppDatabase, wearables: Wearables | undefined) {
  const app = new OpenAPIHono<Env>();
  const { runtime, queue } = wearables ?? {};
  const providers = new Map<WearableProvider, CloudProvider>(runtime?.providers.map((provider) => [provider.id, provider]));

  const connection = (id: WearableProvider, userId: string) => {
    const provider = providers.get(id);

    return runtime && provider ? connectionFor(db, runtime, provider, userId) : undefined;
  };

  const cookieFor = (id: WearableProvider) => stateCookie(id, providers.get(id)?.callbackOrigin.startsWith("https:") ?? false);

  const providerParam = (context: Context) => wearableProviderSchema.safeParse(context.req.param("provider")).data;

  // Behind the /v1 sign-in check, so each request acts for the person it authenticated.
  const withProvider = (run: (id: WearableProvider, connection: Connection | undefined, context: Context<Env>) => Promise<Response>) =>
    async (context: Context<Env>) => {
      const id = providerParam(context);

      if (!id) return error(404, "Unknown integration");

      return run(id, connection(id, context.get("userId")), context);
    };

  const withConfigured = (run: (connection: Connection, context: Context<Env>) => Promise<Response>) =>
    withProvider(async (_id, connection, context) => connection ? run(connection, context) : error(409, notConfigured));

  app.get(integrationPath, withProvider(async (id, connection, context) => context.json(connection ? await connection.status() : await unconfiguredStatus(db, context.get("userId"), id))));

  app.post(`${integrationPath}/authorizations`, withConfigured(async (connection, context) => {
    const { callbackOrigin } = connection.provider;

    // The callback lands on the redirect URI's origin, so a sign-in started on another address (localhost vs 127.0.0.1) arrives without its cookie.
    const origin = context.req.header("Origin");

    if (origin && origin !== callbackOrigin) return error(409, `Open Nouri at ${callbackOrigin} and choose Connect there. Sign-in returns to that address, so it cannot finish from ${origin}.`);

    const { url, state } = await connection.start();
    const cookie = cookieFor(connection.provider.id);
    setCookie(context, cookie.name, state, { ...cookie.options, maxAge: stateLifetimeMs / 1000 });

    return context.json({ authorizationUrl: url });
  }));

  // The browser lands here without a session token, so the stored state names the person who started the sign-in.
  // Even an unconfigured provider redirects back to the page instead of answering with JSON.
  app.get(oauthCallbackPath(":provider"), async (context) => {
    const id = providerParam(context);

    if (!id) return error(404, "Unknown integration");
    const cookie = cookieFor(id);
    const query = (name: string) => context.req.query(name) || undefined;
    const state = query("state");
    const owner = state ? await stateOwner(db, id, state) : null;
    const connected = owner ? connection(id, owner) : undefined;

    const result = connected
      ? await connected.complete({ state, cookie: getCookie(context, cookie.name), code: query("code"), error: query("error") })
      : providers.has(id) ? "expired-link" : "token-failed";

    deleteCookie(context, cookie.name, cookie.options);
    context.header("Cache-Control", "no-store");
    context.header("Referrer-Policy", "no-referrer");

    return context.redirect(`/overview?connect=${id}&result=${result}`, 303);
  });

  app.post(`${integrationPath}/syncs`, withConfigured(async (connection, context) => {
    const synced = await connection.manualSync();

    switch (synced.outcome) {
      case "synced": return context.json(synced.result);
      case "not-connected": return error(409, "Not connected. Choose Connect first.");
      case "busy": {
        const seconds = Math.ceil(synced.retryAfterMs / 1000);
        const response = error(429, synced.reason === "running" ? "A sync is already running. New data appears when it finishes." : `Synced moments ago. Try again in ${seconds} seconds.`);

        response.headers.set("Retry-After", String(seconds));

        return response;
      }

      case "failed": return error(synced.reason === "reauthorize" ? 409 : 502, synced.message);
    }
  }));

  app.delete(integrationPath, withConfigured(async (connection, context) => context.json(await connection.disconnect())));

  // The page calls this when it opens and while it stays open. It answers at once; any import runs in the background.
  // A provider this server has no settings for has nothing to refresh, so it reports what is stored.
  app.post(`${integrationPath}/refreshes`, withProvider(async (id, connection, context) => {
    const userId = context.get("userId");

    return context.json(connection && queue ? await queue.refreshIfStale(connection.provider, userId) : await syncState(db, id, userId));
  }));

  // The provider's change notifications. Outside /v1: the provider authenticates with the secret it was registered with.
  // Notifications only say what to re-read, never what to store, so a forged one costs at most a sync.
  // The app-wide body limit (256 KB) already covers Google's largest batch of 99 notifications.
  app.post("/webhooks/:provider", async (context) => {
    const id = providerParam(context);
    const provider = id && providers.get(id);
    const webhook = provider?.webhook;

    if (!queue || !provider || !webhook) return error(404, "Unknown webhook");

    // The provider checks that a request without the secret is refused before it sends any notification.
    if (!webhook.authorized(context.req.header("Authorization"))) return error(401, "Unauthorized");
    const notices = await webhook.read(context.req.raw);

    if (notices === "verification") return context.body(null, 200);

    // A failure answers 500 and the provider sends the notification again later.
    await queue.queueChanges(provider, notices);

    return context.body(null, 204);
  });

  const providerParams = z.object({ provider: wearableProviderSchema });
  const documentedPath = "/v1/integrations/{provider}";
  app.openAPIRegistry.registerPath({ method: "get", path: documentedPath, request: { params: providerParams }, responses: { 200: { description: "Connection state, last successful sync, and last error. Never includes tokens.", content: { "application/json": { schema: connectionStatusSchema } } } } });
  app.openAPIRegistry.registerPath({ method: "post", path: `${documentedPath}/authorizations`, request: { params: providerParams }, responses: { 200: { description: "Provider sign-in URL for read access to sleep and workouts. Sets an HttpOnly state cookie the callback checks.", content: { "application/json": { schema: authorizationSchema } } }, 409: { description: "The provider is not configured on this server", content: { "application/json": { schema: errorSchema } } } } });
  app.openAPIRegistry.registerPath({ method: "post", path: `${documentedPath}/syncs`, request: { params: providerParams }, responses: { 200: { description: "Imported, updated, and removed sleep sessions and workouts from the sync window, per kind", content: { "application/json": { schema: syncResultSchema } } }, 409: { description: "Not connected, or access expired and needs Connect again", content: { "application/json": { schema: errorSchema } } }, 429: { description: "A sync of this connection is running, or one finished less than a minute ago. Retry-After says when to try again.", content: { "application/json": { schema: errorSchema } } }, 502: { description: "The provider was unreachable or refused the request", content: { "application/json": { schema: errorSchema } } } } });
  app.openAPIRegistry.registerPath({ method: "post", path: `${documentedPath}/refreshes`, request: { params: providerParams }, responses: { 200: { description: "Queues a background import when the stored imports are stale and none is waiting, and reports whether one is pending. Returns at once.", content: { "application/json": { schema: syncStateSchema } } } } });
  app.openAPIRegistry.registerPath({ method: "delete", path: documentedPath, request: { params: providerParams }, responses: { 200: { description: "Revoked the grant, forgot the tokens, and removed imported sleep and workouts", content: { "application/json": { schema: disconnectResultSchema } } } } });

  return app;
}
