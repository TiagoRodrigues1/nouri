import { readFile } from "node:fs/promises";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { RouteConfig } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import { compress } from "hono/compress";
import { z } from "zod";
import { eraseAccount, exportAccount } from "./account/account.js";
import { customExerciseInputSchema, customExerciseSchema, exerciseLibrarySchema } from "./exercises/contract.js";
import { getExerciseLibrary, mutateCustomExercise } from "./exercises/exercises.js";
import { dashboardSchema } from "./dashboard/contract.js";
import { getDashboard, saveDashboard } from "./dashboard/dashboard.js";
import { daySchema } from "./days/contract.js";
import { getDay } from "./days/days.js";
import type { PackagedFoods } from "./food/packaged.js";
import { foodRoutes } from "./food/routes.js";
import { idempotencyKeySchema, mutationResponse, revisionHeader } from "./journal/http.js";
import type { AppDatabase } from "./db/database.js";
import { getDated, saveDated, type DatedKind, type DatedTable } from "./effective-dated.js";
import { mealInputSchema, mealLogInputSchema, mealLogSchema, savedMealListSchema, savedMealSchema } from "./meals/contract.js";
import { fillDailyMeals, listMeals, logMeal, mutateMeal } from "./meals/meals.js";
import { integrationRoutes } from "./wearables/routes.js";
import { error, errorSchema } from "./http-error.js";
import type { WearableRuntime } from "./wearables/provider.js";
import { clerkFrontendOrigin, userFor, type Identity } from "./identity/identity.js";
import { recordPaths } from "./journal/paths.js";
import { mutateRecord } from "./journal/records.js";
import { mcpRoutes } from "./mcp/routes.js";
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

