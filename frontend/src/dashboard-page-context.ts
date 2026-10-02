import { createContext, useContext } from "react";
import type { FoodEntry } from "./lib/api";
import type { MealSelection } from "./save-meal-dialog";
import type { useIdempotentDelete } from "./lib/use-idempotent";
import type { useWater } from "./lib/use-water";
import type { useJournal } from "./overview/use-journal";

export type DashboardPageContext = {
  date: string;
  isToday: boolean;
  onEditFood: (entry: FoodEntry) => void;
  onSaveMeal: (selection: MealSelection) => void;
  foodDelete: ReturnType<typeof useIdempotentDelete<FoodEntry>>;
  journal: ReturnType<typeof useJournal>;
  water: ReturnType<typeof useWater>;
  onManageSupplements: () => void;
  customizingCards: boolean;
  onCustomizingCardsChange: (open: boolean) => void;
};

export const dashboardPageContext = createContext<DashboardPageContext | null>(null);

export function useDashboardPage() {
  const context = useContext(dashboardPageContext);

  if (!context) throw new Error("Dashboard page rendered outside its shell");

  return context;
}
