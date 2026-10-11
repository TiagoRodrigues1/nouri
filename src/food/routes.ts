import { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import type { AppDatabase } from "../db/database.js";
import { error, errorSchema } from "../http-error.js";
import { idempotencyKeySchema, mutationResponse, revisionHeader, revisionHeaderSchema } from "../journal/http.js";
import { barcodeLookupSchema, communityFoodInputSchema, entrySchema, isBarcode, labelFoodSchema, recentFoodsSchema, repeatInputSchema, searchResultSchema, submissionSchema } from "./contract.js";
import { addCommunityFood } from "./community.js";
import { getRecentFoods, mutateFood } from "./food.js";
import { findByBarcode, findFoods } from "./lookup.js";
import type { PackagedFoods } from "./packaged.js";

const searchQuerySchema = z.object({
  q: z.string().trim().min(2).max(80).meta({ description: "Food name; length is checked after trimming whitespace." }),
  locale: z.string().min(2).max(35).regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/).default("pt-PT"),
});

const entryIdSchema = z.uuid();

const entryParams = z.object({ id: entryIdSchema });

const mutationHeaders = z.object({ "Idempotency-Key": idempotencyKeySchema });

const editHeaders = mutationHeaders.extend({ "If-Match": revisionHeaderSchema });

const json = (schema: z.ZodType) => ({ content: { "application/json": { schema } } });

// Existing callers may omit Content-Type or send another media type; the body must still be JSON.
const body = (schema: z.ZodType) => ({
  required: true,
  description: "A JSON body. Content-Type is not required or enforced.",
  content: { "application/json": { schema }, "*/*": { schema } },
});

const failure = (description: string) => ({ description, ...json(errorSchema) });

