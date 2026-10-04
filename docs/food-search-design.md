# Food search design

## Problem

The current API records manually supplied food names, quantities, nutrients, and an optional catalog reference. A search result must let someone find an ordinary ingredient and log a measured portion without inventing missing values. The app is aimed at Portugal, while the readily reusable generic catalogs have Finnish, French, or English names. Packaged food lookup and Portuguese composition data have separate reuse decisions. Logged nutrients must remain a snapshot so a later catalog update does not change past days.

## Usage (caller's view)

The mobile client requests `GET /v1/foods/search?q=apple&locale=pt-PT`. The response is a bounded list of candidates with a display name, source, basis, per-100 nutrient values, and a completeness flag. Search is a discovery operation. The client shows the source and missing nutrients before the person chooses a result.

After choosing a result, the client sends a catalog selection and a measured quantity to `POST /v1/food-entries` with its existing idempotency key. The server resolves the selected catalog record, scales its current per-100 values, and stores the resulting snapshot and version. Manual entry remains available for food that is absent or unsuitable.

```http
GET /v1/foods/search?q=apple&locale=pt-PT
Authorization: Bearer …

POST /v1/food-entries
Authorization: Bearer …
Idempotency-Key: meal-123
Content-Type: application/json

{
  "occurredAt": "2026-09-24T12:30:00Z",
  "timeZone": "Europe/Lisbon",
  "food": {
    "kind": "catalog",
    "ref": { "provider": "ciqual", "id": "13039", "version": "2025" },
    "quantity": { "amount": 150, "unit": "g" }
  }
}
```

The existing manual body remains valid without a `kind` field. Manual writes can still carry an informational reference to other sources. A Ciqual reference requires the catalog selection body so its nutrients are resolved by the server.

## Shape

```ts
type CatalogRef = {
  provider: "ciqual" | "fineli" | "usda-fdc" | "portfir" | "open-food-facts";
  id: string;
  version: string;
};

type Nutrients = {
  kcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
};

type FoodCandidate = {
  ref: CatalogRef;
  name: string;
  language: string;
  kind: "generic" | "packaged";
  basis: "per-100-g" | "per-100-ml";
  nutrients: Nutrients;
  barcode?: string;
  serving?: { amount: number; unit: "g" | "ml" };
};

type SearchResult = {
  items: FoodCandidate[];
  attribution: Array<{ provider: CatalogRef["provider"]; label: string; url: string }>;
};

interface FoodCatalog {
  search(query: string, locale: string): Promise<SearchResult>;
  resolve(ref: CatalogRef): Promise<FoodCandidate | null>;
  lookupBarcode(barcode: string): Promise<FoodCandidate | null>;
}

type NewFood =
  | { kind: "manual"; name: string; quantity: FoodQuantity; nutrients: Nutrients }
  | { kind: "catalog"; ref: CatalogRef; quantity: { amount: number; unit: "g" | "ml" } };

async function recordFood(userId: UserId, input: NewFood, idempotencyKey: string): Promise<FoodEntry> {
  // Claim the receipt using the original command, then resolve and snapshot catalog data inside the operation.
  throw new Error("not implemented");
}
```

`FoodCatalog` owns source format parsing, nutrient mapping, search ranking, and source attribution. The HTTP layer validates query length, locale, barcode, and the discriminated write body. The journal owns the idempotency receipt and persisted portion snapshot. A catalog candidate is never a database row or provider wire response. A `null` nutrient stays `null` through scaling and daily totals. A per-100-g result accepts grams; a per-100-ml result accepts millilitres. Serving suggestions require an explicit measured size. No implicit density conversion is allowed.

The search interface is one operation for callers even if the catalog later reads several sources. A first implementation can use one imported catalog. Search ranking and provider changes stay inside `FoodCatalog`; mobile clients only see the normalized result and source label.

## Source decision

| Source | Fit | Decision |
| --- | --- | --- |
| [Ciqual 2025](https://doi.org/10.57745/RDMHWY) | French national composition data with French and English names, 3,484 foods, and Etalab Open Licence 2.0 | First European generic catalog. Import a pinned XML release for bounded local search and show Anses attribution. It has no Portuguese names. |
| [Fineli](https://fineli.fi/fineli/fi/avoin-data) | Finnish national composition data with English names, CSV exports, an API, and CC BY 4.0 attribution terms | Later import option. Its site currently challenges automated downloads from this environment. |
| [PortFIR](https://portfir.insa.min-saude.pt/pt/2026/05/13/atualizacao-da-tabela-da-composicao-de-alimentos-2/) | Portuguese names and foods; 2026 table lists 1,376 foods | Preferred `pt-PT` source after INSA confirms app reuse, caching, and display terms. Do not ingest its table before then. |
| [USDA FoodData Central](https://fdc.nal.usda.gov/api-guide/) | CC0, documented API, broad generic coverage, English names, API key and rate limit | Fallback for missing generic foods, not the primary European catalog. Keep the key on the server. |
| [Open Food Facts](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/) | European packaged product coverage and barcode API | Add only after the product accepts ODbL attribution and share-alike obligations. Use barcode lookup first; its search endpoint is limited to 10 requests per minute per IP and is unsuitable for each keystroke. |
| [EFSA EU FCDB](https://www.efsa.europa.eu/en/data-report/food-composition) | Broad European harmonization | Recheck later. Its current 2026 public view describes vitamins and minerals, while this feature requires energy and macros. |

For a Portugal launch, display Portuguese names from PortFIR when permission exists. Ciqual's French and English names are labelled by language, not silently translated by a model. The client can still search in English or French and create a manual Portuguese entry. If Portuguese search is a launch requirement, PortFIR permission or a separately licensed Portuguese catalog is a release gate.

## Synthesis decision

I compared a live federation of provider APIs with a local versioned ingredient index plus an optional barcode adapter. The local index is the base. It keeps search latency, ranking, and provider rate limits out of the user interaction, and it can pin the exact version used for a logged snapshot. I retained a narrow live lookup for barcodes because packaged products change frequently and barcode lookup is an exact query. A provider registry stays private to `FoodCatalog`; callers never orchestrate fallback order or nutrient parsing.

Both shapes can have a small caller interface. Live federation lost because each typed query would depend on remote latency, availability, language, and quotas. A single merged catalog table also lost because it would erase source specific terms and version identity. These choices avoid pass-through adapters and provider wire types in the public contract.

## Tradeoffs accepted

- We accept a scheduled import and a pinned source version in exchange for fast, predictable ingredient search.
- We accept French and English names in the first European catalog in exchange for using a source with explicit reuse terms now.
- We accept an extra resolve when logging a catalog food in exchange for server owned nutrient snapshots and reliable provenance.
- We accept separate source attribution in search and entries in exchange for keeping reuse obligations visible.

## Open questions and risks

- Will INSA allow commercial reuse and local indexing of PortFIR, and what attribution does it require?
- Does the product accept Open Food Facts ODbL terms for a barcode feature and for any stored product fields?
- Is Portuguese language ingredient search required for the first release? If so, Ciqual alone is insufficient.
- Should the first release include barcode lookup, or should it follow ingredient search after the licensing decision? [Barcode lookup](barcode-lookup-design.md) now covers it.

## Next implementation step

The Ciqual index, search endpoint, and catalog selection write body are implemented. Portuguese queries search Ciqual through a curated glossary while PortFIR stays gated; see [Portuguese food search design](portuguese-search-design.md). The next step is to ask INSA about PortFIR reuse so results can carry Portuguese names.
