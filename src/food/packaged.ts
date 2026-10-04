import { z } from "zod";
import { recordedFoodSchema, type BarcodeLookup } from "./contract.js";

export type PackagedLookup = { outcome: "found"; result: BarcodeLookup } | { outcome: "not-found" | "unavailable" };

// Finds a packaged food by its barcode. Callers never see the provider's response.
export type PackagedFoods = { lookup: (barcode: string) => Promise<PackagedLookup> };

const origin = "https://world.openfoodfacts.org";

const fields = ["product_name", "product_name_en", "brands", "product_quantity_unit", "serving_quantity", "serving_quantity_unit", "nutriments", "last_modified_t"];

// Open Food Facts asks every app to name itself so it can reach the developer instead of blocking an IP.
const userAgent = "Nouri/1.0 (+https://github.com/TiagoRodrigues1/nouri)";

// Values arrive as numbers or numeric strings, and anything else means the label lacks them.
const value = z.union([z.number().finite(), z.string().trim().regex(/^-?\d+(?:\.\d+)?$/).transform(Number)]).optional().catch(undefined);

const text = z.string().trim().optional().catch(undefined);

const productSchema = z.object({
  product_name: text,
  product_name_en: text,
  brands: text,
  product_quantity_unit: text,
  serving_quantity: value,
  serving_quantity_unit: text,
  last_modified_t: value,
  nutriments: z.object({
    "energy-kcal_100g": value,
    "energy-kj_100g": value,
    proteins_100g: value,
    carbohydrates_100g: value,
    fat_100g: value,
  }).catch({}),
});

const responseSchema = z.object({ status: z.number(), product: productSchema.optional() });

type Product = z.infer<typeof productSchema>;

const thousandth = (amount: number) => Math.round(amount * 1000) / 1000;

// A value no label can carry is unknown rather than wrong: energy beyond pure fat, or more than 100 of a macro per 100.
function per100(amount: number | undefined, max: number): number | null {
  return amount === undefined || amount < 0 || amount > max ? null : thousandth(amount);
}

// The energy label regulation's own factor, so a kJ-only label keeps its energy.
const kilojoulesPerKcal = 4.184;

function nutrients({ nutriments }: Product) {
  const kj = nutriments["energy-kj_100g"];

  return {
    kcal: per100(nutriments["energy-kcal_100g"] ?? (kj === undefined ? undefined : kj / kilojoulesPerKcal), 900),
    proteinG: per100(nutriments.proteins_100g, 100),
    carbsG: per100(nutriments.carbohydrates_100g, 100),
    fatG: per100(nutriments.fat_100g, 100),
  };
}

// Open Food Facts reports drinks per 100 ml under its `_100g` keys. The package's unit says which a product is,
// and the serving's unit when the package has none.
function product(barcode: string, found: Product): BarcodeLookup["product"] | null {
  const name = (found.product_name || found.product_name_en)?.slice(0, 200).trim();

  if (!name) return null;
  const unit = (found.product_quantity_unit ?? found.serving_quantity_unit) === "ml" ? "ml" : "g";
  const servingUnit = found.serving_quantity_unit ?? unit;
  const servingAmount = found.serving_quantity === undefined ? 0 : thousandth(found.serving_quantity);

  // Open Food Facts keeps no releases, so the edit time stands in for a version of the label that was logged.
  const catalogRef = found.last_modified_t === undefined
    ? { provider: "open-food-facts", id: barcode }
    : { provider: "open-food-facts", id: barcode, version: String(found.last_modified_t) };

  const food = recordedFoodSchema.safeParse({ name, quantity: { amount: 100, unit }, nutrients: nutrients(found), catalogRef });

  if (!food.success) return null;

  return {
    barcode,
    brand: found.brands?.split(",")[0]?.trim() || null,
    food: food.data,
    serving: servingUnit === unit && servingAmount > 0 && servingAmount <= 10_000 ? { amount: servingAmount, unit } : null,
  };
}

export function openFoodFacts(fetch: typeof globalThis.fetch): PackagedFoods {
  return {
    async lookup(barcode) {
      const url = `${origin}/api/v2/product/${barcode}.json?fields=${fields.join(",")}`;
      const response = await fetch(url, { headers: { "User-Agent": userAgent, Accept: "application/json" }, signal: AbortSignal.timeout(8000) }).catch(() => null);

      if (!response) return { outcome: "unavailable" };

      if (response.status === 404) return { outcome: "not-found" };

      if (!response.ok) return { outcome: "unavailable" };
      const body = responseSchema.safeParse(await response.json().catch(() => null));

      if (!body.success) return { outcome: "unavailable" };

      // A product nobody has named yet cannot be recorded, so it reads as not found.
      const found = body.data.status === 1 && body.data.product ? product(barcode, body.data.product) : null;

      if (!found) return { outcome: "not-found" };

      return {
        outcome: "found",
        result: { product: found, attribution: [{ provider: "open-food-facts", label: "Open Food Facts, available under the Open Database License", url: `${origin}/product/${barcode}` }] },
      };
    },
  };
}
