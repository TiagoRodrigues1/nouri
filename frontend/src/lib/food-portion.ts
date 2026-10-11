import { manualFood, recordedFood, scaleFood, type CatalogSelection, type RecordedFood, type SubmittedFood } from "../../../src/food/contract.js";

// The food a person chose, before setting its amount. Catalog foods carry the nutrients used for a preview,
// while the submission keeps only the reference so the server measures the food itself.
type CatalogBasis = RecordedFood & { catalogRef: CatalogSelection; quantity: { amount: number; unit: "g" } };

export type FoodSource =
  | { kind: "catalog"; basis: CatalogBasis }
  | { kind: "label"; basis: RecordedFood };

export type FoodPortion = { submitted: SubmittedFood; preview: RecordedFood };

// Rebuilds a source when a meal changes amount. A catalog preview must name the same food as its submission.
export function sourceOf(submitted: SubmittedFood, preview: RecordedFood): FoodSource {
  if (!("kind" in submitted)) return { kind: "label", basis: recordedFood(submitted) };

  const ref = preview.catalogRef;

  if (preview.quantity.unit !== "g" || preview.quantity.amount !== submitted.quantity.amount
    || ref?.provider !== "ciqual" || ref.id !== submitted.ref.id || ref.version !== submitted.ref.version) {
    throw new Error("Catalog preview does not match its submission");
  }

  return { kind: "catalog", basis: { ...preview, catalogRef: submitted.ref, quantity: { amount: preview.quantity.amount, unit: "g" } } };
}

// A source at an amount, both as the page previews it and as logging or saving sends it.
export function portionFood(source: FoodSource, amount: number): FoodPortion {
  const preview = scaleFood(source.basis, amount);

  const submitted: SubmittedFood = source.kind === "catalog"
    ? { kind: "catalog", ref: source.basis.catalogRef, quantity: { amount, unit: "g" } }
    : manualFood(preview);

  return { submitted, preview };
}
