import { randomUUID } from "node:crypto";
import { createClerkClient, verifyToken } from "@clerk/backend";
import { verifyWebhook } from "@clerk/backend/webhooks";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { erasedUsers, users } from "../db/schema.js";
import type { AppDatabase } from "../db/database.js";
import { signingKeys } from "./signing-keys.js";

// Who sent a request, as Clerk names them, or null when the request proves nobody.
export type Authenticate = (request: Request) => Promise<string | null>;

// A webhook Clerk sent: the Clerk user it deleted, null for any other event, or "forged" when the signature fails.
export type ReadWebhook = (request: Request) => Promise<{ deletedUser: string | null } | "forged">;

// An assistant's request: the Clerk user who let it in, the OAuth client Clerk registered it as, and whether its
// grant can be ended from Nouri. Clerk revokes only opaque access tokens; JWT access tokens live until they expire.
export type Agent = { clerkUserId: string; clientId: string; revocable: boolean };

// Clerk acts as the OAuth server for MCP clients such as Claude or ChatGPT.
export type Agents = {
  // Checks an OAuth access token Clerk issued to an MCP client on the person's consent.
  authenticateAgent: (request: Request) => Promise<Agent | null>;
  // The name the client registered with, such as "Claude"; null when Clerk has none or cannot be reached.
  agentName: (clientId: string) => Promise<string | null>;
  // Ends the grant a token belongs to, its refresh token included, so the client must ask the person again.
  revokeAgent: (clientId: string, token: string) => Promise<void>;
};

export type Identity = Agents & {
  authenticate: Authenticate;
  readWebhook: ReadWebhook;
  // Public; the page hands it to Clerk's browser SDK.
  publishableKey: string;
};

const sessionClaims = z.object({ sub: z.string().min(1) });

const tokenHeader = z.object({ alg: z.literal("RS256"), kid: z.string().min(1).max(128) });

// The resolver always supplies a local verification key; token ids never trigger Clerk SDK fetches.
export function clerkAuthenticator(options: { keyFor: (kid: string) => string | undefined | Promise<string | undefined>; authorizedParties: string[] }): Authenticate {
  return async (request) => {
    const header = request.headers.get("Authorization");

    if (!header?.startsWith("Bearer ") || header.length > 16_384) return null;
    const token = header.slice(7);
    const parts = token.split(".");

    if (parts.length !== 3) return null;

    const parsed = tokenHeader.safeParse(
      (() => { try { return JSON.parse(Buffer.from(parts[0] ?? "", "base64url").toString()); } catch { return null; } })(),
    );

    if (!parsed.success) return null;
    const jwtKey = await options.keyFor(parsed.data.kid);

    if (!jwtKey) return null;
    // The exported verifyToken resolves to the claims and throws on any failure, whatever its declared { data, errors } type says.
    const claims: unknown = await verifyToken(token, { jwtKey, authorizedParties: options.authorizedParties }).catch(() => null);

    return sessionClaims.safeParse(claims).data?.sub ?? null;
  };
}

const agentAuth = z.object({ userId: z.string().min(1), clientId: z.string().min(1).max(200) });

// Clerk's access tokens are opaque, so each check asks Clerk's API. Clerk names clients by their own id elsewhere,
// so the client id is looked up among the instance's OAuth applications.
export function clerkAgents(options: { secretKey: string; publishableKey: string }): Agents {
  const clerk = createClerkClient(options);

  async function application(clientId: string) {
    const { data } = await clerk.oauthApplications.list({ nameQuery: clientId, limit: 10 });

    return data.find((candidate) => candidate.clientId === clientId) ?? null;
  }

  return {
    authenticateAgent: async (request) => {
      const header = request.headers.get("Authorization");

      if (!header?.startsWith("Bearer ") || header.length > 16_384) return null;
      const state = await clerk.authenticateRequest(request, { acceptsToken: "oauth_token" }).catch(() => null);
      const auth = state?.isAuthenticated ? agentAuth.safeParse(state.toAuth()).data : undefined;

      // A JWT has three dot-separated parts; Clerk's opaque tokens have none.
      return auth ? { clerkUserId: auth.userId, clientId: auth.clientId, revocable: header.split(".").length !== 3 } : null;
    },
    agentName: async (clientId) => (await application(clientId).catch(() => null))?.name ?? null,
    revokeAgent: async (clientId, token) => {
      const found = await application(clientId);

      // A deleted application's grants went with it.
      if (found) await clerk.oauthApplications.revokeToken({ oauthApplicationId: found.id, token });
    },
  };
}

