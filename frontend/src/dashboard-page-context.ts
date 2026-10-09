import { createContext, useContext } from "react";
import type { FoodEntry } from "./lib/api";
import type { useIdempotentDelete } from "./lib/use-idempotent";
import type { useJournal } from "./overview/use-journal";

export type DashboardPageContext = {
  date: string;
  isToday: boolean;
  onEditFood: (entry: FoodEntry) => void;
  // Opens the meal editor with the day's foods in it.
  onSaveMeal: () => void;
  foodDelete: ReturnType<typeof useIdempotentDelete<FoodEntry>>;
  journal: ReturnType<typeof useJournal>;
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
