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

// Portuguese grammar stays here: phrases, connectives, plural and feminine fallback.
export type QueryPhrase = { kind: "word"; typed: string } | { kind: "term"; typed: string[]; english: [string, ...string[]] };
export function readQuery(words: string[]): QueryPhrase[];
// ["peito", "de", "frango"] -> [{ kind: "term", typed: ["peito"], english: ["breast"] }, { kind: "term", typed: ["frango"], english: ["chicken"] }]

// src/food/catalog.ts (private). Knows catalog words, not Portuguese.
// One way to read part of a query: a food matches when its name has a word from every set.
type Reading = Set<string>[];

// A plain word matches anywhere in a name, as typed. A term matches whole words only.
type Part = { kind: "word"; typed: string } | { kind: "term"; readings: Reading[] };

export function searchFoods(query: string, locale: string): SearchResult; // unchanged signature
```

Load-bearing decisions:

- **Translate the query, not the catalog.** The glossary only widens what a query matches. Result names, ids, nutrients and attribution come straight from Ciqual, so no displayed fact is invented (per the source decision in the food search design).
- **Portuguese grammar and catalog matching stay apart.** `portuguese.ts` owns the table and how a Portuguese query reads. `catalog.ts` turns English readings into catalog words, then matches and ranks. The Portuguese module also supplies glossary typo suggestions; the catalog supplies the shared edit-distance rule. Callers learn nothing new, and the HTTP and frontend contracts stay the same (per deep modules).
- **A glossary term matches whole words.** Plain words keep the existing substring match, so typing `appl` still works. A translated word is complete, so it matches whole catalog words and their plurals. Otherwise `pera` would find pearled barley, `sal` salmon and `cabrito` kidney. Matching stays locale-independent because the page always sends `en`.
- **Portuguese grammar is handled at lookup.** Each word independently tries its singular and masculine forms (`assadas` → `assada` → `assado`, `camarões` → `camarao`). Explicit irregular forms handle `crua` → `cru` and `flores` → `flor`. Connectives are skipped only when the query contains a recognized Portuguese term, so literal English `no sugar` retains `no`.
- **Matching and ranking share the same alternatives.** Each matched query part contributes its matching catalog words, including every matching translation. Ranking prefers names fully covered by those words, then the number of distinct covered words at the start of the name, then raw foods and the existing length/id tie-breaks. Word order and punctuation need no Portuguese-specific ranking rules. Repeated connecting words do not increase the prefix score.
- **Typos reuse the same matching and ranking flow.** The fallback replaces unknown words with nearby catalog words and glossary readings, then ranks those alternatives exactly as it ranks an exact query.
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
- Ranking still uses the catalog names rather than a semantic model of food, preparation, and ingredients. It cannot infer that a modifier belongs to one ingredient in a mixed dish.
- The glossary covers European Portuguese with a few Brazilian words (`abacaxi`, `abobrinha`). Does it need more Brazilian vocabulary?

## Next implementation step

Implemented. Next, ask INSA about PortFIR reuse; with permission, PortFIR joins `searchFoods` as a `pt` source with Portuguese names.
