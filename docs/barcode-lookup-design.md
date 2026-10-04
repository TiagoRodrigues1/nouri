# Barcode food lookup

## Problem

Packaged foods are most of what people eat that Ciqual does not cover, and their labels already carry the answer: a barcode and a nutrition table per 100 g or 100 ml. Typing a product's name into a generic ingredient catalog finds the wrong food, and typing its label by hand is slow. Scanning or typing the barcode should find the product and log a measured amount.

[Food search](food-search-design.md) left this open. It chose Open Food Facts for barcodes, through an exact lookup rather than its search endpoint, which allows 10 requests per minute. The product data changes often, so a lookup reads it live. The constraints from that design still hold. A logged food is a snapshot that a later product edit never changes. An unknown nutrient stays `null`. A per-100-g food is measured in grams, a per-100-ml food in millilitres, and nothing converts between them. Manual writes may already carry an informational `open-food-facts` reference (`recordedRefSchema`). Only Ciqual references are server-resolved, because Ciqual is pinned and local.

## Usage (caller's view)

In the **Search foods** tab, a person types a barcode into the search field or chooses **Scan** to read it with the camera. A barcode looks up one product instead of searching names. The result shows the product's name, brand, and nutrients per 100 g or ml, as a Ciqual result does. Choosing it asks for the amount in the product's own unit, with a one-serving shortcut when the label gives a serving size. **Add to log** records it at the dialog's time.

```http
GET /v1/foods/barcodes/3017620422003
→ 200 {"product":{"barcode":"3017620422003","name":"Nutella","brand":"Nutella",
        "food":{"name":"Nutella","quantity":{"amount":100,"unit":"g"},
                "nutrients":{"kcal":539,"proteinG":6.3,"carbsG":57.5,"fatG":30.9},
                "catalogRef":{"provider":"open-food-facts","id":"3017620422003","version":"1791077660"}},
        "serving":null},
      "attribution":[{"provider":"open-food-facts","label":"Open Food Facts, available under the Open Database License","url":"https://world.openfoodfacts.org/product/3017620422003"}]}
→ 400 not a valid EAN-8, UPC-A, EAN-13 or GTIN-14 (check digit included)
→ 404 Open Food Facts has no product with this barcode, or only an unnamed one
→ 502 Open Food Facts did not answer
```

The page logs the product through the existing manual body, scaled with the shared `scaleFood`:

```ts
const { product } = await lookupBarcode("3017620422003");
createFood(key, { occurredAt, timeZone, food: manualFood(scaleFood(product.food, 40)) });
```

Editing, logging again, recent foods and saved meals treat the entry as any manual food with a reference. They already keep a non-Ciqual reference.

## Shape

```ts
// src/food/contract.ts: shared with the page
function isBarcode(code: string): boolean;          // 8, 12, 13 or 14 digits with a valid GS1 check digit
const packagedProductSchema: { barcode; name; brand: string | null; food: RecordedFood; serving: { amount; unit } | null };
const barcodeLookupSchema: { product: PackagedProduct; attribution: Attribution[] };   // BarcodeLookup

// src/food/packaged.ts: owns the Open Food Facts wire format
type PackagedLookup = { outcome: "found"; result: BarcodeLookup } | { outcome: "not-found" | "unavailable" };
type PackagedFoods = { lookup(barcode: string): Promise<PackagedLookup> };
function openFoodFacts(fetch: typeof globalThis.fetch): PackagedFoods;

// src/app.ts
function createApp(db, identity, packagedFoods: PackagedFoods, wearables?): App;

// frontend/src/barcode-scanner.tsx
function BarcodeScanner(props: { onDetected: (barcode: string) => void; onCancel: () => void }): JSX.Element;
```

`PackagedFoods` is the deep part. Its one method hides the endpoint, field selection, the `User-Agent` Open Food Facts asks for, the timeout, the "found with status 0" answer, and nutrient mapping. Mapping reads `energy-kcal_100g` and falls back to `energy-kj_100g` divided by 4.184. It rounds to the thousandth the journal stores and turns an impossible value (negative, or more than 100 g of a macro per 100) into `null`, not a guess. The basis is millilitres when the package's quantity unit is `ml`, or the serving's when the package has none, and grams otherwise. A serving in the other unit is dropped. No caller sees the Open Food Facts response, per boundary discipline.

The product carries its nutrition as a `RecordedFood` of 100 g or 100 ml. That is the type the journal already copies, scales and checks, so the page needs no new arithmetic and no new write path. `createApp` takes the lookup as a dependency, as it takes wearables, so tests replace the network with a fake `fetch` and the server wires the real one.

`isBarcode` lives in the contract so the page decides "barcode or name?" with the same rule the server enforces. A mis-scan or typo fails the check digit before any request leaves.

The scanner reads EAN-13, EAN-8 and UPC-A with `barcode-detector`'s ponyfill (ZXing in WebAssembly). Its wasm is served from Nouri's own `/assets`, so the page CSP adds only `'wasm-unsafe-eval'`, and the chunk loads only when someone presses **Scan**. It accepts only a value that passes `isBarcode`, then stops the camera.

## Synthesis decision

Two shapes were sketched. **A** made Open Food Facts a second server-resolved catalog: the write body sends `{kind:"catalog", ref:{provider:"open-food-facts", id}}` and the server fetches the product again when it logs. That keeps one write shape for both catalogs. It also puts a third-party request inside every barcode write, edit and retry, which are claimed under a receipt in a transaction. A down or rate-limited Open Food Facts would block logging a product the person can already see. Making writes reliable needed a product cache table, version pinning against a product that changes weekly, async resolution before the receipt, `ml` catalog writes, and a new edit path.

**B**, chosen, returns a snapshot from one read endpoint and logs it through the manual body that already accepts the reference. The new surface is one route and one module. Writes never wait on a third party. From A it keeps the rule that no provider format crosses the module boundary.

## Tradeoffs accepted

- We accept that an `open-food-facts` reference is informational, like the existing manual one, in exchange for writes that never depend on a third party. The person can already type any nutrients for their own journal, so server resolution would protect provenance, not correctness.
- We accept a live request per lookup and no server cache in exchange for current product data. Open Food Facts allows 100 product reads per minute per IP, far above scanning speed.
- We accept a 1 MB wasm download on the first scan in exchange for scanning in Safari and Firefox, which lack a native `BarcodeDetector`.
- We accept kJ-only labels converted at 4.184 kJ/kcal, the label regulation's own factor, in exchange for not losing their energy.

## Alternatives considered

- **A, server-resolved packaged catalog.** Same caller shape for both catalogs, but it hid a remote dependency inside every write and needed a cache table and version policy to hide it again. More hidden machinery, the same visible surface.
- **Barcodes through `GET /v1/foods/search`.** One search endpoint for all foods, but every keystroke-sized query would decide whether to call a remote service, and its results could no longer be a pure function of the pinned catalog.

## Open questions and risks

- Open Food Facts is ODbL. Each entry stores only a product's name and four values for one portion, with the source reference. Is that within the attribution the page shows, or should the product page note the licence as well?
- UPC-E codes are not scanned, because they need expansion to UPC-A before lookup. Are they common enough on Portuguese shelves to matter?
- Open Food Facts' `nutrition_data_per` can say a label is per serving. Its `_100g` values are still computed per 100 g, so they are used as they are. Is that accurate enough for products with odd serving sizes?
- Camera access needs a secure origin. Development on `127.0.0.1` qualifies; a deployment must use HTTPS.
