import { readFileSync } from "node:fs";
import { z } from "zod";
import type { CatalogSelection, FoodInput } from "./contract.js";
import { portugueseConnectives, portugueseTerms } from "./portuguese.js";

const nutrients = z.object({ kcal: z.number().nonnegative().nullable(), proteinG: z.number().nonnegative().nullable(), carbsG: z.number().nonnegative().nullable(), fatG: z.number().nonnegative().nullable() });

const row = z.object({ id: z.string(), nameFr: z.string(), nameEn: z.string(), nutrientsPer100: nutrients });

const snapshot = z.object({ version: z.string(), foods: z.array(row) });

const data = snapshot.parse(JSON.parse(readFileSync(new URL("../../data/ciqual-2025.json", import.meta.url), "utf8")));

export type CatalogCandidate = {
  ref: CatalogSelection;
  name: string;
  language: "fr" | "en";
  kind: "generic";
  basis: "per-100-g";
  nutrients: z.infer<typeof nutrients>;
};

const byId = new Map(data.foods.map((food) => [food.id, food]));

const attribution = { provider: "ciqual", label: "Anses. 2025. Table de composition nutritionnelle des aliments Ciqual", url: "https://doi.org/10.57745/RDMHWY" };

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
}

function plain(value: string): string {
  return value.replace(/[^a-z0-9]+/g, " ").trim();
}

const indexed = data.foods.map((food) => {
  const french = normalize(food.nameFr);
  const english = normalize(food.nameEn);

  return { food, french, english, tokens: [...new Set(`${english} ${french}`.split(/[^a-z0-9]+/).filter(Boolean))] };
});

// Searches compare names in the reader's language first, so each language keeps its own ordering of the two names.
// Ranking compares the name's words without punctuation, so "chicken breast" ranks "Chicken, breast, raw" first.
const byLanguage = {
  fr: indexed.map(({ food, french, english, tokens }) => ({ food, name: french, words: plain(french), other: english, tokens })),
  en: indexed.map(({ food, french, english, tokens }) => ({ food, name: english, words: plain(english), other: french, tokens })),
};

// Every distinct word in the catalog. Typo matching checks each once instead of once per food that uses it.
const vocabulary = [...new Set(indexed.flatMap(({ tokens }) => tokens))];

function candidate(food: z.infer<typeof row>, locale: string): CatalogCandidate {
  const language = locale.startsWith("fr") || !food.nameEn ? "fr" : "en";

  return {
    ref: { provider: "ciqual", id: food.id, version: data.version },
    name: language === "fr" ? food.nameFr : food.nameEn,
    language,
    kind: "generic",
    basis: "per-100-g",
    nutrients: food.nutrientsPer100,
  };
}

// Reused across calls; search runs on the request thread, so allocating a table per comparison adds up.
let cells = new Uint16Array(0);

// Optimal string alignment distance, so a swapped pair of letters counts as one typo.
// Stops early once every cell in a row exceeds `limit`, since the distance can only grow from there.
function editDistance(left: string, right: string, limit: number): number {
  const width = right.length + 1;
  const size = (left.length + 1) * width;

  if (cells.length < size) cells = new Uint16Array(size);
  const at = (i: number, j: number) => cells[i * width + j] ?? 0;

  for (let i = 0; i <= left.length; i++) cells[i * width] = i;

  for (let j = 0; j <= right.length; j++) cells[j] = j;

  let previousBest = 0;

  for (let i = 1; i <= left.length; i++) {
    let rowBest = at(i, 0);

    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      let best = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);

      if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1])
        best = Math.min(best, at(i - 2, j - 2) + 1);

      cells[i * width + j] = best;
      rowBest = Math.min(rowBest, best);
    }

    // A transposition reads two rows back, so the previous row must be out of reach too.
    if (rowBest > limit && previousBest > limit) return limit + 1;
    previousBest = rowBest;
  }

  return at(left.length, right.length);
}

// Short words must match exactly; longer ones allow one typo, or two from eight letters.
function nearlyMatches(word: string, token: string): boolean {
  const allowed = word.length >= 8 ? 2 : word.length >= 4 ? 1 : 0;

  if (allowed === 0) return token.startsWith(word);

  return Math.abs(token.length - word.length) <= allowed
    ? editDistance(word, token, allowed) <= allowed
    : token.length > word.length && editDistance(word, token.slice(0, word.length), allowed) <= allowed;
}

// A catalog word in any of the forms Ciqual names use, singular or plural.
const vocabularySet = new Set(vocabulary);

function forms(word: string): Set<string> {
  return new Set([word, `${word}s`, `${word}es`, word.replace(/y$/, "ies")].filter((form) => vocabularySet.has(form)));
}

// One way to read part of a query: a food matches when its name has a word from every set.
type Reading = Set<string>[];

// A reading word the catalog never uses would silently match nothing, so loading fails instead.
function reading(term: string, english: string): Reading {
  return english.split(" ").map((word) => {
    const matches = forms(word);

    if (matches.size === 0) throw new Error(`Glossary term "${term}" reads as "${word}", which no catalog food uses`);

    return matches;
  });
}

// Portuguese words and phrases with the English readings Ciqual names use.
const glossary = new Map(Object.entries(portugueseTerms).map(([term, readings]) =>
  [term, { english: readings[0] ?? term, readings: readings.map((english) => reading(term, english)) }]));

const longestTerm = Math.max(...[...glossary.keys()].map((term) => term.split(" ").length));

const glossaryWords = [...glossary.keys()].filter((term) => !term.includes(" "));

