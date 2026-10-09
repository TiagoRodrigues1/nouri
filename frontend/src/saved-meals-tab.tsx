import * as stylex from "@stylexjs/stylex";
import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { styles } from "./form-styles";
import { Button } from "./components/ui/button";
import { MealItems } from "./meal-items";
import { format, type SavedMeal } from "./lib/api";
import { chosenAmounts, mealRows, type MealRow } from "./lib/saved-meals";
import { totalNutrients } from "../../src/food/contract";
import { occurredAt, timeZone } from "./lib/time";
import { useLogMeal, useSavedMeals } from "./lib/use-saved-meals";
import { ListSkeleton } from "./loading";
import { queryFallback } from "./query-status";

// Logs a meal at the dialog's date and time, with the amounts adjusted for this time only. Meals are made and
// changed on the Meals page.
export function SavedMealsTab({ date, time, onLogged, onManage }: { date: string; time: string; onLogged: () => void; onManage: () => void }) {
  const query = useSavedMeals();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const log = useLogMeal(onLogged);
  const meals = query.data;

  if (!meals || query.isError) return queryFallback(query, <ListSkeleton label="Loading your meals…" />, styles.searchMessage);

  const manage = (
    <Link to="/meals" {...stylex.props(styles.manageLink)} onClick={onManage}>
      {meals.length === 0 ? "Create a meal" : "Manage meals"}
    </Link>
  );

  if (meals.length === 0) {
    return (
      <div {...stylex.props(styles.formStack)}>
        <p {...stylex.props(styles.searchMessage)}>No meals yet. Build the meals you eat often on the Meals page, then log them here in one step.</p>
        {manage}
      </div>
    );
  }

  const selected = meals.find((meal) => meal.id === selectedId) ?? null;

  return (
    <div {...stylex.props(styles.formStack)}>
      <ul {...stylex.props(styles.mealList)} aria-label="Meals">
        {meals.map((meal, index) => (
          <li key={meal.id} {...stylex.props(index > 0 && styles.resultsItemBorder)}>
            <button type="button" {...stylex.props(styles.resultsButton, meal.id === selectedId && styles.resultsButtonSelected)} aria-pressed={meal.id === selectedId} onClick={() => setSelectedId(meal.id)}>
              <span>
                <strong {...stylex.props(styles.resultsText, styles.resultsName)}>{meal.name}</strong>
                <small {...stylex.props(styles.resultsText, styles.resultsMeta)}>
                  {meal.items.length} {meal.items.length === 1 ? "food" : "foods"} · {format(totalNutrients(meal.items.map(({ food }) => food.nutrients)).kcal)} kcal
                  {meal.daily && ` · every day at ${meal.daily.time}`}
                </small>
              </span>
              <ChevronRight size={16} />
            </button>
          </li>
        ))}
      </ul>
      {/* Keyed by meal and revision, so choosing another restarts from its saved amounts. */}
      {selected && (
        <LogMealForm
          key={`${selected.id}:${selected.revision}`}
          meal={selected}
          pending={log.isPending}
          onLog={(items) => log.mutate({ meal: selected, input: { occurredAt: occurredAt(date, time), timeZone, items } })}
        />
      )}
      {manage}
    </div>
  );
}

function LogMealForm({ meal, pending, onLog }: { meal: SavedMeal; pending: boolean; onLog: (items: Array<{ id: string; amount: number }>) => void }) {
  const [rows, setRows] = useState<MealRow[]>(() => mealRows(meal.items));
  const included = rows.some((row) => row.included);

  // The browser checks each included amount before this runs.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const chosen = chosenAmounts(rows);

    if (chosen && chosen.length > 0) onLog(chosen);
  }

  return (
    <form {...stylex.props(styles.formStack)} onSubmit={submit}>
      <MealItems rows={rows} onChange={setRows} label={`Foods in ${meal.name}`} />
      <Button type="submit" disabled={pending || !included} {...stylex.props(styles.selectedButton)}>Log meal</Button>
    </form>
  );
}
