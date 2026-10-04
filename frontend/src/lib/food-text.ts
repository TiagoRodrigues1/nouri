import { format } from "./api";
import type { RecordedFood } from "../../../src/food/contract";

export const unitLabels = { g: "g", ml: "ml", serving: "servings" } as const;

export function nutrientLine({ kcal, proteinG, carbsG, fatG }: RecordedFood["nutrients"]): string {
  return `${format(kcal)} kcal · P ${format(proteinG, 1)} · C ${format(carbsG, 1)} · F ${format(fatG, 1)}`;
}
