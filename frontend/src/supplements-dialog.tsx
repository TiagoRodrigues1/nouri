import * as stylex from "@stylexjs/stylex";
import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "./components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "./components/ui/toggle-group";
import { styles as formStyles } from "./form-styles";
import { colors } from "./theme.stylex";
import { doseUnits, maxStackSize, maxTimesPerDay, supplementKinds, supplementStackSchema } from "../../src/supplements/contract";
import type { Supplement } from "./lib/api";
import { localDate } from "./lib/time";
import { kindLabels } from "./lib/supplements";
import { useSaveSupplementStack, useSupplementStack } from "./lib/use-supplements";
import { queryStatus } from "./query-status";
import { useExitingRows } from "./lib/use-exiting-rows";
import { selectValue } from "./lib/select-value";
import { weekdayNames } from "./lib/weekdays";

const timesPerDay = Array.from({ length: maxTimesPerDay }, (_, index) => index + 1);

// The amount stays text while typing, so a half-typed "0." is not rewritten under the cursor.
type Draft = Array<Omit<Supplement, "dose"> & { amount: string; unit: Supplement["dose"]["unit"] }>;

function draftFrom(supplements: Supplement[]): Draft {
  return supplements.map(({ dose, ...supplement }) => ({ ...supplement, amount: String(dose.amount), unit: dose.unit }));
}

type SupplementsDialogProps = { open: boolean; onOpenChange: (open: boolean) => void };

