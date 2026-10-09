import { readFileSync } from "node:fs";
import { z } from "zod";
import { catalogNutrientsSchema, type CatalogSelection, type RecordedFood } from "./contract.js";
import { portugueseTerms, readQuery, nearbyPortugueseReadings, type QueryPhrase } from "./portuguese.js";

const row = z.object({ id: z.string(), nameFr: z.string(), nameEn: z.string(), nutrientsPer100: catalogNutrientsSchema });

const snapshot = z.object({ version: z.string(), foods: z.array(row) });

const data = snapshot.parse(JSON.parse(readFileSync(new URL("../../data/ciqual-2025.json", import.meta.url), "utf8")));

export type CatalogCandidate = {
  ref: CatalogSelection;
  name: string;
  language: "fr" | "en";
  kind: "generic";
  basis: "per-100-g";
  nutrients: z.infer<typeof catalogNutrientsSchema>;
};

const byId = new Map(data.foods.map((food) => [food.id, food]));

const attribution = { provider: "ciqual", label: "Anses. 2025. Table de composition nutritionnelle des aliments Ciqual", url: "https://doi.org/10.57745/RDMHWY" };

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
}

function words(value: string): string[] {
  return value.split(/[^a-z0-9]+/).filter(Boolean);
}

const indexed = data.foods.map((food) => {
  const french = normalize(food.nameFr);
  const english = normalize(food.nameEn);

  return { food, french, english, tokens: [...new Set(words(`${english} ${french}`))] };
});

// Searches compare names in the reader's language first, so each language keeps its own ordering of the two names.
// Keep name tokens in order for ranking; the shared tokens cover both catalog languages.
const byLanguage = {
  fr: indexed.map(({ food, french, english, tokens }) => ({ food, name: french, nameTokens: words(french), other: english, tokens })),
  en: indexed.map(({ food, french, english, tokens }) => ({ food, name: english, nameTokens: words(english), other: french, tokens })),
};

type Entry = (typeof byLanguage)["en"][number];

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

// Every glossary reading as catalog words, built once so a glossary mistake fails at startup.
const readings = new Map(Object.entries(portugueseTerms).flatMap(([term, english]) => english.map((text) => [text, reading(term, text)] as const)));

function readingOf(text: string): Reading {
  const result = readings.get(text);

  if (!result) throw new Error(`Uncompiled glossary reading "${text}"`);

  return result;
}

// A word matches anywhere in a name, as typed, so "appl" still finds apples. A Portuguese term matches whole words only,
// as typed or as any English reading, because a translated word is complete: "pera" means pear, not pearled barley.
type Part = { kind: "word"; typed: string } | { kind: "term"; readings: Reading[] };

function part(phrase: QueryPhrase): Part {
  if (phrase.kind === "word") return phrase;

  return { kind: "term", readings: [phrase.typed.map(forms), ...phrase.english.map(readingOf)] };
}

function hasReading(tokens: string[], reading: Reading): boolean {
  return reading.every((words) => tokens.some((token) => words.has(token)));
}

// The alternatives that actually matched also supply the words used for ranking.
function matchedWords({ name, other, tokens }: Entry, part: Part): Set<string> | null {
  if (part.kind === "word") {
    return name.includes(part.typed) || other.includes(part.typed) ? new Set([part.typed]) : null;
  }

  const matches = part.readings.filter((reading) => hasReading(tokens, reading));

  return matches.length > 0 ? new Set(matches.flatMap((reading) => reading.flatMap((forms) => [...forms]))) : null;
}

function rank(foods: Entry[], parts: Part[]) {
  return foods.flatMap((entry) => {
    const matched = new Set<string>();

    for (const part of parts) {
      const words = matchedWords(entry, part);

      if (!words) return [];

      for (const word of words) matched.add(word);
    }

    const firstUnmatched = entry.nameTokens.findIndex((token) => !matched.has(token));
    const prefixTokens = firstUnmatched === -1 ? entry.nameTokens : entry.nameTokens.slice(0, firstUnmatched);

    return [{
      food: entry.food,
      whole: firstUnmatched === -1,
      prefix: new Set(prefixTokens).size,
      raw: /\braw\b|\bcru\b/.test(entry.name),
    }];
  });
}

export function searchFoods(query: string, locale: string) {
  const normalizedQuery = normalize(query);
  const parts = readQuery(normalizedQuery.split(/[\s-]+/).filter(Boolean)).map(part);

  const foods = byLanguage[locale.startsWith("fr") ? "fr" : "en"];
  const exact = rank(foods, parts);

  // Typo recovery changes the query alternatives, not the ranking policy.
  const matches = exact.length > 0 ? exact : rank(foods, parts.map(typoPart));

  matches.sort((left, right) => Number(right.whole) - Number(left.whole)
    || right.prefix - left.prefix
    || Number(right.raw) - Number(left.raw)
    || left.food.nameEn.length - right.food.nameEn.length
    || left.food.id.localeCompare(right.food.id));

  return { items: matches.slice(0, 20).map(({ food }) => candidate(food, locale)), attribution: [attribution] };
}

// A misspelled word reads as the catalog words or Portuguese terms it nearly matches.
function typoPart(part: Part): Part {
  if (part.kind === "term") return part;

  return {
    kind: "term",
    readings: [
      [new Set(vocabulary.filter((token) => nearlyMatches(part.typed, token)))],
      ...nearbyPortugueseReadings(part.typed, nearlyMatches).map(readingOf),
    ],
  };
}

// A Ciqual food at an amount in grams, as the journal records it; null when this catalog lacks it.
export function catalogFood(ref: CatalogSelection, amountG: number): RecordedFood | null {
  if (ref.provider !== "ciqual" || ref.version !== data.version) return null;

  const food = byId.get(ref.id);

  if (!food) return null;

  const scale = (value: number | null) => value === null ? null : Math.round(value * amountG * 10) / 1000;

  return {
    name: food.nameEn || food.nameFr,
    quantity: { amount: amountG, unit: "g" },
    nutrients: {
      kcal: scale(food.nutrientsPer100.kcal),
      proteinG: scale(food.nutrientsPer100.proteinG),
      carbsG: scale(food.nutrientsPer100.carbsG),
      fatG: scale(food.nutrientsPer100.fatG),
    },
    catalogRef: ref,
  };
}
