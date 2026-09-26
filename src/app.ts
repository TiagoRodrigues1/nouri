import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { daySchema, entrySchema, searchResultSchema, submissionSchema } from "./food/contract.js";
import { searchFoods } from "./food/catalog.js";
import { getFoodDay, mutateFood } from "./food/food.js";
import type { FoodDatabase, FoodMutationResult } from "./food/food.js";

function response(result: FoodMutationResult): Response {
  switch (result.outcome) {
    case "created":
    case "updated":
      return new Response(JSON.stringify(result.entry), {
        status: result.outcome === "created" ? 201 : 200,
        headers: { "Content-Type": "application/json" },
      });
    case "deleted":
      return new Response(null, { status: 204 });
    case "missing":
      return error(404, "Food entry not found");
    case "catalog-missing":
      return error(404, "Catalog food not found");
    case "stale":
      return error(409, "Revision conflict");
    case "key-reuse":
      return error(409, "Idempotency key reused for another request");
  }
}

function error(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

function sameToken(actual: string | undefined, expected: string): boolean {
  if (!actual?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(actual.slice(7));
  const configured = Buffer.from(expected);

  return supplied.length === configured.length && timingSafeEqual(supplied, configured);
}

export function createApp(db: FoodDatabase, auth: { token: string; userId: string }) {
  const app = new OpenAPIHono<{ Variables: { userId: string } }>();

  const pageHeaders = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'",
  };

  // The page carries the configured token so the browser connects without asking for it.
  const tokenMeta = `<meta name="nouri-api-token" content="${escapeHtml(auth.token)}" />`;

  for (const path of ["/", "/food"]) {
    app.get(path, async () => new Response((await readFile(new URL("../web/dist/index.html", import.meta.url), "utf8")).replace("</head>", `${tokenMeta}</head>`), {
      headers: { ...pageHeaders, "Content-Type": "text/html; charset=utf-8" },
    }));
  }

  app.get("/favicon.svg", async () => new Response(await readFile(new URL("../web/dist/favicon.svg", import.meta.url)), {
    headers: { ...pageHeaders, "Content-Type": "image/svg+xml" },
  }));

  app.get("/assets/:file", async (context) => {
    const file = context.req.param("file");

    if (!/^[a-zA-Z0-9_-]+\.(js|css)$/.test(file)) return error(404, "Asset not found");
    const body = await readFile(new URL(`../web/dist/assets/${file}`, import.meta.url)).catch(() => null);

    if (!body) return error(404, "Asset not found");

    return new Response(body, { headers: { ...pageHeaders, "Content-Type": file.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8" } });
  });

  app.use("/v1/*", async (context, next) => {
    if (!sameToken(context.req.header("Authorization"), auth.token)) return error(401, "Unauthorized");
    context.set("userId", auth.userId);
    await next();
  });

  app.post("/v1/food-entries", async (context) => {
    const key = context.req.header("Idempotency-Key");

    if (!key || key.length > 200) return error(400, "Idempotency-Key required");

    const input = submissionSchema.safeParse(await context.req.json().catch(() => null));

    if (!input.success) return error(400, "Invalid food entry");

    return response(await mutateFood(db, context.get("userId"), key, { kind: "create", input: input.data }));
  });

  app.get("/v1/foods/search", (context) => {
    const query = z.string().trim().min(2).max(80).safeParse(context.req.query("q"));
    const locale = z.string().min(2).max(35).regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/).safeParse(context.req.query("locale") ?? "pt-PT");

    if (!query.success || !locale.success) return error(400, "Invalid food search");

    return context.json(searchFoods(query.data, locale.data));
  });

  app.patch("/v1/food-entries/:id", async (context) => {
    const key = context.req.header("Idempotency-Key");

    if (!key || key.length > 200) return error(400, "Idempotency-Key required");
    const id = z.uuid().safeParse(context.req.param("id"));
    const revision = revisionHeader(context.req.header("If-Match"));
    const input = submissionSchema.safeParse(await context.req.json().catch(() => null));

    if (!id.success || revision === null || !input.success) return error(400, "Invalid food edit");

    return response(await mutateFood(db, context.get("userId"), key, { kind: "edit", id: id.data, revision, input: input.data }));
  });

  app.delete("/v1/food-entries/:id", async (context) => {
    const key = context.req.header("Idempotency-Key");

    if (!key || key.length > 200) return error(400, "Idempotency-Key required");
    const id = z.uuid().safeParse(context.req.param("id"));
    const revision = revisionHeader(context.req.header("If-Match"));

    if (!id.success || revision === null) return error(400, "Invalid food deletion");

    return response(await mutateFood(db, context.get("userId"), key, { kind: "delete", id: id.data, revision }));
  });

  app.get("/v1/days/:date", async (context) => {
    const date = z.iso.date().safeParse(context.req.param("date"));

    if (!date.success) return error(400, "Invalid day request");

    const day = await getFoodDay(db, context.get("userId"), date.data);

    return new Response(JSON.stringify(day), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  const errorSchema = z.object({ error: z.string() });
  const keyParameter = z.string().min(1).max(200);
  const mutationHeaders = z.object({ "Idempotency-Key": keyParameter });
  const editHeaders = z.object({ "Idempotency-Key": keyParameter, "If-Match": z.string() });
  app.openAPIRegistry.registerPath({ method: "post", path: "/v1/food-entries", request: { headers: mutationHeaders, body: { content: { "application/json": { schema: submissionSchema } } } }, responses: { 201: { description: "Created food entry", content: { "application/json": { schema: entrySchema } } }, 400: { description: "Invalid request", content: { "application/json": { schema: errorSchema } } }, 404: { description: "Catalog food not found", content: { "application/json": { schema: errorSchema } } }, 409: { description: "Idempotency conflict", content: { "application/json": { schema: errorSchema } } } } });
  app.openAPIRegistry.registerPath({ method: "get", path: "/v1/foods/search", request: { query: z.object({ q: z.string().min(2).max(80), locale: z.string().optional() }) }, responses: { 200: { description: "Ciqual food matches and attribution", content: { "application/json": { schema: searchResultSchema } } }, 400: { description: "Invalid query", content: { "application/json": { schema: errorSchema } } } } });
  app.openAPIRegistry.registerPath({ method: "patch", path: "/v1/food-entries/{id}", request: { params: z.object({ id: z.uuid() }), headers: editHeaders, body: { content: { "application/json": { schema: submissionSchema } } } }, responses: { 200: { description: "Updated food entry", content: { "application/json": { schema: entrySchema } } }, 404: { description: "Entry or catalog food not found", content: { "application/json": { schema: errorSchema } } }, 409: { description: "Revision or idempotency conflict", content: { "application/json": { schema: errorSchema } } } } });
  app.openAPIRegistry.registerPath({ method: "delete", path: "/v1/food-entries/{id}", request: { params: z.object({ id: z.uuid() }), headers: editHeaders }, responses: { 204: { description: "Deleted food entry" }, 404: { description: "Entry not found", content: { "application/json": { schema: errorSchema } } }, 409: { description: "Revision or idempotency conflict", content: { "application/json": { schema: errorSchema } } } } });
  app.openAPIRegistry.registerPath({ method: "get", path: "/v1/days/{date}", request: { params: z.object({ date: z.iso.date() }) }, responses: { 200: { description: "Food entries and totals for the recorded local day", content: { "application/json": { schema: daySchema } } } } });
  app.doc31("/openapi.json", { openapi: "3.1.0", info: { title: "Nouri API", version: "1.0.0" } });

  return app;
}

function revisionHeader(value: string | undefined): number | null {
  if (!value || !/^"[1-9][0-9]*"$/.test(value)) return null;
  const number = Number(value.slice(1, -1));

  return Number.isSafeInteger(number) ? number : null;
}