export function createApp(db: AppDatabase, identity: Identity, packagedFoods: PackagedFoods, wearables?: WearableRuntime, publicUrl?: string) {
  const app = new OpenAPIHono<{ Variables: { userId: string; idempotencyKey: string } }>();

  // Clerk loads its scripts from the instance's Frontend API, shows avatars from img.clerk.com, and runs bot protection in a Cloudflare frame.
  const clerk = clerkFrontendOrigin(identity.publishableKey);
  const challenges = "https://challenges.cloudflare.com";

  const pageHeaders = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' ${clerk} ${challenges}; style-src 'self' 'unsafe-inline'; connect-src 'self' ${clerk}; img-src 'self' blob: https://img.clerk.com https://cdn.jsdelivr.net; worker-src 'self' blob:; frame-src ${challenges}; base-uri 'none'; form-action 'self'`,
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

  for (const path of ["/", "/food", "/meals", "/meals/*", "/overview", "/progress", "/review"]) {
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

  // Outside /v1, so Clerk OAuth access tokens are checked instead of session tokens and no Idempotency-Key is asked for.
  app.route("/", mcpRoutes(db, identity, publicUrl));

  const keyParameter = idempotencyKeySchema;
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
      const found = await userFor(db, clerkUserId);

      if (!found) return error(401, "Unauthorized");
      userId = found;

      // Bounds memory; clearing only costs the next request of each person one lookup.
      if (userIds.size >= 10_000) userIds.clear();
      userIds.set(clerkUserId, userId);
    }

    context.set("userId", userId);
    await next();
  });

  // Clerk sends this when a person deletes their account in Clerk, and Nouri erases their records. Outside /v1:
  // Clerk signs the request instead of sending a session. A failure answers 500, and Clerk retries.
  app.post("/webhooks/clerk", async (context) => {
    const event = await identity.readWebhook(context.req.raw);

    if (event === "forged") return error(401, "Invalid webhook signature");

    if (event.deletedUser) {
      await eraseAccount(db, wearables, event.deletedUser);
      userIds.delete(event.deletedUser);
    }

    return context.body(null, 204);
  });

  app.use("/v1/*", async (context, next) => {
    // Connecting, syncing, and disconnecting are safe to repeat, so integrations take no Idempotency-Key.
    if (!["POST", "PATCH", "DELETE"].includes(context.req.method) || context.req.path.startsWith("/v1/integrations/")) return next();
    const key = idempotencyKeySchema.safeParse(context.req.header("Idempotency-Key"));

    if (!key.success) return error(400, "Idempotency-Key required");
    context.set("idempotencyKey", key.data);
    await next();
  });

  // Daily meals log themselves on read: the reads that show logged foods (a day, a week, recent foods) bring the
  // journal up to date first, so none of them misses a daily meal. Nothing due costs one indexed query.
  for (const path of ["/v1/days/:date", "/v1/review/:date", "/v1/foods/recent"]) {
    app.get(path, async (context, next) => {
      await fillDailyMeals(db, context.get("userId"));
      await next();
    });
  }

  app.route("/", integrationRoutes(db, wearables));

  app.route("/", foodRoutes(db, packagedFoods));

  app.get("/v1/saved-meals", async (context) => context.json(await listMeals(db, context.get("userId"))));
  app.openAPIRegistry.registerPath({ method: "get", path: "/v1/saved-meals", responses: { 200: { description: "Saved meals, newest first", ...json(savedMealListSchema) } } });

  // Saving a meal is missing a chosen food entry or catalog food; the other meal routes are missing the saved meal.
  app.post("/v1/saved-meals", async (context) => {
    const input = mealInputSchema.safeParse(await context.req.json().catch(() => null));

    if (!input.success) return error(400, "Invalid saved meal");

    return mutationResponse(await mutateMeal(db, context.get("userId"), context.get("idempotencyKey"), { kind: "create", input: input.data }), "Food entry not found");
  });
  app.openAPIRegistry.registerPath({ method: "post", path: "/v1/saved-meals", request: { headers: mutationHeaders, body: json(mealInputSchema) }, responses: { 201: { description: "A saved meal of logged entries, Ciqual foods, and typed or scanned foods at the given amounts", ...json(savedMealSchema) }, 400: failure("Invalid request or an amount outside the journal's limits"), 404: failure("Food entry or catalog food not found"), 409: failure("Idempotency conflict") } });

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
    const input = mealInputSchema.safeParse(await context.req.json().catch(() => null));

    if (!id.success || revision === null || !input.success) return error(400, "Invalid saved meal edit");

    return mutationResponse(await mutateMeal(db, context.get("userId"), context.get("idempotencyKey"), { kind: "edit", id: id.data, revision, input: input.data }), "Saved meal not found");
  });
  app.openAPIRegistry.registerPath({ method: "patch", path: "/v1/saved-meals/{id}", request: { params: z.object({ id: z.uuid() }), headers: editHeaders, body: json(mealInputSchema) }, responses: { 200: { description: "The meal replaced whole: saved items listed by id are kept at their new amounts, other items are added, and items left out are removed. A daily meal's foods are logged on every day from today at its time; null stops future days", ...json(savedMealSchema) }, 400: failure("Invalid request, an item the meal lacks, or an amount outside the journal's limits"), 404: failure("Saved meal, food entry, or catalog food not found"), 409: failure("Revision or idempotency conflict") } });

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

  app.get("/v1/exercises", async (context) => context.json(await getExerciseLibrary(db, context.get("userId"))));
  app.openAPIRegistry.registerPath({ method: "get", path: "/v1/exercises", responses: { 200: { description: "Exercises to pick when logging a strength workout, sorted by name: the built-in catalog, your custom exercises, and names from your workouts that are in neither", ...json(exerciseLibrarySchema) } } });

  app.post("/v1/exercises", async (context) => {
    const input = customExerciseInputSchema.safeParse(await context.req.json().catch(() => null));

    if (!input.success) return error(400, "Invalid custom exercise");

    return mutationResponse(await mutateCustomExercise(db, context.get("userId"), context.get("idempotencyKey"), { kind: "create", input: input.data }), "Exercise not found");
  });
  app.openAPIRegistry.registerPath({ method: "post", path: "/v1/exercises", request: { headers: mutationHeaders, body: json(customExerciseInputSchema) }, responses: { 201: { description: "A custom exercise. It may take a name only your workouts have, which gives that history a muscle and equipment", ...json(customExerciseSchema) }, 400: failure("Invalid request"), 409: failure("A catalog or custom exercise has that name, or an idempotency conflict") } });

  app.delete("/v1/exercises/:id", async (context) => {
    const id = z.uuid().safeParse(context.req.param("id"));
    const revision = revisionHeader(context.req.header("If-Match"));

    if (!id.success || revision === null) return error(400, "Invalid custom exercise deletion");

    return mutationResponse(await mutateCustomExercise(db, context.get("userId"), context.get("idempotencyKey"), { kind: "delete", id: id.data, revision }), "Custom exercise not found");
  });
  app.openAPIRegistry.registerPath({ method: "delete", path: "/v1/exercises/{id}", request: { params: z.object({ id: z.uuid() }), headers: editHeaders }, responses: { 204: { description: "Deleted custom exercise; workouts that used it keep its name" }, 404: failure("Custom exercise not found"), 409: failure("Revision or idempotency conflict") } });

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


  app.get("/v1/account/export", (context) => {
    const now = new Date();

    return new Response(exportAccount(db, context.get("userId"), now), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="nouri-export-${now.toISOString().slice(0, 10)}.json"`,
        "Cache-Control": "private, no-store",
      },
    });
  });
  app.openAPIRegistry.registerPath({ method: "get", path: "/v1/account/export", responses: { 200: { description: "Every record stored for the account, including deleted entries and retry receipts, as JSON keyed by table. Binary columns are base64; provider tokens are left out", content: { "application/json": { schema: z.object({ format: z.literal("nouri-export/1"), exportedAt: z.iso.datetime(), account: z.object({ id: z.uuid(), created_at: z.string() }), tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))) }) } } } } });

  app.doc31("/openapi.json", { openapi: "3.1.0", info: { title: "Nouri API", version: "1.0.0" } });

  return app;
}
