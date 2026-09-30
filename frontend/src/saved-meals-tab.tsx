import * as stylex from "@stylexjs/stylex";
import { useState, type FormEvent } from "react";
import { ChevronRight, Pencil, Trash2 } from "lucide-react";
import { styles } from "./form-styles";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { MealItems } from "./meal-items";
import { format, type SavedMeal } from "./lib/api";
import { chosenAmounts, includedKcal, mealRows, type MealRow } from "./lib/saved-meals";
import { occurredAt, timeZone } from "./lib/time";
import { useDeleteMeal, useEditMeal, useLogMeal, useSavedMeals } from "./lib/use-saved-meals";
import { queryStatus } from "./query-status";

// Logs a saved meal at the dialog's date and time, with the amounts adjusted for this time only,
// or edits the meal's name and usual amounts in place of the log form.
export function SavedMealsTab({ token, date, time, onLogged }: { token: string; date: string; time: string; onLogged: () => void }) {
  const query = useSavedMeals(token);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const log = useLogMeal(token, onLogged);
  const edit = useEditMeal(token, () => setEditing(false));
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
            <button type="button" {...stylex.props(styles.resultsButton, meal.id === selectedId && styles.resultsButtonSelected)} aria-pressed={meal.id === selectedId} onClick={() => { setSelectedId(meal.id); setEditing(false); }}>
              <span>
                <strong {...stylex.props(styles.resultsText, styles.resultsName)}>{meal.name}</strong>
                <small {...stylex.props(styles.resultsText, styles.resultsMeta)}>
                  {meal.items.length} {meal.items.length === 1 ? "food" : "foods"} · {format(includedKcal(mealRows(meal.items)))} kcal
                </small>
              </span>
              <ChevronRight size={16} />
            </button>
            <Button type="button" variant="ghost" size="icon" {...stylex.props(styles.mealAction)} aria-label={`Edit saved meal ${meal.name}`} title="Edit" onClick={() => { setSelectedId(meal.id); setEditing(true); }}>
              <Pencil size={15} />
            </Button>
            <Button type="button" variant="ghost" size="icon" {...stylex.props(styles.mealAction)} title="Delete" aria-label={`Delete saved meal ${meal.name}`} disabled={remove.isPending} onClick={() => remove.mutate(meal)}>
              <Trash2 size={15} />
            </Button>
          </li>
        ))}
      </ul>
      {/* Keyed by meal and revision, so choosing another or saving an edit restarts from the saved amounts. */}
      {selected && editing && (
        <EditMealForm
          key={`${selected.id}:${selected.revision}`}
          meal={selected}
          pending={edit.isPending}
          onSave={(input) => edit.mutate({ meal: selected, input })}
          onCancel={() => setEditing(false)}
        />
      )}
      {selected && !editing && (
        <LogMealForm
          key={`${selected.id}:${selected.revision}`}
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

// Unticking a food removes it from the meal; a changed amount becomes its usual amount.
function EditMealForm({ meal, pending, onSave, onCancel }: {
  meal: SavedMeal; pending: boolean; onSave: (input: { name: string; items: Array<{ id: string; amount: number }> }) => void; onCancel: () => void;
}) {
  const [name, setName] = useState(meal.name);
  const [rows, setRows] = useState<MealRow[]>(() => mealRows(meal.items));
  const included = rows.some((row) => row.included);

  // The browser checks the name and each included amount before this runs.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const chosen = chosenAmounts(rows);

    if (chosen && chosen.length > 0) onSave({ name: name.trim(), items: chosen });
  }

  return (
    <form {...stylex.props(styles.formStack)} onSubmit={submit}>
      <div>
        <Label {...stylex.props(styles.formLabel)} htmlFor="saved-meal-name">Meal name</Label>
        <Input id="saved-meal-name" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} required />
      </div>
      <MealItems rows={rows} onChange={setRows} label={`Foods kept in ${meal.name}`} />
      <div {...stylex.props(styles.dialogActions)}>
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={pending || !included}>Save changes</Button>
      </div>
    </form>
  );
}
