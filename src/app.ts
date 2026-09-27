import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { OpenAPIHono } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { dashboardSchema } from "./dashboard/contract.js";
import { getDashboard, saveDashboard } from "./dashboard/dashboard.js";
import { daySchema } from "./days/contract.js";
import { getDay } from "./days/days.js";
import { entrySchema, repeatInputSchema, searchResultSchema, submissionSchema } from "./food/contract.js";
import { searchFoods } from "./food/catalog.js";
import { mutateFood } from "./food/food.js";
import type { AppDatabase } from "./db/database.js";
import type { FoodMutationResult } from "./food/food.js";
import { recordPaths } from "./journal/paths.js";
import { mutateRecord } from "./journal/records.js";
import type { RecordKind, RecordMutationResult } from "./journal/records.js";
import { measurementInputSchema } from "./measurements/contract.js";
import { measurementRecords } from "./measurements/measurements.js";
import { overviewSchema } from "./overview/contract.js";
import { getOverview } from "./overview/overview.js";
import { maxPhotoBytes, photoSchema, photoUploadSchema } from "./photos/contract.js";
import { detectPhotoType, getPhotoImage, photoRecords } from "./photos/photos.js";
import { sleepInputSchema } from "./sleep/contract.js";
import { sleepRecords } from "./sleep/sleep.js";
import { targetsForDaySchema, targetsSchema } from "./targets/contract.js";
import { getTargets, saveTargets } from "./targets/targets.js";
import { occurredAtSchema, timeZoneSchema } from "./time.js";
import { waterInputSchema } from "./water/contract.js";
import { waterRecords } from "./water/water.js";
import { workoutInputSchema, workoutSummarySchema } from "./workouts/contract.js";
import { getWorkoutSummary, workoutRecords } from "./workouts/workouts.js";

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

