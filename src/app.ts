import { readFile } from "node:fs/promises";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { RouteConfig } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import { compress } from "hono/compress";
import { z } from "zod";
import { dashboardSchema } from "./dashboard/contract.js";
import { getDashboard, saveDashboard } from "./dashboard/dashboard.js";
import { daySchema } from "./days/contract.js";
import { getDay } from "./days/days.js";
import { barcodeLookupSchema, entrySchema, isBarcode, recentFoodsSchema, repeatInputSchema, searchResultSchema, submissionSchema } from "./food/contract.js";
import { searchFoods } from "./food/catalog.js";
import { getRecentFoods, mutateFood } from "./food/food.js";
import type { PackagedFoods } from "./food/packaged.js";
import type { AppDatabase } from "./db/database.js";
import { getDated, saveDated, type DatedKind, type DatedTable } from "./effective-dated.js";
import { mealEditSchema, mealInputSchema, mealLogInputSchema, mealLogSchema, savedMealListSchema, savedMealSchema } from "./meals/contract.js";
import { listMeals, logMeal, mutateMeal } from "./meals/meals.js";
import { integrationRoutes } from "./wearables/routes.js";
import { error, errorSchema } from "./http-error.js";
import type { WearableRuntime } from "./wearables/provider.js";
import { clerkFrontendOrigin, userFor, type Identity } from "./identity/identity.js";
import { recordPaths } from "./journal/paths.js";
import { mutateRecord } from "./journal/records.js";
import type { RecordKind } from "./journal/records.js";
import { measurementInputSchema } from "./measurements/contract.js";
import { measurementRecords } from "./measurements/measurements.js";
import { overviewSchema } from "./overview/contract.js";
import { getOverview } from "./overview/overview.js";
import { reviewSchema } from "./review/contract.js";
import { getReview } from "./review/review.js";
import { maxPhotoBytes, maxThumbnailBytes, photoSchema, photoUploadSchema } from "./photos/contract.js";
import { detectPhotoType, getPhotoImage, photoRecords } from "./photos/photos.js";
import { sleepInputSchema } from "./sleep/contract.js";
import { sleepRecords } from "./sleep/sleep.js";
import { intakeInputSchema } from "./supplements/contract.js";
import { intakeRecords, stackKind } from "./supplements/supplements.js";
import { targetsKind } from "./targets/targets.js";
import { occurredAtSchema, timeZoneSchema } from "./time.js";
import { waterInputSchema } from "./water/contract.js";
import { waterRecords } from "./water/water.js";
import { exerciseHistoryListSchema, workoutInputSchema, workoutSummarySchema } from "./workouts/contract.js";
import { getExerciseHistory, getWorkoutSummary, workoutRecords } from "./workouts/workouts.js";

type MutationResult<Entry> =
  | { outcome: "created" | "updated"; entry: Entry }
  | { outcome: "deleted" | "missing" | "stale" | "key-reuse" | "catalog-missing" | "invalid-item" | "invalid-amount" }
  | { outcome: "unknown-reference"; message: string };

