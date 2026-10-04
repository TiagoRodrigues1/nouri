# Portuguese food search design

## Problem

People in Portugal type food names in Portuguese, but the only catalog is Ciqual, which has French and English names. A search for `frango` or `maçã` returns nothing today. The Portuguese composition table from PortFIR is the obvious source, but its site states "Todos os direitos reservados" and publishes no reuse terms. The [food search design](food-search-design.md) keeps it out until INSA confirms reuse, and that gate still holds. The [food search design](food-search-design.md) also rules out translating catalog names with a model, so a result must keep the name its source published.

Constraints from the existing system:

- `GET /v1/foods/search` returns `SearchResult`, and logged entries carry a pinned Ciqual `ref`. Neither shape may change.
- The page always sends `locale=en`, and results show English names.
- Search ranking, typo tolerance and source attribution belong to `src/food/catalog.ts`.

## Usage (caller's view)

Nothing new to call. The same request accepts Portuguese words:

```http
GET /v1/foods/search?q=peito%20de%20frango&locale=en
```

```json
{ "items": [{ "ref": { "provider": "ciqual", "id": "36017", "version": "2025" }, "name": "Chicken, breast, without skin, raw", "language": "en", … }], "attribution": [ … ] }
```

The search box accepts English, French and Portuguese words. `bacalhau` finds cod, `couve-flor` finds cauliflower, `maçãs assadas` finds baked apple, and `frnago` (a typo) still finds chicken. English and French queries find the same foods as before.

## Shape

```ts
// src/food/portuguese.ts. Curated by hand, not generated. Keys are normalized singular Portuguese words or phrases,
// values are English words that appear in Ciqual names. Several values mean several valid readings.
export const portugueseTerms = { "frango": ["chicken"], "couve flor": ["cauliflower"], … } satisfies Record<string, string[]>;

// Small connectives a Portuguese query uses between food words ("peito de frango").
export const portugueseConnectives: Set<string>;

// src/food/catalog.ts (private)
// One way to read part of a query: a food matches when its name has a word from every set.
type Reading = Set<string>[];

// A word with no glossary entry matches anywhere in a name, as typed. A glossary term matches whole words only.
type Part = { typed: string; english: string | null; readings: Reading[] };

function parseQuery(words: string[]): Part[];
// "peito de frango" -> [{ typed: "peito", english: "breast", … }, { typed: "frango", english: "chicken", … }]
// Longest phrase first, so "couve flor" reads as cauliflower before couve -> cabbage.

export function searchFoods(query: string, locale: string): SearchResult; // unchanged signature
```

Load-bearing decisions:

- **Translate the query, not the catalog.** The glossary only widens what a query matches. Result names, ids, nutrients and attribution come straight from Ciqual, so no displayed fact is invented (per the source decision in the food search design).
- **The glossary is data and `catalog.ts` holds the policy.** `portuguese.ts` is a plain table. Matching, ranking and typo tolerance stay in one module. Callers learn nothing new, and the HTTP and frontend contracts stay the same (per deep modules).
- **A glossary term matches whole words.** Plain words keep the existing substring match, so typing `appl` still works. A translated word is complete, so it matches whole catalog words and their plurals. Otherwise `pera` would find pearled barley, `sal` salmon and `cabrito` kidney. Matching stays locale-independent because the page always sends `en`.
- **Portuguese grammar is handled at lookup, not in the table.** A miss retries the singular and masculine form (`assadas` → `assada` → `assado`, `camarões` → `camarao`), so the glossary lists each word once.
- **Ranking tries the English reading in both orders.** Portuguese names the food first (`sumo de laranja`), while English puts it last (`orange juice`). Ranking scores the query as typed, its English reading, and that reading reversed, then keeps the best. Ranking also ignores punctuation, so `chicken breast` ranks "Chicken, breast, raw" as a whole-word match.
- **Typos reuse the same rule.** The fallback compares each word with catalog words and with glossary keys, so a misspelled Portuguese word still translates.
- **Every glossary target must exist in the catalog.** Loading the catalog throws if a reading word appears in no Ciqual name, the same way the snapshot is validated at load. A glossary typo or a catalog update that drops a word cannot ship silently.

## Synthesis decision

Two whole shapes were compared. A data-side shape adds a `namePt` to Ciqual rows from a curated per-food file and indexes it as a third language. A query-side shape keeps a word glossary and expands queries. The query-side shape won. It covers all 3,484 foods with a few hundred words, displays only source-published names, and touches one module. The data-side shape would need a Portuguese name per food, which means translating thousands of names and displaying them as if a source had published them. The food search design rejected exactly that. From the data-side shape we kept the idea that Portuguese support is catalog-private. When PortFIR permission arrives, it can join the catalog as a real `pt` source behind the same `searchFoods`.

## Tradeoffs accepted

- We accept English result names for Portuguese queries in exchange for never displaying an invented translation.
- We accept a hand-maintained glossary in exchange for no new data license, no network, and no change to logged refs.
- We accept that dishes Ciqual lacks (francesinha, pastel de nata) find nothing in exchange for not mapping them to foods that only look similar.
- We accept locale-independent expansion in exchange for working with the page's current `locale=en`.

## Alternatives considered

- **Import PortFIR now.** This is the best data, but the site reserves all rights and publishes no reuse terms. It stays gated on INSA.
- **Per-food Portuguese names (`namePt`).** It needs thousands of translated names presented as catalog data. It is a large surface to maintain and repeats the model-translation problem.
- **Translate the query with a model or a remote API at request time.** It adds latency, cost and nondeterminism to every keystroke search, and its output cannot be checked against the catalog the way a fixed glossary can.

## Open questions and risks

- Has anyone written to `tabela.alimentos@insa.min-saude.pt` about PortFIR reuse? Portuguese result names depend on the answer.
- Should the page send `locale=pt-PT` once a Portuguese source exists, so results can come back in Portuguese?
- Single-word queries still use the shared tie-breaks, so `manteiga` lists "Butter bean, raw" before butter, as English `butter` does. Should ranking prefer a name whose first word is the query over the raw-food bonus?
- The glossary covers European Portuguese with a few Brazilian words (`abacaxi`, `abobrinha`). Does it need more Brazilian vocabulary?

## Next implementation step

Implemented. Next, ask INSA about PortFIR reuse; with permission, PortFIR joins `searchFoods` as a `pt` source with Portuguese names.
