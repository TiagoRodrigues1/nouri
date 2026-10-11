# Community foods

## Problem

When a barcode is missing from Open Food Facts, or a food is missing from Ciqual, the person types the label by hand. The next person who eats the same product types it again. A food someone adds should join Nouri's own food database, so later searches and scans by anyone find it.

Shared data needs a gate. One person's typo (5000 kcal per 100 g) must not reach everyone, so a new food is visible only to the person who added it until it is reviewed. Many manual foods are one-offs ("my mum's soup") that would clutter search. A food with a barcode is always added; a food without one is added only when the person chooses to share it.

The constraints from [barcode lookup](barcode-lookup-design.md) hold. A logged food is a snapshot that a later edit never changes. Writes never depend on a third party. An unknown nutrient stays `null`.

## Usage (caller's view)

In **Add manually**, the person types the label: name, optional brand, the unit the label uses (g or ml), nutrition per 100, an optional serving size, and the amount eaten. **Share with other Nouri users** adds it to the database. In **Search foods**, a barcode that neither Nouri nor Open Food Facts knows offers **Add this product**, which opens the same form with the barcode filled in and sharing implied.

Search shows community foods in the same list as Ciqual's, marked **User-added**. Scanning a barcode finds a community food before asking Open Food Facts.

```http
POST /v1/foods
Idempotency-Key: <one per food>

{"name":"Bolo de arroz","brand":"Pastelaria Aurora","barcode":"5601234567892","unit":"g",
 "nutrientsPer100":{"kcal":410,"proteinG":6,"carbsG":55,"fatG":18},"serving":{"amount":80}}
→ 201 {"barcode":"5601234567892","brand":"Pastelaria Aurora",
       "food":{"name":"Bolo de arroz","quantity":{"amount":100,"unit":"g"},"nutrients":{…},
               "catalogRef":{"provider":"nouri","id":"<uuid>"}},
       "serving":{"amount":80,"unit":"g"}}
→ 400 invalid label (a macro over 100 per 100, energy over 900 kcal per 100, a bad check digit)
→ 409 this person already added this barcode, or a reviewed food has it

GET /v1/foods/search?q=bolo arroz
→ 200 {"items":[{"kind":"community", barcode, brand, food, serving}, {"kind":"generic", ref, name, …}], "attribution":[…]}

GET /v1/foods/barcodes/5601234567892
→ 200 {"product":{barcode, brand, food:{…, catalogRef:{provider:"nouri", id}}, serving}, "attribution":[]}
```

The page logs the food through the existing manual body, scaled with `scaleFood`, as it logs a scanned product:

```ts
const added = await createCommunityFood(key, label);
onPick(manualFood(scaleFood(added.food, amount)));
```

The reviewer runs `pnpm foods:review` against the database: with no arguments it lists foods waiting for review; `approve <id>` shares one, `reject <id>` deletes one, pending or reviewed, so a reviewed food can make way for another with its barcode.

## Shape

```ts
// src/food/contract.ts: shared with the page
const recordedRefSchema: { provider: "ciqual" | … | "open-food-facts" | "nouri"; id; version? };
const labelFoodSchema: { barcode: string | null; brand: string | null; food: RecordedFood; serving: { amount; unit } | null };
const packagedProductSchema = labelFoodSchema with a barcode;
const communityFoodInputSchema: { name; brand: string | null; barcode: string | null; unit: "g" | "ml"; nutrientsPer100; serving: { amount } | null };
const searchResultSchema: { items: Array<CatalogCandidate | { kind: "community" } & LabelFood>; attribution };

// src/food/community.ts: owns the community_foods table
function addCommunityFood(db, userId, key, input): Promise<{ outcome: "created"; entry: LabelFood } | { outcome: "key-reuse" } | { outcome: "duplicate"; message }>;
function searchCommunityFoods(db, userId, query): Promise<CommunityCandidate[]>; // reviewed or the person's own
function communityProduct(db, userId, barcode): Promise<PackagedProduct | null>; // the reviewed one, else the person's own
function pendingFoods(db), approveFood(db, id), rejectFood(db, id);             // for the review script

// src/food/lookup.ts: the foods module's search and findByBarcode, which the routes call
function findFoods(db, userId, query, locale): Promise<SearchResult>;                // community foods, then Ciqual's
function findByBarcode(db, packagedFoods, userId, barcode): Promise<PackagedLookup>; // community food, else Open Food Facts

// frontend/src/manual-food-form.tsx
function ManualFoodForm(props: { actionLabel; pending?; barcode?: string | null; onPick: (food: FoodInput["food"]) => void }): JSX.Element;
```

`community.ts` is the deep part. Callers hand it a label and get back the `LabelFood` the page already scales and logs. It hides the storage in thousandths (shared with food entries through `stored-nutrients.ts`), the accent-free search text, visibility (reviewed, or added by this person), and how barcode conflicts settle. Ciqual search stays a pure function of the pinned catalog; `lookup.ts` puts up to five community matches ahead of Ciqual's, and answers a barcode from community foods before asking Open Food Facts. A community food credits no provider: it is Nouri's own data, marked by its `nouri` reference.

`ManualFoodForm` owns sharing. It adds the food when it has a barcode or the person chose to share, then hands its caller the scaled food with the community reference, so the log dialog and the meal editor do not change.

A deleted account keeps the foods it added, since others may log them, and forgets who added them (`ON DELETE SET NULL`). The column is `user_id`, so the account export includes them.

## Synthesis decision

Two shapes were sketched. **A** made community foods a second server-resolved catalog: the page sends `{kind:"catalog", ref:{provider:"nouri", id}}` and the server reads the row and scales it. Provenance would be enforced, and the MCP server's `log_foods` could use community refs. It also needed a catalog body in millilitres, an async resolution step in every write and edit, a visibility check inside writes, and a widened Ciqual-only `catalogRefSchema` that the forgery rule depends on.

**B**, chosen, treats a community food like a scanned product: reads return a per-100 snapshot carrying an informational `nouri` reference, and the page logs it through the manual body. The new surface is one table, one module, one write route and a form. Writes keep working as they do. Anyone can already type any nutrients into their own journal, so server resolution would protect provenance, not correctness.

## Tradeoffs accepted

- Up to five community matches come first, rather than ranked against Ciqual's scores. Community foods are mostly branded, and a person typing a brand wants it.
- Community search matches every typed word anywhere in the name or brand, ignoring accents and case. It has no typo tolerance and no Portuguese glossary, which Ciqual search has.
- One reviewed food per barcode. Two people may each submit the same barcode; approving the second fails until the reviewer rejects one.
- Review is a script run by the operator, not a page, because Nouri has no admin role.
- The MCP server's `search_foods` stays Ciqual-only, since its `log_foods` logs by Ciqual reference.

## Open questions

- Editing and deleting a food by the person who added it. An edit would send the food back for review.
- Should the creator's own pending foods say "awaiting review"?
