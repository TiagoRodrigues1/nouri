import * as stylex from "@stylexjs/stylex";
import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { styles } from "./form-styles";
import { Button } from "./components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { MealItems } from "./meal-items";
import type { FoodEntry } from "./lib/api";
import { dayQueryOptions } from "./lib/day-query";
import { chosenAmounts, maxMealItems, mealRows, type MealRow } from "./lib/saved-meals";
import { useSaveMeal } from "./lib/use-saved-meals";

// Which foods the dialog starts with, and a name for them.
export type MealSelection = { entryIds: string[]; name: string };

// Offers every food of the day, with the chosen ones ticked, so a meal can gather foods from several times.
export function SaveMealDialog({ token, date, selection, onClose }: { token: string; date: string; selection: MealSelection | null; onClose: () => void }) {
  const day = useQuery({ ...dayQueryOptions(token, date), enabled: Boolean(token) && selection !== null });
  const entries = day.data?.food.entries ?? [];
  const save = useSaveMeal(token, onClose);

  return (
    <Dialog open={selection !== null && entries.length > 0} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogTitle {...stylex.props(styles.dialogTitle)}>Save as meal</DialogTitle>
        <DialogDescription {...stylex.props(styles.dialogDescription)}>
          Keep these foods and amounts together, then log them in one step from + Log, then Food. Later changes to this day don't change the meal.
        </DialogDescription>
        {selection && entries.length > 0 && (
          <SaveMealForm key={selection.entryIds.join()} entries={entries} selection={selection} pending={save.isPending} onSave={(input) => save.mutate(input)} onCancel={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function SaveMealForm({ entries, selection, pending, onSave, onCancel }: {
  entries: FoodEntry[]; selection: MealSelection; pending: boolean; onSave: (input: { name: string; items: Array<{ entryId: string; amount: number }> }) => void; onCancel: () => void;
}) {
  const [name, setName] = useState(selection.name);
  const [rows, setRows] = useState<MealRow[]>(() => mealRows(entries, (id) => selection.entryIds.includes(id)));
  const count = rows.filter((row) => row.included).length;

  // The browser checks each included amount before this runs.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const chosen = chosenAmounts(rows);

    if (chosen && count > 0 && count <= maxMealItems) onSave({ name: name.trim(), items: chosen.map(({ id, amount }) => ({ entryId: id, amount })) });
  }

  return (
    <form {...stylex.props(styles.formStack)} onSubmit={submit}>
      <div>
        <Label {...stylex.props(styles.formLabel)} htmlFor="meal-name">Meal name</Label>
        <Input id="meal-name" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} required />
      </div>
      <MealItems rows={rows} onChange={setRows} label="Foods in this meal" />
      {count > maxMealItems && <p {...stylex.props(styles.connectionError)} role="alert">A meal holds up to {maxMealItems} foods.</p>}
      <div {...stylex.props(styles.dialogActions)}>
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={pending || count === 0 || count > maxMealItems}>Save meal</Button>
      </div>
    </form>
  );
}