// Plurals and feminine forms fall back to the singular masculine entry, so "batatas assadas" reads as batata and assado.
function lookup(words: string[]) {
  const variants = words.map((word) => {
    const singular = word.replace(/(oes|aes|aos)$/, "ao").replace(/s$/, "");

    return [word, singular, singular.replace(/a$/, "o")];
  });

  for (const level of [0, 1, 2]) {
    const term = glossary.get(variants.map((forms) => forms[level]).join(" "));

    if (term) return term;
  }

  return undefined;
}

// A word with no glossary entry matches anywhere in a name, as typed. A glossary term matches whole words only,
// as typed or as any English reading, because a translated word is complete: "pera" means pear, not pearled barley.
type Part = { typed: string; english: string | null; readings: Reading[] };

// Reads Portuguese words and phrases as the English words Ciqual uses, so "peito de frango" finds chicken breast.
// The longest glossary phrase wins, so "couve flor" is cauliflower rather than cabbage and flor.
function parseQuery(words: string[]): Part[] {
  const parts: Part[] = [];

  for (let start = 0; start < words.length;) {
    let size = Math.min(longestTerm, words.length - start);

    while (size > 1 && !lookup(words.slice(start, start + size))) size--;

    const typed = words.slice(start, start + size);
    const term = lookup(typed);

    if (term) parts.push({ typed: typed.join(" "), english: term.english, readings: [typed.map(forms), ...term.readings] });
    else if (!portugueseConnectives.has(typed[0] ?? "")) parts.push({ typed: typed[0] ?? "", english: null, readings: [] });

    start += size;
  }

  // A query of connectives alone still has to match something.
  return parts.length > 0 ? parts : words.map((word) => ({ typed: word, english: null, readings: [] }));
}

function hasReading(tokens: string[], reading: Reading): boolean {
  return reading.every((words) => tokens.some((token) => words.has(token)));
}

function matchesPart({ name, other, tokens }: (typeof byLanguage)["en"][number], part: Part): boolean {
  return part.english === null
    ? name.includes(part.typed) || other.includes(part.typed)
    : part.readings.some((reading) => hasReading(tokens, reading));
}

// Whole-word matches rank above a name that only starts with the query, so "pear" lists pears before pearled barley.
function score(name: string, query: string): number {
  const whole = name.startsWith(query) && !/[a-z0-9]/.test(name[query.length] ?? "");

  return name === query ? 0
    : whole && /\braw\b|\bcru\b/.test(name) ? 1
    : whole ? 2
    : name.startsWith(query) ? 3
    : name.includes(query) ? 4 : 5;
}

export function searchFoods(query: string, locale: string) {
  const normalizedQuery = normalize(query);
  const parts = parseQuery(normalizedQuery.split(/[\s-]+/).filter(Boolean));

  // Rank against the query as typed and in English, so "mel" puts honey ahead of melon. Portuguese names the food
  // before what describes it, so the English is also tried reversed: "sumo de laranja" ranks as orange juice.
  const english = parts.map((part) => part.english ?? part.typed);
  const translated = parts.some((part) => part.english !== null);
  const phrasings = [...new Set([normalizedQuery, ...translated ? [english.join(" "), english.toReversed().join(" ")] : []].map(plain))];

  const foods = byLanguage[locale.startsWith("fr") ? "fr" : "en"];

  const exact = foods.flatMap((entry) => {
    if (!parts.every((part) => matchesPart(entry, part))) return [];

    return [{ food: entry.food, score: Math.min(...phrasings.map((phrasing) => score(entry.words, phrasing))) }];
  });

  // Fall back to typo-tolerant matching only when nothing matches as typed.
  const matches = exact.length > 0 ? exact : typoMatches(foods, parts);

  matches.sort((left, right) => left.score - right.score || left.food.nameEn.length - right.food.nameEn.length || left.food.id.localeCompare(right.food.id));

  return { items: matches.slice(0, 20).map(({ food }) => candidate(food, locale)), attribution: [attribution] };
}

// A misspelled word reads as the catalog words it nearly matches, or as a glossary term it nearly matches.
function typoMatches(foods: (typeof byLanguage)["en"], parts: Part[]) {
  const readings = parts.map((part) => part.english !== null ? part.readings : [
    [new Set(vocabulary.filter((token) => nearlyMatches(part.typed, token)))],
    ...glossaryWords.filter((term) => nearlyMatches(part.typed, term)).flatMap((term) => glossary.get(term)?.readings ?? []),
  ]);

  return foods.flatMap(({ food, name, tokens }) => {
    if (!readings.every((options) => options.some((reading) => hasReading(tokens, reading)))) return [];

    return [{ food, score: /\braw\b|\bcru\b/.test(name) ? 6 : 7 }];
  });
}

export function resolveFood(ref: CatalogSelection, amountG: number, occurredAt: string, timeZone: string): FoodInput | null {
  if (ref.provider !== "ciqual" || ref.version !== data.version) return null;

  const food = byId.get(ref.id);

  if (!food) return null;

  const scale = (value: number | null) => value === null ? null : Math.round(value * amountG * 10) / 1000;

  return {
    occurredAt,
    timeZone,
    food: {
      name: food.nameEn || food.nameFr,
      quantity: { amount: amountG, unit: "g" },
      nutrients: {
        kcal: scale(food.nutrientsPer100.kcal),
        proteinG: scale(food.nutrientsPer100.proteinG),
        carbsG: scale(food.nutrientsPer100.carbsG),
        fatG: scale(food.nutrientsPer100.fatG),
      },
      catalogRef: ref,
    },
  };
}