// Authentication and the idempotency-key check run in the parent before these routes.
// Keep manual parsing: declarative validators change malformed JSON and repeated-query behavior.
export function foodRoutes(db: AppDatabase, packagedFoods: PackagedFoods) {
  const app = new OpenAPIHono<{ Variables: { userId: string; idempotencyKey: string } }>();

  app.post("/v1/food-entries", async (context) => {
    const key = context.get("idempotencyKey");

    const input = submissionSchema.safeParse(await context.req.json().catch(() => null));

    if (!input.success) return error(400, "Invalid food entry");

    return mutationResponse(await mutateFood(db, context.get("userId"), key, { kind: "create", input: input.data }), "Food entry not found");
  });
  app.openAPIRegistry.registerPath({ method: "post", path: "/v1/food-entries", request: { headers: mutationHeaders, body: body(submissionSchema) }, responses: { 201: { description: "Created food entry", ...json(entrySchema) }, 400: failure("Invalid request"), 404: failure("Catalog food not found"), 409: failure("Idempotency conflict") } });

  app.post("/v1/food-entries/:id/repeats", async (context) => {
    const key = context.get("idempotencyKey");
    const id = entryIdSchema.safeParse(context.req.param("id"));
    const input = repeatInputSchema.safeParse(await context.req.json().catch(() => null));

    if (!id.success || !input.success) return error(400, "Invalid food repeat");

    return mutationResponse(await mutateFood(db, context.get("userId"), key, { kind: "repeat", sourceId: id.data, input: input.data }), "Food entry not found");
  });
  app.openAPIRegistry.registerPath({ method: "post", path: "/v1/food-entries/{id}/repeats", request: { params: entryParams, headers: mutationHeaders, body: body(repeatInputSchema) }, responses: { 201: { description: "A new entry copying the saved food, amount and nutrients, scaled to the amount when one is given", ...json(entrySchema) }, 400: failure("Invalid request or amount out of range"), 404: failure("Entry not found"), 409: failure("Idempotency conflict") } });

  app.get("/v1/foods/recent", async (context) => context.json(await getRecentFoods(db, context.get("userId"))));
  app.openAPIRegistry.registerPath({ method: "get", path: "/v1/foods/recent", responses: { 200: { description: "Up to 20 distinct foods from the latest entries, most recently eaten first, each with the entry to log again", ...json(recentFoodsSchema) } } });

  app.get("/v1/foods/search", async (context) => {
    const query = searchQuerySchema.safeParse({ q: context.req.query("q"), locale: context.req.query("locale") });

    if (!query.success) return error(400, "Invalid food search");

    return context.json(await findFoods(db, context.get("userId"), query.data.q, query.data.locale));
  });
  app.openAPIRegistry.registerPath({ method: "get", path: "/v1/foods/search", request: { query: searchQuerySchema }, responses: { 200: { description: "Up to 5 community foods the person can see, then Ciqual food matches, and attribution", ...json(searchResultSchema) }, 400: failure("Invalid query") } });

  app.post("/v1/foods", async (context) => {
    const input = communityFoodInputSchema.safeParse(await context.req.json().catch(() => null));

    if (!input.success) return error(400, "Invalid food");

    return mutationResponse(await addCommunityFood(db, context.get("userId"), context.get("idempotencyKey"), input.data));
  });
  app.openAPIRegistry.registerPath({ method: "post", path: "/v1/foods", request: { headers: mutationHeaders, body: body(communityFoodInputSchema) }, responses: { 201: { description: "The food as its label reads, per 100 g or ml. Only its author finds it until it is reviewed", ...json(labelFoodSchema) }, 400: failure("Invalid label"), 409: failure("The barcode is already in Nouri, or an idempotency conflict") } });

  app.get("/v1/foods/barcodes/:code", async (context) => {
    const code = context.req.param("code");

    if (!isBarcode(code)) return error(400, "Invalid barcode");
    const found = await findByBarcode(db, packagedFoods, context.get("userId"), code);

    switch (found.outcome) {
      case "found":
        return context.json(found.result);
      case "not-found":
        return error(404, "No product found for this barcode");
      case "unavailable":
        return error(502, "Open Food Facts is not answering. Try again, or add the food manually.");
    }
  });
  app.openAPIRegistry.registerPath({ method: "get", path: "/v1/foods/barcodes/{code}", request: { params: z.object({ code: z.string().regex(/^(?:\d{8}|\d{12,14})$/) }) }, responses: { 200: { description: "The community food or else the Open Food Facts product with this barcode: its nutrition per 100 g or 100 ml as a food to scale and log, its serving size, and attribution", ...json(barcodeLookupSchema) }, 400: failure("Not an EAN-8, UPC-A, EAN-13, or GTIN-14 with a valid check digit"), 404: failure("No product with this barcode"), 502: failure("Open Food Facts did not answer") } });

  app.patch("/v1/food-entries/:id", async (context) => {
    const key = context.get("idempotencyKey");
    const id = entryIdSchema.safeParse(context.req.param("id"));
    const revision = revisionHeader(context.req.header("If-Match"));
    const input = submissionSchema.safeParse(await context.req.json().catch(() => null));

    if (!id.success || revision === null || !input.success) return error(400, "Invalid food edit");

    return mutationResponse(await mutateFood(db, context.get("userId"), key, { kind: "edit", id: id.data, revision, input: input.data }), "Food entry not found");
  });
  app.openAPIRegistry.registerPath({ method: "patch", path: "/v1/food-entries/{id}", request: { params: entryParams, headers: editHeaders, body: body(submissionSchema) }, responses: { 200: { description: "Updated food entry", ...json(entrySchema) }, 400: failure("Invalid food edit"), 404: failure("Entry or catalog food not found"), 409: failure("Revision or idempotency conflict") } });

  app.delete("/v1/food-entries/:id", async (context) => {
    const key = context.get("idempotencyKey");
    const id = entryIdSchema.safeParse(context.req.param("id"));
    const revision = revisionHeader(context.req.header("If-Match"));

    if (!id.success || revision === null) return error(400, "Invalid food deletion");

    return mutationResponse(await mutateFood(db, context.get("userId"), key, { kind: "delete", id: id.data, revision }), "Food entry not found");
  });
  app.openAPIRegistry.registerPath({ method: "delete", path: "/v1/food-entries/{id}", request: { params: entryParams, headers: editHeaders }, responses: { 204: { description: "Deleted food entry" }, 400: failure("Invalid food deletion"), 404: failure("Entry not found"), 409: failure("Revision or idempotency conflict") } });

  return app;
}
