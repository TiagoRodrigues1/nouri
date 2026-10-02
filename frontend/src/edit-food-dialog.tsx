import * as stylex from "@stylexjs/stylex";
import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { styles } from "./form-styles";
import { Button } from "./components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { TimePicker } from "./components/ui/time-picker";
import { updateFood, type FoodEntry } from "./lib/api";
import { dayQueryOptions } from "./lib/day-query";
import { currentTime, dateLabel } from "./lib/time";
import { draftFor, editableRef, editedSubmission, nutrientFields, scaleNutrients, type NutrientText } from "./lib/food-edit";
import { useIdempotentWrite } from "./lib/use-idempotent";
import { queryRefresh } from "./lib/query-refresh";
import type { FoodSubmission } from "../../src/food/contract";

type PendingEdit = { entry: FoodEntry; input: FoodSubmission };

const amountLabels = { g: "Amount in grams", ml: "Amount in millilitres", serving: "Number of servings" } as const;

// Reads the entry from the day's log, so a refresh after a failed save shows what is saved now,
// and an entry deleted meanwhile closes the dialog.
export function EditFoodDialog({ token, date, entryId, onClose }: { token: string; date: string; entryId: string | null; onClose: () => void }) {
  const day = useQuery({ ...dayQueryOptions(token, date), enabled: Boolean(token) && entryId !== null });
  const entry = day.data?.food.entries.find((candidate) => candidate.id === entryId) ?? null;

  // Lives outside the keyed form, so a save survives the form restarting on a new revision.
  // The signature names the revision edited, so a retry reuses its key and a later edit gets a new one.
  const save = useIdempotentWrite<PendingEdit>(token, (pending, key) => updateFood(token, key, pending.entry, pending.input), {
    refresh: queryRefresh.food, success: () => "Food updated.", onSuccess: onClose,
    signature: (pending) => JSON.stringify([pending.entry.id, pending.entry.revision, pending.input]),
  });

  return (
    <Dialog open={entry !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogTitle {...stylex.props(styles.dialogTitle)}>Edit food</DialogTitle>
        <DialogDescription {...stylex.props(styles.dialogDescription)}>
          {entry ? `Changes apply to this entry on ${dateLabel(entry.localDate)}.` : null}
        </DialogDescription>
        {/* Keyed by revision, so an entry changed elsewhere restarts from what is saved now. */}
        {entry && <EditFoodForm key={`${entry.id}:${entry.revision}`} entry={entry} pending={save.isPending} onSave={(input) => save.mutate({ entry, input })} onCancel={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function EditFoodForm({ entry, pending, onSave, onCancel }: { entry: FoodEntry; pending: boolean; onSave: (input: FoodSubmission) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(() => draftFor(entry));
  // The amount and nutrients last typed together, which a new amount scales from.
  const [basis, setBasis] = useState(() => ({ amount: entry.food.quantity.amount, nutrients: draft.nutrients }));
  const catalog = editableRef(entry).catalog !== null;
  const { unit } = entry.food.quantity;

  function changeAmount(amount: string) {
    const to = Number(amount);

    setDraft({ ...draft, amount, nutrients: to > 0 && basis.amount > 0 ? scaleNutrients(basis.nutrients, basis.amount, to) : draft.nutrients });
  }

  function changeNutrient(key: keyof NutrientText, value: string) {
    const nutrients = { ...draft.nutrients, [key]: value };
    const amount = Number(draft.amount);

    setDraft({ ...draft, nutrients });

    if (amount > 0) setBasis({ amount, nutrients });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave(editedSubmission(entry, draft));
  }

  return (
    <form {...stylex.props(styles.formStack)} onSubmit={submit}>
      <div {...stylex.props(styles.timeField)}>
        <Label {...stylex.props(styles.formLabel, styles.timeLabel)} htmlFor="edit-food-time">Time eaten</Label>
        <TimePicker id="edit-food-time" value={draft.time} onChange={(time) => setDraft({ ...draft, time })} onNow={() => setDraft({ ...draft, time: currentTime() })} />
      </div>
      {catalog ? (
        <strong {...stylex.props(styles.selectedName)}>{entry.food.name}</strong>
      ) : (
        <div>
          <Label {...stylex.props(styles.formLabel)} htmlFor="edit-food-name">Food name</Label>
          <Input id="edit-food-name" maxLength={200} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required />
        </div>
      )}
      <div>
        <Label {...stylex.props(styles.formLabel)} htmlFor="edit-food-amount">{amountLabels[unit]}</Label>
        <Input
          id="edit-food-amount"
          type="number"
          min="0.001"
          max={catalog ? "10000" : "1000000"}
          step="0.001"
          value={draft.amount}
          onChange={(event) => changeAmount(event.target.value)}
          required
        />
      </div>
      {catalog ? (
        <p {...stylex.props(styles.fieldHint)}>Nutrition is recalculated from the catalog for the new amount.</p>
      ) : (
        <>
          <p {...stylex.props(styles.formSubhead)}>NUTRITION FOR THIS AMOUNT</p>
          <div {...stylex.props(styles.manualGrid)}>
            {nutrientFields.map(([key, label]) => (
              <div key={key}>
                <Label {...stylex.props(styles.formLabel)} htmlFor={`edit-food-${key}`}>{label}</Label>
                <Input
                  id={`edit-food-${key}`}
                  type="number"
                  min="0"
                  max="1000000"
                  step="0.001"
                  value={draft.nutrients[key]}
                  onChange={(event) => changeNutrient(key, event.target.value)}
                />
              </div>
            ))}
          </div>
          <p {...stylex.props(styles.fieldHint)}>Nutrition scales with the amount. Leave a value empty if you don't know it.</p>
        </>
      )}
      <div {...stylex.props(styles.dialogActions)}>
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={pending}>Save changes</Button>
      </div>
    </form>
  );
}