const deletion = z.object({ type: z.literal("user.deleted"), data: z.object({ id: z.string().min(1) }) });

// Clerk signs webhooks with Standard Webhooks headers and the endpoint's signing secret.
export function clerkWebhookReader(signingSecret: string): ReadWebhook {
  return async (request) => {
    const event: unknown = await verifyWebhook(request, { signingSecret }).catch(() => null);

    if (!event) return "forged";

    return { deletedUser: deletion.safeParse(event).data?.data.id ?? null };
  };
}

// The publishable key encodes the instance's Frontend API host, which serves Clerk's browser scripts and answers its requests.
export function clerkFrontendOrigin(publishableKey: string): string {
  const host = Buffer.from(publishableKey.replace(/^pk_(test|live)_/, ""), "base64").toString("utf8").replace(/\$$/, "");

  return `https://${host}`;
}

const clerkSettings = z.object({
  CLERK_SECRET_KEY: z.string().startsWith("sk_"),
  CLERK_PUBLISHABLE_KEY: z.string().regex(/^pk_(test|live)_[A-Za-z0-9+/=]+$/),
  // Origins the web app is served from. Session tokens minted for any other site are refused.
  // Signs the webhook that tells Nouri a Clerk user was deleted, so their records are erased. See docs/account-data-design.md.
  CLERK_WEBHOOK_SIGNING_SECRET: z.string().startsWith("whsec_").optional(),
  CLERK_JWT_KEY: z.string().min(1).optional(),
  CLERK_AUTHORIZED_PARTIES: z.string().transform((value) => value.split(",").map((origin) => origin.trim()).filter(Boolean)).pipe(z.array(z.url()).min(1)),
});

export function identityFromEnv(env: Record<string, string | undefined>): Identity {
  const settings = clerkSettings.parse(env);
  const signingSecret = settings.CLERK_WEBHOOK_SIGNING_SECRET;

  // Without it a deleted Clerk user's records would stay, so a deployed server refuses to start. Locally every
  // webhook is refused instead; Clerk keeps retrying, and the events succeed once the secret is set.
  if (!signingSecret && env.NODE_ENV === "production") throw new Error("CLERK_WEBHOOK_SIGNING_SECRET is required in production");

  return {
    authenticate: clerkAuthenticator({ keyFor: settings.CLERK_JWT_KEY ? () => settings.CLERK_JWT_KEY : signingKeys(`${clerkFrontendOrigin(settings.CLERK_PUBLISHABLE_KEY)}/.well-known/jwks.json`), authorizedParties: settings.CLERK_AUTHORIZED_PARTIES }),
    ...clerkAgents({ secretKey: settings.CLERK_SECRET_KEY, publishableKey: settings.CLERK_PUBLISHABLE_KEY }),
    readWebhook: signingSecret ? clerkWebhookReader(signingSecret) : async () => "forged",
    publishableKey: settings.CLERK_PUBLISHABLE_KEY,
  };
}

// The user id for a Clerk user, created on their first signed-in request. Null for a Clerk user whose account
// was erased, whose last session tokens are still valid for a minute.
export async function userFor(db: AppDatabase, clerkUserId: string): Promise<string | null> {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.clerkUserId, clerkUserId));

  if (existing) return existing.id;

  // Two first requests can race; the unique column keeps one row and both read it back.
  await db.execute(sql`INSERT INTO users (id, clerk_user_id) SELECT ${randomUUID()}, ${clerkUserId}
    WHERE NOT EXISTS (SELECT 1 FROM ${erasedUsers} WHERE ${erasedUsers.clerkUserId} = ${clerkUserId})
    ON CONFLICT (clerk_user_id) DO NOTHING`);
  const [created] = await db.select({ id: users.id }).from(users).where(eq(users.clerkUserId, clerkUserId));

  return created?.id ?? null;
}
