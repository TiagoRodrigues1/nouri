import { measurementKinds, measurementLimits, type MeasurementKind } from "../../../src/measurements/contract.js";

// A whole entry typed at the palette's root, such as "weight 82.4" or "500 water", saved in one Enter.
export type PaletteShortcut =
  | { kind: "measurement"; measurement: MeasurementKind; value: number }
  | { kind: "water"; volumeMl: number };

const measurementWords: Record<MeasurementKind, string[]> = {
  weight: ["weight", "w"],
  height: ["height"],
  "body-fat": ["body fat", "bodyfat", "bf"],
  waist: ["waist"],
};

const units: Record<MeasurementKind, string> = { weight: "kg", height: "cm", "body-fat": "%", waist: "cm" };

const number = String.raw`(\d+(?:[.,]\d+)?)`;

// The word and the number in either order, the number optionally followed by its unit.
function pairedValue(text: string, words: string[], unit: string): number | null {
  const word = `(?:${words.join("|")})`;
  const value = `${number}\\s*(?:${unit})?`;
  const match = new RegExp(`^(?:${word}\\s+${value}|${value}\\s+${word})$`).exec(text);
  const typed = match?.[1] ?? match?.[2];

  return typed === undefined ? null : Number(typed.replace(",", "."));
}

export function parseShortcut(query: string): PaletteShortcut | null {
  const text = query.trim().toLowerCase().replace(/\s+/g, " ");

  const volume = pairedValue(text, ["water"], "ml");

  if (volume !== null) return Number.isInteger(volume) && volume >= 1 && volume <= 5000 ? { kind: "water", volumeMl: volume } : null;

  for (const measurement of measurementKinds) {
    const value = pairedValue(text, measurementWords[measurement], units[measurement]);
    const limits = measurementLimits[measurement];

    if (value !== null) return value >= limits.min && value <= limits.max ? { kind: "measurement", measurement, value } : null;
  }

  return null;
}

// Accents and case aside, so "maca" finds "Maçã".
const folded = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

// Whether every word typed appears somewhere in the name.
export function nameMatches(name: string, query: string): boolean {
  const target = folded(name);

  return folded(query).split(/\s+/).filter(Boolean).every((word) => target.includes(word));
}