// Water and the other journal records are created and removed, never edited in place.
function recordResponse<Entry>(result: RecordMutationResult<Entry>, label: string): Response {
  switch (result.outcome) {
    case "created":
      return new Response(JSON.stringify(result.entry), { status: 201, headers: { "Content-Type": "application/json" } });
    case "deleted":
      return new Response(null, { status: 204 });
    case "missing":
      return error(404, `${label} not found`);
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

export function createApp(db: AppDatabase, auth: { token: string; userId: string }) {
  const app = new OpenAPIHono<{ Variables: { userId: string; idempotencyKey: string } }>();

  const pageHeaders = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' blob:; base-uri 'none'; form-action 'self'",
  };

  // The page carries the configured token so the browser connects without asking for it.
  const tokenMeta = `<meta name="nouri-api-token" content="${escapeHtml(auth.token)}" />`;

  for (const path of ["/", "/food", "/overview"]) {
    app.get(path, async () => new Response((await readFile(new URL("../web/dist/index.html", import.meta.url), "utf8")).replace("</head>", `${tokenMeta}</head>`), {
      headers: { ...pageHeaders, "Content-Type": "text/html; charset=utf-8" },
    }));
  }

  app.get("/favicon.svg", async () => new Response(await readFile(new URL("../web/dist/favicon.svg", import.meta.url)), {
    headers: { ...pageHeaders, "Content-Type": "image/svg+xml" },
  }));

  const assetTypes = new Map([
    ["js", "text/javascript; charset=utf-8"],
    ["css", "text/css; charset=utf-8"],
    ["woff2", "font/woff2"],
  ]);

  app.get("/assets/:file", async (context) => {
    const file = context.req.param("file");
    const type = /^[a-zA-Z0-9_-]+\.([a-z0-9]+)$/.exec(file)?.[1];
    const contentType = type && assetTypes.get(type);

    if (!contentType) return error(404, "Asset not found");
    const body = await readFile(new URL(`../web/dist/assets/${file}`, import.meta.url)).catch(() => null);

    if (!body) return error(404, "Asset not found");

    return new Response(body, { headers: { ...pageHeaders, "Content-Type": contentType } });
  });

  const errorSchema = z.object({ error: z.string() });
  const keyParameter = z.string().min(1).max(200);
  const mutationHeaders = z.object({ "Idempotency-Key": keyParameter });
  const editHeaders = z.object({ "Idempotency-Key": keyParameter, "If-Match": z.string() });

  app.use("/v1/*", async (context, next) => {
    if (!sameToken(context.req.header("Authorization"), auth.token)) return error(401, "Unauthorized");
    context.set("userId", auth.userId);
    await next();
  });

  app.use("/v1/*", async (context, next) => {
    if (!["POST", "PATCH", "DELETE"].includes(context.req.method)) return next();
    const key = context.req.header("Idempotency-Key");

    if (!key || key.length > 200) return error(400, "Idempotency-Key required");
    context.set("idempotencyKey", key);
    await next();
  });

  app.post("/v1/food-entries", async (context) => {
    const key = context.get("idempotencyKey");

    const input = submissionSchema.safeParse(await context.req.json().catch(() => null));

    if (!input.success) return error(400, "Invalid food entry");

    return response(await mutateFood(db, context.get("userId"), key, { kind: "create", input: input.data }));
  });

  app.post("/v1/food-entries/:id/repeats", async (context) => {
    const key = context.get("idempotencyKey");
    const id = z.uuid().safeParse(context.req.param("id"));
    const input = repeatInputSchema.safeParse(await context.req.json().catch(() => null));

    if (!id.success || !input.success) return error(400, "Invalid food repeat");

    return response(await mutateFood(db, context.get("userId"), key, { kind: "repeat", sourceId: id.data, input: input.data }));
  });

  app.get("/v1/foods/search", (context) => {
    const query = z.string().trim().min(2).max(80).safeParse(context.req.query("q"));
    const locale = z.string().min(2).max(35).regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/).safeParse(context.req.query("locale") ?? "pt-PT");

    if (!query.success || !locale.success) return error(400, "Invalid food search");

    return context.json(searchFoods(query.data, locale.data));
  });

  app.patch("/v1/food-entries/:id", async (context) => {
    const key = context.get("idempotencyKey");
    const id = z.uuid().safeParse(context.req.param("id"));
    const revision = revisionHeader(context.req.header("If-Match"));
    const input = submissionSchema.safeParse(await context.req.json().catch(() => null));

    if (!id.success || revision === null || !input.success) return error(400, "Invalid food edit");

    return response(await mutateFood(db, context.get("userId"), key, { kind: "edit", id: id.data, revision, input: input.data }));
  });

  app.delete("/v1/food-entries/:id", async (context) => {
    const key = context.get("idempotencyKey");
    const id = z.uuid().safeParse(context.req.param("id"));
    const revision = revisionHeader(context.req.header("If-Match"));

    if (!id.success || revision === null) return error(400, "Invalid food deletion");

    return response(await mutateFood(db, context.get("userId"), key, { kind: "delete", id: id.data, revision }));
  });

  app.get("/v1/days/:date", async (context) => {
    const date = z.iso.date().safeParse(context.req.param("date"));

    if (!date.success) return error(400, "Invalid day request");

    const day = await getDay(db, context.get("userId"), date.data);

    return new Response(JSON.stringify(day), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  function recordDeletion<Input, Entry>(path: string, label: string, kind: RecordKind<Input, Entry>) {
    app.delete(`${path}/:id`, async (context) => {
      const key = context.get("idempotencyKey");
      const id = z.uuid().safeParse(context.req.param("id"));
      const revision = revisionHeader(context.req.header("If-Match"));

      if (!id.success || revision === null) return error(400, `Invalid ${label.toLowerCase()} deletion`);

      return recordResponse(await mutateRecord(db, context.get("userId"), key, kind, { kind: "delete", id: id.data, revision }), label);
    });
    app.openAPIRegistry.registerPath({ method: "delete", path: `${path}/{id}`, request: { params: z.object({ id: z.uuid() }), headers: editHeaders }, responses: { 204: { description: `Deleted ${label.toLowerCase()}` }, 404: { description: `${label} not found`, content: { "application/json": { schema: errorSchema } } }, 409: { description: "Revision or idempotency conflict", content: { "application/json": { schema: errorSchema } } } } });
  }

  function jsonRecordCreation<Input, Entry>(path: string, label: string, kind: RecordKind<Input, Entry>, schema: z.ZodType<Input>) {
    app.post(path, async (context) => {
      const key = context.get("idempotencyKey");
      const input = schema.safeParse(await context.req.json().catch(() => null));

      if (!input.success) return error(400, `Invalid ${label.toLowerCase()}`);

      return recordResponse(await mutateRecord(db, context.get("userId"), key, kind, { kind: "create", input: input.data }), label);
    });

    app.openAPIRegistry.registerPath({ method: "post", path, request: { headers: mutationHeaders, body: { content: { "application/json": { schema } } } }, responses: { 201: { description: `Created ${label.toLowerCase()}`, content: { "application/json": { schema: kind.schema } } }, 400: { description: "Invalid request", content: { "application/json": { schema: errorSchema } } }, 409: { description: "Idempotency conflict", content: { "application/json": { schema: errorSchema } } } } });
  }

  jsonRecordCreation(recordPaths.water, "Water entry", waterRecords, waterInputSchema);
  jsonRecordCreation(recordPaths.measurement, "Measurement", measurementRecords, measurementInputSchema);
  jsonRecordCreation(recordPaths.workout, "Workout", workoutRecords, workoutInputSchema);
  jsonRecordCreation(recordPaths.sleep, "Sleep session", sleepRecords, sleepInputSchema);
  recordDeletion(recordPaths.water, "Water entry", waterRecords);
  recordDeletion(recordPaths.measurement, "Measurement", measurementRecords);
  recordDeletion(recordPaths.workout, "Workout", workoutRecords);
  recordDeletion(recordPaths.sleep, "Sleep session", sleepRecords);
  recordDeletion(recordPaths.photo, "Photo", photoRecords);

  app.get(`${recordPaths.workout}/summary/:date`, async (context) => {
    const date = z.iso.date().safeParse(context.req.param("date"));

    if (!date.success) return error(400, "Invalid workout summary request");

    return context.json(await getWorkoutSummary(db, context.get("userId"), date.data));
  });
  app.openAPIRegistry.registerPath({ method: "get", path: `${recordPaths.workout}/summary/{date}`, request: { params: z.object({ date: z.iso.date() }) }, responses: { 200: { description: "Workout count and minutes for the local day", content: { "application/json": { schema: workoutSummarySchema } } } } });

  const uploadSchema = z.object({ file: z.instanceof(File), occurredAt: occurredAtSchema, timeZone: timeZoneSchema });

  // Multipart overhead rides on top of the image limit; the image itself is checked after parsing.
  app.post(recordPaths.photo, bodyLimit({ maxSize: maxPhotoBytes + 64 * 1024, onError: () => error(413, "Photo is larger than 8 MB") }), async (context) => {
    const key = context.get("idempotencyKey");

    const form = uploadSchema.safeParse(await context.req.parseBody().catch(() => null));

    if (!form.success) return error(400, "Invalid photo upload");
    const image = Buffer.from(await form.data.file.arrayBuffer());

    if (image.length > maxPhotoBytes) return error(413, "Photo is larger than 8 MB");
    const contentType = detectPhotoType(image);

    if (!contentType) return error(415, "Photo must be a JPEG, PNG, or WebP image");
    const input = { occurredAt: form.data.occurredAt, timeZone: form.data.timeZone, contentType, image };

    return recordResponse(await mutateRecord(db, context.get("userId"), key, photoRecords, { kind: "create", input }), "Photo");
  });

  app.get("/v1/progress-photos/:id/image", async (context) => {
    const id = z.uuid().safeParse(context.req.param("id"));

    if (!id.success) return error(400, "Invalid photo request");
    const photo = await getPhotoImage(db, context.get("userId"), id.data);

    if (!photo) return error(404, "Photo not found");

    return new Response(new Uint8Array(photo.image), {
      headers: { "Content-Type": photo.contentType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" },
    });
  });

  app.get("/v1/overview/:date", async (context) => {
    const date = z.iso.date().safeParse(context.req.param("date"));

    if (!date.success) return error(400, "Invalid overview request");

    return context.json(await getOverview(db, context.get("userId"), date.data));
  });

  app.get("/v1/dashboard", async (context) => context.json(await getDashboard(db, context.get("userId"))));

  // A full replacement of the layout, so repeating the request is safe without an idempotency key.
  app.put("/v1/dashboard", async (context) => {
    const input = dashboardSchema.safeParse(await context.req.json().catch(() => null));

    if (!input.success) return error(400, "Invalid dashboard layout");

    return context.json(await saveDashboard(db, context.get("userId"), input.data));
  });

  app.get("/v1/targets/:date", async (context) => {
    const date = z.iso.date().safeParse(context.req.param("date"));

    if (!date.success) return error(400, "Invalid targets request");

    return context.json(await getTargets(db, context.get("userId"), date.data));
  });

  // Replaces the whole set from that day on, so repeating the request is safe without an idempotency key.
  app.put("/v1/targets/:date", async (context) => {
    const date = z.iso.date().safeParse(context.req.param("date"));
    const input = targetsSchema.safeParse(await context.req.json().catch(() => null));

    if (!date.success || !input.success) return error(400, "Invalid targets");

    return context.json(await saveTargets(db, context.get("userId"), date.data, input.data));
  });

  app.openAPIRegistry.registerPath({ method: "post", path: "/v1/food-entries", request: { headers: mutationHeaders, body: { content: { "application/json": { schema: submissionSchema } } } }, responses: { 201: { description: "Created food entry", content: { "application/json": { schema: entrySchema } } }, 400: { description: "Invalid request", content: { "application/json": { schema: errorSchema } } }, 404: { description: "Catalog food not found", content: { "application/json": { schema: errorSchema } } }, 409: { description: "Idempotency conflict", content: { "application/json": { schema: errorSchema } } } } });
  app.openAPIRegistry.registerPath({ method: "post", path: "/v1/food-entries/{id}/repeats", request: { params: z.object({ id: z.uuid() }), headers: mutationHeaders, body: { content: { "application/json": { schema: repeatInputSchema } } } }, responses: { 201: { description: "A new entry copying the saved food, amount and nutrients", content: { "application/json": { schema: entrySchema } } }, 400: { description: "Invalid request", content: { "application/json": { schema: errorSchema } } }, 404: { description: "Entry not found", content: { "application/json": { schema: errorSchema } } }, 409: { description: "Idempotency conflict", content: { "application/json": { schema: errorSchema } } } } });
  app.openAPIRegistry.registerPath({ method: "get", path: "/v1/foods/search", request: { query: z.object({ q: z.string().min(2).max(80), locale: z.string().optional() }) }, responses: { 200: { description: "Ciqual food matches and attribution", content: { "application/json": { schema: searchResultSchema } } }, 400: { description: "Invalid query", content: { "application/json": { schema: errorSchema } } } } });
  app.openAPIRegistry.registerPath({ method: "patch", path: "/v1/food-entries/{id}", request: { params: z.object({ id: z.uuid() }), headers: editHeaders, body: { content: { "application/json": { schema: submissionSchema } } } }, responses: { 200: { description: "Updated food entry", content: { "application/json": { schema: entrySchema } } }, 404: { description: "Entry or catalog food not found", content: { "application/json": { schema: errorSchema } } }, 409: { description: "Revision or idempotency conflict", content: { "application/json": { schema: errorSchema } } } } });
  app.openAPIRegistry.registerPath({ method: "delete", path: "/v1/food-entries/{id}", request: { params: z.object({ id: z.uuid() }), headers: editHeaders }, responses: { 204: { description: "Deleted food entry" }, 404: { description: "Entry not found", content: { "application/json": { schema: errorSchema } } }, 409: { description: "Revision or idempotency conflict", content: { "application/json": { schema: errorSchema } } } } });
  app.openAPIRegistry.registerPath({ method: "get", path: "/v1/days/{date}", request: { params: z.object({ date: z.iso.date() }) }, responses: { 200: { description: "Food and water entries and totals for the recorded local day", content: { "application/json": { schema: daySchema } } } } });
  app.openAPIRegistry.registerPath({ method: "get", path: "/v1/dashboard", responses: { 200: { description: "Cards shown on the My Day page, in display order; defaults until the user saves a layout", content: { "application/json": { schema: dashboardSchema } } } } });
  app.openAPIRegistry.registerPath({ method: "put", path: "/v1/dashboard", request: { body: { content: { "application/json": { schema: dashboardSchema } } } }, responses: { 200: { description: "Saved dashboard layout", content: { "application/json": { schema: dashboardSchema } } }, 400: { description: "Unknown or repeated card", content: { "application/json": { schema: errorSchema } } } } });
  app.openAPIRegistry.registerPath({ method: "post", path: recordPaths.photo, request: { headers: mutationHeaders, body: { content: { "multipart/form-data": { schema: photoUploadSchema } } } }, responses: { 201: { description: "Uploaded progress photo", content: { "application/json": { schema: photoSchema } } }, 400: { description: "Invalid request", content: { "application/json": { schema: errorSchema } } }, 409: { description: "Idempotency conflict", content: { "application/json": { schema: errorSchema } } }, 413: { description: "Photo larger than 8 MB", content: { "application/json": { schema: errorSchema } } }, 415: { description: "Not a JPEG, PNG, or WebP image", content: { "application/json": { schema: errorSchema } } } } });
  app.openAPIRegistry.registerPath({ method: "get", path: "/v1/progress-photos/{id}/image", request: { params: z.object({ id: z.uuid() }) }, responses: { 200: { description: "The stored image bytes", content: { "image/jpeg": { schema: z.string().meta({ format: "binary" }) }, "image/png": { schema: z.string().meta({ format: "binary" }) }, "image/webp": { schema: z.string().meta({ format: "binary" }) } } }, 404: { description: "Photo not found", content: { "application/json": { schema: errorSchema } } } } });
  app.openAPIRegistry.registerPath({ method: "get", path: "/v1/overview/{date}", request: { params: z.object({ date: z.iso.date() }) }, responses: { 200: { description: "Nutrition, sports, measurements, sleep, and recent progress photos for the local day", content: { "application/json": { schema: overviewSchema } } } } });
  app.openAPIRegistry.registerPath({ method: "get", path: "/v1/targets/{date}", request: { params: z.object({ date: z.iso.date() }) }, responses: { 200: { description: "Targets in force on the local day; defaults until the user saves some", content: { "application/json": { schema: targetsForDaySchema } } } } });
  app.openAPIRegistry.registerPath({ method: "put", path: "/v1/targets/{date}", request: { params: z.object({ date: z.iso.date() }), body: { content: { "application/json": { schema: targetsSchema } } } }, responses: { 200: { description: "Targets saved to take effect on the local day, until the next change", content: { "application/json": { schema: targetsForDaySchema } } }, 400: { description: "Missing or out-of-range target", content: { "application/json": { schema: errorSchema } } } } });
  app.doc31("/openapi.json", { openapi: "3.1.0", info: { title: "Nouri API", version: "1.0.0" } });

  return app;
}

function revisionHeader(value: string | undefined): number | null {
  if (!value || !/^"[1-9][0-9]*"$/.test(value)) return null;
  const number = Number(value.slice(1, -1));

  return Number.isSafeInteger(number) ? number : null;
}