// Every write answers the same way; routes differ only in what a missing record is called.
function mutationResponse<Entry>(result: MutationResult<Entry>, missing: string): Response {
  switch (result.outcome) {
    case "created":
    case "updated":
      return new Response(JSON.stringify(result.entry), { status: result.outcome === "created" ? 201 : 200, headers: { "Content-Type": "application/json" } });
    case "deleted":
      return new Response(null, { status: 204 });
    case "missing":
      return error(404, missing);
    case "catalog-missing":
      return error(404, "Catalog food not found");
    case "unknown-reference":
      return error(404, result.message);
    case "invalid-item":
      return error(400, "Invalid saved meal item");
    case "invalid-amount":
      return error(400, "Amount out of range");
    case "stale":
      return error(409, "Revision conflict");
    case "key-reuse":
      return error(409, "Idempotency key reused for another request");
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

export function createApp(db: AppDatabase, identity: Identity, packagedFoods: PackagedFoods, wearables?: WearableRuntime) {
  const app = new OpenAPIHono<{ Variables: { userId: string; idempotencyKey: string } }>();

  // Clerk loads its scripts from the instance's Frontend API, shows avatars from img.clerk.com, and runs bot protection in a Cloudflare frame.
  const clerk = clerkFrontendOrigin(identity.publishableKey);
  const challenges = "https://challenges.cloudflare.com";

  const pageHeaders = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' ${clerk} ${challenges}; style-src 'self' 'unsafe-inline'; connect-src 'self' ${clerk}; img-src 'self' blob: https://img.clerk.com; worker-src 'self' blob:; frame-src ${challenges}; base-uri 'none'; form-action 'self'`,
  };

  const keyMeta = `<meta name="nouri-clerk-publishable-key" content="${escapeHtml(identity.publishableKey)}" />`;

  // Text responses (the page, scripts, styles, JSON) shrink several times over; images and fonts are already compressed.
  app.use(compress());

  // The built page only changes with a new build, which restarts the server, so it is read once.
  // A failed read is not kept, so a page built after startup still gets served.
  let page: Promise<string> | undefined;

  async function indexPage(): Promise<string> {
    page ??= readFile(new URL("../web/dist/index.html", import.meta.url), "utf8").then((html) => html.replace("</head>", `${keyMeta}</head>`));

    try {
      return await page;
    } catch (failure) {
      page = undefined;
      throw failure;
    }
  }

  for (const path of ["/", "/food", "/overview", "/progress", "/review"]) {
    app.get(path, async () => new Response(await indexPage(), {
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
    ["wasm", "application/wasm"],
  ]);

  app.get("/assets/:file", async (context) => {
    const file = context.req.param("file");
    // Dots only between name parts, so a module like theme.stylex.ts keeps its chunk and ".." never matches.
    const type = /^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*\.([a-z0-9]+)$/.exec(file)?.[1];
    const contentType = type && assetTypes.get(type);

    if (!contentType) return error(404, "Asset not found");
    const body = await readFile(new URL(`../web/dist/assets/${file}`, import.meta.url)).catch(() => null);

    if (!body) return error(404, "Asset not found");

    // Vite names each asset after its content, so a name always means the same bytes and browsers can keep them.
    return new Response(body, { headers: { ...pageHeaders, "Cache-Control": "public, max-age=31536000, immutable", "Content-Type": contentType } });
  });

  const keyParameter = z.string().min(1).max(200);
  const mutationHeaders = z.object({ "Idempotency-Key": keyParameter });
  const editHeaders = z.object({ "Idempotency-Key": keyParameter, "If-Match": z.string() });
  const json = (schema: z.ZodType) => ({ content: { "application/json": { schema } } });
  const failure = (description: string) => ({ description, ...json(errorSchema) });

  // A Clerk user's Nouri id never changes, so each is looked up once rather than on every request.
  const userIds = new Map<string, string>();

  app.use("/v1/*", async (context, next) => {
    const clerkUserId = await identity.authenticate(context.req.raw);

    if (!clerkUserId) return error(401, "Unauthorized");
    let userId = userIds.get(clerkUserId);

    if (!userId) {
      userId = await userFor(db, clerkUserId);

      // Bounds memory; clearing only costs the next request of each person one lookup.
      if (userIds.size >= 10_000) userIds.clear();
      userIds.set(clerkUserId, userId);
    }

    context.set("userId", userId);
    await next();
  });

  app.use("/v1/*", async (context, next) => {
    // Connecting, syncing, and disconnecting are safe to repeat, so integrations take no Idempotency-Key.
    if (!["POST", "PATCH", "DELETE"].includes(context.req.method) || context.req.path.startsWith("/v1/integrations/")) return next();
    const key = context.req.header("Idempotency-Key");

    if (!key || key.length > 200) return error(400, "Idempotency-Key required");
    context.set("idempotencyKey", key);
    await next();
  });

  app.route("/", integrationRoutes(db, wearables));

  app.post("/v1/food-entries", async (context) => {
    const key = context.get("idempotencyKey");

    const input = submissionSchema.safeParse(await context.req.json().catch(() => null));

    if (!input.success) return error(400, "Invalid food entry");

    return mutationResponse(await mutateFood(db, context.get("userId"), key, { kind: "create", input: input.data }), "Food entry not found");
  });
  app.openAPIRegistry.registerPath({ method: "post", path: "/v1/food-entries", request: { headers: mutationHeaders, body: json(submissionSchema) }, responses: { 201: { description: "Created food entry", ...json(entrySchema) }, 400: failure("Invalid request"), 404: failure("Catalog food not found"), 409: failure("Idempotency conflict") } });

  app.post("/v1/food-entries/:id/repeats", async (context) => {
    const key = context.get("idempotencyKey");
    const id = z.uuid().safeParse(context.req.param("id"));
    const input = repeatInputSchema.safeParse(await context.req.json().catch(() => null));

    if (!id.success || !input.success) return error(400, "Invalid food repeat");

    return mutationResponse(await mutateFood(db, context.get("userId"), key, { kind: "repeat", sourceId: id.data, input: input.data }), "Food entry not found");
  });
  app.openAPIRegistry.registerPath({ method: "post", path: "/v1/food-entries/{id}/repeats", request: { params: z.object({ id: z.uuid() }), headers: mutationHeaders, body: json(repeatInputSchema) }, responses: { 201: { description: "A new entry copying the saved food, amount and nutrients, scaled to the amount when one is given", ...json(entrySchema) }, 400: failure("Invalid request or amount out of range"), 404: failure("Entry not found"), 409: failure("Idempotency conflict") } });

  app.get("/v1/foods/recent", async (context) => context.json(await getRecentFoods(db, context.get("userId"))));
  app.openAPIRegistry.registerPath({ method: "get", path: "/v1/foods/recent", responses: { 200: { description: "Up to 20 distinct foods from the latest entries, most recently eaten first, each with the entry to log again", ...json(recentFoodsSchema) } } });

  app.get("/v1/foods/search", (context) => {
    const query = z.string().trim().min(2).max(80).safeParse(context.req.query("q"));
    const locale = z.string().min(2).max(35).regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/).safeParse(context.req.query("locale") ?? "pt-PT");

    if (!query.success || !locale.success) return error(400, "Invalid food search");

    return context.json(searchFoods(query.data, locale.data));
  });
  app.openAPIRegistry.registerPath({ method: "get", path: "/v1/foods/search", request: { query: z.object({ q: z.string().min(2).max(80), locale: z.string().optional() }) }, responses: { 200: { description: "Ciqual food matches and attribution", ...json(searchResultSchema) }, 400: failure("Invalid query") } });

  app.get("/v1/foods/barcodes/:code", async (context) => {
    const code = context.req.param("code");

    if (!isBarcode(code)) return error(400, "Invalid barcode");
    const found = await packagedFoods.lookup(code);

    switch (found.outcome) {
      case "found":
        return context.json(found.result);
      case "not-found":
        return error(404, "No product found for this barcode");
      case "unavailable":
        return error(502, "Open Food Facts is not answering. Try again, or add the food manually.");
    }
  });
  app.openAPIRegistry.registerPath({ method: "get", path: "/v1/foods/barcodes/{code}", request: { params: z.object({ code: z.string().regex(/^(?:\d{8}|\d{12,14})$/) }) }, responses: { 200: { description: "The Open Food Facts product with this barcode: its nutrition per 100 g or 100 ml as a food to scale and log, its serving size, and attribution", ...json(barcodeLookupSchema) }, 400: failure("Not an EAN-8, UPC-A, EAN-13, or GTIN-14 with a valid check digit"), 404: failure("No product with this barcode"), 502: failure("Open Food Facts did not answer") } });

  app.patch("/v1/food-entries/:id", async (context) => {
    const key = context.get("idempotencyKey");
    const id = z.uuid().safeParse(context.req.param("id"));
    const revision = revisionHeader(context.req.header("If-Match"));
    const input = submissionSchema.safeParse(await context.req.json().catch(() => null));

    if (!id.success || revision === null || !input.success) return error(400, "Invalid food edit");

    return mutationResponse(await mutateFood(db, context.get("userId"), key, { kind: "edit", id: id.data, revision, input: input.data }), "Food entry not found");
  });
  app.openAPIRegistry.registerPath({ method: "patch", path: "/v1/food-entries/{id}", request: { params: z.object({ id: z.uuid() }), headers: editHeaders, body: json(submissionSchema) }, responses: { 200: { description: "Updated food entry", ...json(entrySchema) }, 404: failure("Entry or catalog food not found"), 409: failure("Revision or idempotency conflict") } });

  app.delete("/v1/food-entries/:id", async (context) => {
    const key = context.get("idempotencyKey");
    const id = z.uuid().safeParse(context.req.param("id"));
    const revision = revisionHeader(context.req.header("If-Match"));

    if (!id.success || revision === null) return error(400, "Invalid food deletion");

    return mutationResponse(await mutateFood(db, context.get("userId"), key, { kind: "delete", id: id.data, revision }), "Food entry not found");
  });
  app.openAPIRegistry.registerPath({ method: "delete", path: "/v1/food-entries/{id}", request: { params: z.object({ id: z.uuid() }), headers: editHeaders }, responses: { 204: { description: "Deleted food entry" }, 404: failure("Entry not found"), 409: failure("Revision or idempotency conflict") } });

  app.get("/v1/saved-meals", async (context) => context.json(await listMeals(db, context.get("userId"))));
  app.openAPIRegistry.registerPath({ method: "get", path: "/v1/saved-meals", responses: { 200: { description: "Saved meals, newest first", ...json(savedMealListSchema) } } });

  // Saving a meal is missing a chosen food entry; the other meal routes are missing the saved meal.
  app.post("/v1/saved-meals", async (context) => {
    const input = mealInputSchema.safeParse(await context.req.json().catch(() => null));

    if (!input.success) return error(400, "Invalid saved meal");

    return mutationResponse(await mutateMeal(db, context.get("userId"), context.get("idempotencyKey"), { kind: "create", input: input.data }), "Food entry not found");
  });
  app.openAPIRegistry.registerPath({ method: "post", path: "/v1/saved-meals", request: { headers: mutationHeaders, body: json(mealInputSchema) }, responses: { 201: { description: "A saved meal copying the chosen entries' foods at the given amounts", ...json(savedMealSchema) }, 400: failure("Invalid request or an amount outside the journal's limits"), 404: failure("Food entry not found"), 409: failure("Idempotency conflict") } });

  app.post("/v1/saved-meals/:id/logs", async (context) => {
    const id = z.uuid().safeParse(context.req.param("id"));
    const input = mealLogInputSchema.safeParse(await context.req.json().catch(() => null));

    if (!id.success || !input.success) return error(400, "Invalid saved meal log");

    return mutationResponse(await logMeal(db, context.get("userId"), context.get("idempotencyKey"), id.data, input.data), "Saved meal not found");
  });
  app.openAPIRegistry.registerPath({ method: "post", path: "/v1/saved-meals/{id}/logs", request: { params: z.object({ id: z.uuid() }), headers: mutationHeaders, body: json(mealLogInputSchema) }, responses: { 201: { description: "One food entry per chosen item, scaled to its amount, all logged at one time", ...json(mealLogSchema) }, 400: failure("Invalid request, an item the meal lacks, or an amount outside the journal's limits"), 404: failure("Saved meal not found"), 409: failure("Idempotency conflict") } });

  app.patch("/v1/saved-meals/:id", async (context) => {
    const id = z.uuid().safeParse(context.req.param("id"));
    const revision = revisionHeader(context.req.header("If-Match"));
    const input = mealEditSchema.safeParse(await context.req.json().catch(() => null));

    if (!id.success || revision === null || !input.success) return error(400, "Invalid saved meal edit");

    return mutationResponse(await mutateMeal(db, context.get("userId"), context.get("idempotencyKey"), { kind: "edit", id: id.data, revision, input: input.data }), "Saved meal not found");
  });
  app.openAPIRegistry.registerPath({ method: "patch", path: "/v1/saved-meals/{id}", request: { params: z.object({ id: z.uuid() }), headers: editHeaders, body: json(mealEditSchema) }, responses: { 200: { description: "The renamed meal with the listed items at their new amounts; items left out are removed", ...json(savedMealSchema) }, 400: failure("Invalid request, an item the meal lacks, or an amount outside the journal's limits"), 404: failure("Saved meal not found"), 409: failure("Revision or idempotency conflict") } });

  app.delete("/v1/saved-meals/:id", async (context) => {
    const id = z.uuid().safeParse(context.req.param("id"));
    const revision = revisionHeader(context.req.header("If-Match"));

    if (!id.success || revision === null) return error(400, "Invalid saved meal deletion");

    return mutationResponse(await mutateMeal(db, context.get("userId"), context.get("idempotencyKey"), { kind: "delete", id: id.data, revision }), "Saved meal not found");
  });
  app.openAPIRegistry.registerPath({ method: "delete", path: "/v1/saved-meals/{id}", request: { params: z.object({ id: z.uuid() }), headers: editHeaders }, responses: { 204: { description: "Deleted saved meal; foods already logged from it stay" }, 404: failure("Saved meal not found"), 409: failure("Revision or idempotency conflict") } });

  app.get("/v1/days/:date", async (context) => {
    const date = z.iso.date().safeParse(context.req.param("date"));

    if (!date.success) return error(400, "Invalid day request");

    const day = await getDay(db, context.get("userId"), date.data);

    return new Response(JSON.stringify(day), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  app.openAPIRegistry.registerPath({ method: "get", path: "/v1/days/{date}", request: { params: z.object({ date: z.iso.date() }) }, responses: { 200: { description: "Food and water entries and totals for the recorded local day", ...json(daySchema) } } });

  function recordDeletion<Input, Entry>(path: string, kind: RecordKind<Input, Entry>) {
    const { label } = kind;
    app.delete(`${path}/:id`, async (context) => {
      const key = context.get("idempotencyKey");
      const id = z.uuid().safeParse(context.req.param("id"));
      const revision = revisionHeader(context.req.header("If-Match"));

      if (!id.success || revision === null) return error(400, `Invalid ${label.toLowerCase()} deletion`);

      return mutationResponse(await mutateRecord(db, context.get("userId"), key, kind, { kind: "delete", id: id.data, revision }), `${label} not found`);
    });
    app.openAPIRegistry.registerPath({ method: "delete", path: `${path}/{id}`, request: { params: z.object({ id: z.uuid() }), headers: editHeaders }, responses: { 204: { description: `Deleted ${label.toLowerCase()}` }, 404: failure(`${label} not found`), 409: failure("Revision or idempotency conflict") } });
  }

  function jsonRecordCreation<Input, Entry>(path: string, kind: RecordKind<Input, Entry>, schema: z.ZodType<Input>, docs?: { 404?: string }) {
    const { label } = kind;
    app.post(path, async (context) => {
      const key = context.get("idempotencyKey");
      const input = schema.safeParse(await context.req.json().catch(() => null));

      if (!input.success) return error(400, `Invalid ${label.toLowerCase()}`);

      return mutationResponse(await mutateRecord(db, context.get("userId"), key, kind, { kind: "create", input: input.data }), `${label} not found`);
    });

    const responses: RouteConfig["responses"] = { 201: { description: `Created ${label.toLowerCase()}`, ...json(kind.schema) }, 400: failure("Invalid request"), 409: failure("Idempotency conflict") };

    if (docs?.[404]) responses[404] = failure(docs[404]);
    app.openAPIRegistry.registerPath({ method: "post", path, request: { headers: mutationHeaders, body: json(schema) }, responses });
  }

  jsonRecordCreation(recordPaths.water, waterRecords, waterInputSchema);
  jsonRecordCreation(recordPaths.measurement, measurementRecords, measurementInputSchema);
  jsonRecordCreation(recordPaths.workout, workoutRecords, workoutInputSchema);
  jsonRecordCreation(recordPaths.sleep, sleepRecords, sleepInputSchema);
  jsonRecordCreation(recordPaths.supplementIntake, intakeRecords, intakeInputSchema, { 404: "Supplement is not on your stack for that day" });
  recordDeletion(recordPaths.water, waterRecords);
  recordDeletion(recordPaths.measurement, measurementRecords);
  recordDeletion(recordPaths.workout, workoutRecords);
  recordDeletion(recordPaths.sleep, sleepRecords);
  recordDeletion(recordPaths.photo, photoRecords);
  recordDeletion(recordPaths.supplementIntake, intakeRecords);

  app.get(`${recordPaths.workout}/summary/:date`, async (context) => {
    const date = z.iso.date().safeParse(context.req.param("date"));

    if (!date.success) return error(400, "Invalid workout summary request");

    return context.json(await getWorkoutSummary(db, context.get("userId"), date.data));
  });
  app.openAPIRegistry.registerPath({ method: "get", path: `${recordPaths.workout}/summary/{date}`, request: { params: z.object({ date: z.iso.date() }) }, responses: { 200: { description: "Workout count, minutes, and recorded energy estimates for the local day", ...json(workoutSummarySchema) } } });

  app.get(`${recordPaths.workout}/exercises`, async (context) => context.json(await getExerciseHistory(db, context.get("userId"))));
  app.openAPIRegistry.registerPath({ method: "get", path: `${recordPaths.workout}/exercises`, responses: { 200: { description: "Every strength exercise logged, most recently done first, with its sessions oldest first. Names that differ only in case or spacing are one exercise", ...json(exerciseHistoryListSchema) } } });

  const uploadSchema = z.object({ file: z.instanceof(File), thumbnail: z.instanceof(File).optional(), occurredAt: occurredAtSchema, timeZone: timeZoneSchema });

  // Multipart overhead rides on top of the image limit; the image itself is checked after parsing.
  app.post(recordPaths.photo, bodyLimit({ maxSize: maxPhotoBytes + maxThumbnailBytes + 64 * 1024, onError: () => error(413, "Photo is larger than 8 MB") }), async (context) => {
    const key = context.get("idempotencyKey");

    const form = uploadSchema.safeParse(await context.req.parseBody().catch(() => null));

    if (!form.success) return error(400, "Invalid photo upload");
    const image = Buffer.from(await form.data.file.arrayBuffer());

    if (image.length > maxPhotoBytes) return error(413, "Photo is larger than 8 MB");
    const contentType = detectPhotoType(image);

    if (!contentType) return error(415, "Photo must be a JPEG, PNG, or WebP image");
    const thumbnail = form.data.thumbnail ? Buffer.from(await form.data.thumbnail.arrayBuffer()) : null;

    if (thumbnail && (thumbnail.length > maxThumbnailBytes || detectPhotoType(thumbnail) !== "image/jpeg")) return error(400, "Photo thumbnail must be a JPEG of at most 256 KB");
    const input = { occurredAt: form.data.occurredAt, timeZone: form.data.timeZone, contentType, image, thumbnail };

    return mutationResponse(await mutateRecord(db, context.get("userId"), key, photoRecords, { kind: "create", input }), `${photoRecords.label} not found`);
  });
  app.openAPIRegistry.registerPath({ method: "post", path: recordPaths.photo, request: { headers: mutationHeaders, body: { content: { "multipart/form-data": { schema: photoUploadSchema } } } }, responses: { 201: { description: "Uploaded progress photo", ...json(photoSchema) }, 400: failure("Invalid request"), 409: failure("Idempotency conflict"), 413: failure("Photo larger than 8 MB"), 415: failure("Not a JPEG, PNG, or WebP image") } });

  // The browser's HTTP cache is shared by everyone who signs in on it and ignores the session token, so photos are never stored there.
  function photoRoute(suffix: string, size: "full" | "thumbnail", description: string) {
    app.get(`/v1/progress-photos/:id/${suffix}`, async (context) => {
      const id = z.uuid().safeParse(context.req.param("id"));

      if (!id.success) return error(400, "Invalid photo request");
      const photo = await getPhotoImage(db, context.get("userId"), id.data, size);

      if (!photo) return error(404, "Photo not found");

      return new Response(new Uint8Array(photo.image), {
        headers: { "Content-Type": photo.contentType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" },
      });
    });

    const binary = { schema: z.string().meta({ format: "binary" }) };
    app.openAPIRegistry.registerPath({ method: "get", path: `/v1/progress-photos/{id}/${suffix}`, request: { params: z.object({ id: z.uuid() }) }, responses: { 200: { description, content: { "image/jpeg": binary, "image/png": binary, "image/webp": binary } }, 404: failure("Photo not found") } });
  }

  photoRoute("image", "full", "The stored image bytes");
  photoRoute("thumbnail", "thumbnail", "The photo's thumbnail, or the full image for a photo uploaded without one");

  app.get("/v1/overview/:date", async (context) => {
    const date = z.iso.date().safeParse(context.req.param("date"));

    if (!date.success) return error(400, "Invalid overview request");

    return context.json(await getOverview(db, context.get("userId"), date.data));
  });
  app.openAPIRegistry.registerPath({ method: "get", path: "/v1/overview/{date}", request: { params: z.object({ date: z.iso.date() }) }, responses: { 200: { description: "Sports, measurements, sleep, and recent progress photos for the local day", ...json(overviewSchema) } } });

  app.get("/v1/review/:date", async (context) => {
    const date = z.iso.date().safeParse(context.req.param("date"));

    if (!date.success) return error(400, "Invalid review request");

    return context.json(await getReview(db, context.get("userId"), date.data));
  });
  app.openAPIRegistry.registerPath({ method: "get", path: "/v1/review/{date}", request: { params: z.object({ date: z.iso.date() }) }, responses: { 200: { description: "Calories, protein, workouts, sleep, and weight for the seven local days ending on the date, with null for unrecorded days", ...json(reviewSchema) }, 400: failure("Invalid date") } });

  app.get("/v1/dashboard", async (context) => context.json(await getDashboard(db, context.get("userId"))));
  app.openAPIRegistry.registerPath({ method: "get", path: "/v1/dashboard", responses: { 200: { description: "Cards shown on the My Day page, in display order; defaults until the user saves a layout", ...json(dashboardSchema) } } });

  // A full replacement of the layout, so repeating the request is safe without an idempotency key.
  app.put("/v1/dashboard", async (context) => {
    const input = dashboardSchema.safeParse(await context.req.json().catch(() => null));

    if (!input.success) return error(400, "Invalid dashboard layout");

    return context.json(await saveDashboard(db, context.get("userId"), input.data));
  });
  app.openAPIRegistry.registerPath({ method: "put", path: "/v1/dashboard", request: { body: json(dashboardSchema) }, responses: { 200: { description: "Saved dashboard layout", ...json(dashboardSchema) }, 400: failure("Unknown or repeated card") } });

  function datedRoutes<T extends DatedTable, Input, Result>(path: string, kind: DatedKind<T, Input, Result>, docs: { label: string; read: string; save: string; invalid: string }) {
    app.get(`${path}/:date`, async (context) => {
      const date = z.iso.date().safeParse(context.req.param("date"));

      if (!date.success) return error(400, `Invalid ${docs.label} request`);

      return context.json(await getDated(db, kind, context.get("userId"), date.data));
    });

    // Replaces the whole value from that day on, so repeating the request is safe without an idempotency key.
    app.put(`${path}/:date`, async (context) => {
      const date = z.iso.date().safeParse(context.req.param("date"));
      const input = kind.input.safeParse(await context.req.json().catch(() => null));

      if (!date.success || !input.success) return error(400, `Invalid ${docs.label}`);

      return context.json(await saveDated(db, kind, context.get("userId"), date.data, input.data));
    });

    const datedPath = `${path}/{date}`;
    const params = z.object({ date: z.iso.date() });
    app.openAPIRegistry.registerPath({ method: "get", path: datedPath, request: { params }, responses: { 200: { description: docs.read, ...json(kind.schema) } } });
    app.openAPIRegistry.registerPath({ method: "put", path: datedPath, request: { params, body: json(kind.input) }, responses: { 200: { description: docs.save, ...json(kind.schema) }, 400: failure(docs.invalid) } });
  }

  datedRoutes("/v1/targets", targetsKind, { label: "targets", read: "Targets in force on the local day; defaults until the user saves some", save: "Targets saved to take effect on the local day, until the next change", invalid: "Missing or out-of-range target" });
  datedRoutes(recordPaths.supplementStack, stackKind, { label: "supplement stack", read: "Supplements in force on the local day; empty until the user saves some", save: "Supplements saved to take effect on the local day, until the next change", invalid: "Invalid supplement or repeated id" });


  app.doc31("/openapi.json", { openapi: "3.1.0", info: { title: "Nouri API", version: "1.0.0" } });

  return app;
}

function revisionHeader(value: string | undefined): number | null {
  if (!value || !/^"[1-9][0-9]*"$/.test(value)) return null;
  const number = Number(value.slice(1, -1));

  return Number.isSafeInteger(number) ? number : null;
}
