import * as stylex from "@stylexjs/stylex";
import { useState, type FormEvent } from "react";
import { ChevronRight, Trash2 } from "lucide-react";
import { styles } from "./form-styles";
import { Button } from "./components/ui/button";
import { MealItems } from "./meal-items";
import { format, type SavedMeal } from "./lib/api";
import { chosenAmounts, includedKcal, mealRows, type MealRow } from "./lib/saved-meals";
import { occurredAt, timeZone } from "./lib/time";
import { useDeleteMeal, useLogMeal, useSavedMeals } from "./lib/use-saved-meals";
import { queryStatus } from "./query-status";

// Logs a saved meal at the dialog's date and time, with the amounts adjusted for this time only.
export function SavedMealsTab({ token, date, time, onLogged }: { token: string; date: string; time: string; onLogged: () => void }) {
  const query = useSavedMeals(token);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const log = useLogMeal(token, onLogged);
  const remove = useDeleteMeal(token);
  const meals = query.data;
  const status = queryStatus(token, query, { disconnected: "Connect your food log to use saved meals.", loading: "Loading your saved meals…" });

  if (status || !meals) return <p {...stylex.props(styles.searchMessage)}>{status}</p>;

  if (meals.length === 0) {
    return <p {...stylex.props(styles.searchMessage)}>No saved meals yet. On the Food page, choose Save as meal next to a meal you logged.</p>;
  }

  const selected = meals.find((meal) => meal.id === selectedId) ?? null;

  return (
    <div {...stylex.props(styles.formStack)}>
      <ul {...stylex.props(styles.mealList)} aria-label="Saved meals">
        {meals.map((meal, index) => (
          <li key={meal.id} {...stylex.props(styles.mealListItem, index > 0 && styles.resultsItemBorder)}>
            <button type="button" {...stylex.props(styles.resultsButton, meal.id === selectedId && styles.resultsButtonSelected)} aria-pressed={meal.id === selectedId} onClick={() => setSelectedId(meal.id)}>
              <span>
                <strong {...stylex.props(styles.resultsText, styles.resultsName)}>{meal.name}</strong>
                <small {...stylex.props(styles.resultsText, styles.resultsMeta)}>
                  {meal.items.length} {meal.items.length === 1 ? "food" : "foods"} · {format(includedKcal(mealRows(meal.items)))} kcal
                </small>
              </span>
              <ChevronRight size={16} />
            </button>
            <Button type="button" variant="ghost" size="icon" {...stylex.props(styles.mealDelete)} aria-label={`Delete saved meal ${meal.name}`} disabled={remove.isPending} onClick={() => remove.mutate(meal)}>
              <Trash2 size={15} />
            </Button>
          </li>
        ))}
      </ul>
      {/* Keyed by meal, so choosing another restarts from its saved amounts. */}
      {selected && (
        <LogMealForm
          key={selected.id}
          meal={selected}
          pending={log.isPending}
          onLog={(items) => log.mutate({ meal: selected, input: { occurredAt: occurredAt(date, time), timeZone, items } })}
        />
      )}
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