export function SupplementsDialog({ open, onOpenChange }: SupplementsDialogProps) {
  // Changes take effect today, so the form edits and saves the list in force on today's date.
  const today = localDate(new Date());
  const query = useSupplementStack(today, open);
  const supplements = query.data?.supplements;
  const status = supplements ? null : queryStatus(query, "Loading your supplements…");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle {...stylex.props(formStyles.dialogTitle)}>Your supplements</DialogTitle>
        <DialogDescription {...stylex.props(formStyles.dialogDescription)}>
          What you take, on which days, and how often. Changes apply from today; earlier days keep the list they had.
        </DialogDescription>
        {status && (
          <p {...stylex.props(query.isError ? formStyles.connectionError : formStyles.dialogDescription)} role={query.isError ? "alert" : undefined}>{status}</p>
        )}
        {/* Keyed by day, so a form left open past midnight restarts from the new day's list. */}
        {supplements && <SupplementsForm key={today} date={today} supplements={supplements} onSaved={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

// Mounted only while the dialog is open, so each opening starts from the list in force today.
function SupplementsForm({ date, supplements, onSaved }: { date: string; supplements: Supplement[]; onSaved: () => void }) {
  const [draft, setDraft] = useState(() => draftFrom(supplements));
  const [invalid, setInvalid] = useState("");
  const { add, remove, rowProps, busy } = useExitingRows();
  const save = useSaveSupplementStack(date);

  function change(id: string, patch: Partial<Draft[number]>) {
    setDraft((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function addSupplement() {
    const id = crypto.randomUUID();
    add(id);
    setDraft([...draft, { id, name: "", kind: "vitamin", amount: "", unit: "mg", schedule: { weekdays: weekdayNames.map((_, index) => index + 1), timesPerDay: 1 } }]);
  }

  function removeSupplement(id: string) {
    remove(id, () => setDraft((current) => current.filter((row) => row.id !== id)));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsed = supplementStackSchema.safeParse({
      supplements: draft.map(({ amount, unit, ...row }) => ({ ...row, dose: { amount: Number(amount), unit } })),
    });

    if (!parsed.success) {
      const path = parsed.error.issues[0]?.path;
      const row = draft.find((_, index) => path?.[0] === "supplements" && path[1] === index);

      setInvalid(row ? `Check ${row.name.trim() || "the unnamed supplement"}.` : "Check your supplements.");

      return;
    }

    setInvalid("");
    save.mutate(parsed.data.supplements, { onSuccess: onSaved });
  }

  return (
    <form {...stylex.props(formStyles.formStack)} onSubmit={submit}>
      {draft.length === 0 ? (
        <p {...stylex.props(styles.empty)}>No supplements yet. Add the vitamins, minerals, creatine, or anything else you take.</p>
      ) : (
        <ul {...stylex.props(styles.list)} aria-label="Supplements">
          {draft.map((row) => (
            <li key={row.id} {...rowProps(row.id)} {...stylex.props(styles.row)}>
              <div {...stylex.props(styles.name)}>
                <Label htmlFor={`supplement-name-${row.id}`} {...stylex.props(formStyles.formLabel)}>Name</Label>
                <Input id={`supplement-name-${row.id}`} value={row.name} maxLength={80} placeholder="Vitamin D3" required onChange={(event) => change(row.id, { name: event.target.value })} />
              </div>
              <div>
                <Label htmlFor={`supplement-kind-${row.id}`} {...stylex.props(formStyles.formLabel)}>Type</Label>
                <Select value={row.kind} onValueChange={(next) => change(row.id, { kind: selectValue(supplementKinds, next, "other") })}>
                  <SelectTrigger id={`supplement-kind-${row.id}`} {...stylex.props(formStyles.selectTrigger)}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {supplementKinds.map((kind) => <SelectItem key={kind} value={kind}>{kindLabels[kind]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor={`supplement-amount-${row.id}`} {...stylex.props(formStyles.formLabel)}>Dose</Label>
                <Input id={`supplement-amount-${row.id}`} type="number" inputMode="decimal" min={0.001} max={100_000} step="any" value={row.amount} required onChange={(event) => change(row.id, { amount: event.target.value })} />
              </div>
              <div>
                <Label htmlFor={`supplement-unit-${row.id}`} {...stylex.props(formStyles.formLabel)}>Unit</Label>
                <Select value={row.unit} onValueChange={(next) => change(row.id, { unit: selectValue(doseUnits, next, "mg") })}>
                  <SelectTrigger id={`supplement-unit-${row.id}`} aria-label="Dose unit" {...stylex.props(formStyles.selectTrigger)}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {doseUnits.map((unit) => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button type="button" variant="ghost" size="icon" {...stylex.props(styles.remove)} aria-label={`Remove ${row.name.trim() || "this supplement"}`} disabled={busy} onClick={() => removeSupplement(row.id)}>
                <Trash2 size={15} />
              </Button>
              <div {...stylex.props(styles.schedule)}>
                {/* At least one day stays on: unpressing the last is ignored. */}
                <ToggleGroup
                  type="multiple"
                  variant="outline"
                  size="sm"
                  spacing={0}
                  aria-label={`Days to take ${row.name.trim() || "this supplement"}`}
                  value={row.schedule.weekdays.map(String)}
                  onValueChange={(next) => { if (next.length > 0) change(row.id, { schedule: { ...row.schedule, weekdays: next.map(Number).toSorted((a, b) => a - b) } }); }}
                >
                  {weekdayNames.map((day, index) => (
                    <ToggleGroupItem key={day} value={String(index + 1)} aria-label={day} {...stylex.props(styles.weekday, row.schedule.weekdays.includes(index + 1) && styles.weekdayOn)}>
                      {day.charAt(0)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <Select value={String(row.schedule.timesPerDay)} onValueChange={(next) => change(row.id, { schedule: { ...row.schedule, timesPerDay: Number(next) } })}>
                  <SelectTrigger aria-label="Times a day" {...stylex.props(formStyles.selectTrigger, styles.times)}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {timesPerDay.map((times) => <SelectItem key={times} value={String(times)}>{times === 1 ? "Once a day" : `${times}× a day`}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </li>
          ))}
        </ul>
      )}
      {(invalid || save.error) && (
        <p {...stylex.props(formStyles.connectionError)} role="alert">{invalid || save.error?.message}</p>
      )}
      <div {...stylex.props(formStyles.dialogActions, styles.actions)}>
        <Button type="button" variant="outline" disabled={draft.length >= maxStackSize} onClick={addSupplement}>
          <Plus size={15} /> Add supplement
        </Button>
        <Button type="submit" disabled={save.isPending || busy}>{save.isPending ? "Saving…" : "Save supplements"}</Button>
      </div>
    </form>
  );
}

const styles = stylex.create({
  empty: { margin: 0, padding: "20px 16px", borderRadius: 10, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, color: colors.mutedForeground, fontSize: 13, textAlign: "center" },
  list: { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12, maxHeight: "50vh", overflowY: "auto" },
  row: {
    display: "grid",
    gridTemplateColumns: { default: "minmax(0, 2fr) minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr) auto", "@media (max-width: 560px)": "1fr 1fr" },
    alignItems: "end",
    gap: 8,
    paddingBottom: 12,
    borderBottomWidth: { default: 1, ":last-child": 0 },
    borderBottomStyle: "solid",
    borderBottomColor: colors.muted,
  },
  name: { gridColumn: { default: "auto", "@media (max-width: 560px)": "1 / -1" } },
  schedule: { gridColumn: "1 / -1", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 },
  weekday: { width: 32 },
  weekdayOn: { backgroundColor: colors.supplements, color: "white", borderColor: colors.supplements },
  times: { width: "auto", minWidth: 120 },
  remove: { width: 36, height: 36, color: colors.mutedForeground },
  actions: { justifyContent: "space-between" },
});
