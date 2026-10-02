import { readFileSync } from "node:fs";
import { z } from "zod";
import type { CatalogSelection, FoodInput } from "./contract.js";

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

const indexed = data.foods.map((food) => {
  const french = normalize(food.nameFr);
  const english = normalize(food.nameEn);

  return { food, french, english, tokens: [...new Set(`${english} ${french}`.split(/[^a-z0-9]+/).filter(Boolean))] };
});

// Searches compare names in the reader's language first, so each language keeps its own ordering of the two names.
const byLanguage = {
  fr: indexed.map(({ food, french, english, tokens }) => ({ food, name: french, other: english, tokens })),
  en: indexed.map(({ food, french, english, tokens }) => ({ food, name: english, other: french, tokens })),
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

export function searchFoods(query: string, locale: string) {
  const normalizedQuery = normalize(query);
  const words = normalizedQuery.split(/\s+/);

  const foods = byLanguage[locale.startsWith("fr") ? "fr" : "en"];

  const exact = foods.flatMap(({ food, name, other }) => {
    if (!words.every((word) => name.includes(word) || other.includes(word))) return [];

    const score = name === normalizedQuery ? 0
      : name.startsWith(normalizedQuery) && /\braw\b|\bcru\b/.test(name) ? 1
      : name.startsWith(normalizedQuery) ? 2
      : name.includes(normalizedQuery) ? 3 : 4;

    return [{ food, score }];
  });

  // Fall back to typo-tolerant matching only when nothing matches as typed.
  const matches = exact.length > 0 ? exact : typoMatches(foods, words);

  matches.sort((left, right) => left.score - right.score || left.food.nameEn.length - right.food.nameEn.length || left.food.id.localeCompare(right.food.id));

  return { items: matches.slice(0, 20).map(({ food }) => candidate(food, locale)), attribution: [attribution] };
}

function typoMatches(foods: (typeof byLanguage)["en"], words: string[]) {
  const near = words.map((word) => new Set(vocabulary.filter((token) => nearlyMatches(word, token))));

  return foods.flatMap(({ food, name, tokens }) => {
    if (!near.every((matched) => tokens.some((token) => matched.has(token)))) return [];

    return [{ food, score: /\braw\b|\bcru\b/.test(name) ? 5 : 6 }];
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
