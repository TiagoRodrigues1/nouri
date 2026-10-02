import * as stylex from "@stylexjs/stylex";
import { useState, type FormEvent } from "react";
import { Button } from "./components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { styles as formStyles } from "./form-styles";
import { defaultTargets, targetLimits, targetsSchema } from "../../src/targets/contract";
import { useSaveTargets, useTargetsQuery } from "./lib/use-targets";
import type { Targets } from "./lib/api";
import { localDate } from "./lib/time";
import { queryStatus } from "./query-status";

type TargetKey = keyof Targets;

const groupTitles = ["NUTRITION", "ACTIVITY", "BODY AND SLEEP"] as const;

// `scale` converts the unit shown in the form to the unit the API stores: sleep is entered in hours.
// `precision` is the decimal places the API stores; `optional` fields save an empty input as null.
type Field = {
  group: (typeof groupTitles)[number];
  label: string;
  unit: string;
  step: number;
  limits: { min: number; max: number };
  scale?: number;
  precision?: number;
  optional?: boolean;
};

// Keyed by target so adding one to the contract fails to compile until the form can edit it.
const fields = {
  kcal: { group: "NUTRITION", label: "Energy", unit: "kcal", step: 1, limits: targetLimits.kcal },
  proteinG: { group: "NUTRITION", label: "Protein", unit: "g", step: 1, limits: targetLimits.proteinG },
  carbsG: { group: "NUTRITION", label: "Carbs", unit: "g", step: 1, limits: targetLimits.carbsG },
  fatG: { group: "NUTRITION", label: "Fat", unit: "g", step: 1, limits: targetLimits.fatG },
  waterMl: { group: "NUTRITION", label: "Water", unit: "ml", step: 1, limits: targetLimits.waterMl },
  fastingHours: { group: "NUTRITION", label: "Fasting", unit: "h", step: 1, limits: targetLimits.fastingHours },
  steps: { group: "ACTIVITY", label: "Steps", unit: "per day", step: 1, limits: targetLimits.steps },
  burnedKcal: { group: "ACTIVITY", label: "Move", unit: "kcal", step: 1, limits: targetLimits.burnedKcal },
  exerciseMinutes: { group: "ACTIVITY", label: "Exercise", unit: "min", step: 1, limits: targetLimits.exerciseMinutes },
  workouts: { group: "ACTIVITY", label: "Workouts", unit: "per day", step: 1, limits: targetLimits.workouts },
  sleepMinutes: { group: "BODY AND SLEEP", label: "Sleep", unit: "h", step: 0.25, scale: 60, limits: targetLimits.sleepMinutes },
  weightKg: { group: "BODY AND SLEEP", label: "Goal weight", unit: "kg", step: 0.1, precision: 1, optional: true, limits: targetLimits.weightKg },
} satisfies Record<TargetKey, Field>;

// SAFETY: `fields` satisfies Record<TargetKey, Field>, so its keys are exactly the target keys.
const fieldList = (Object.entries(fields) as Array<[TargetKey, Field]>).map(([key, field]) => ({ key, ...field }));

const groups = groupTitles.map((title) => ({ title, fields: fieldList.filter((field) => field.group === title) }));

type Draft = Record<TargetKey, string>;

function draftFrom(targets: Targets): Draft {
  // SAFETY: `fieldList` holds every target key once, so the entries cover the whole record.
  return Object.fromEntries(fieldList.map(({ key, scale = 1 }) => {
    const value = targets[key];

    return [key, value === null ? "" : String(value / scale)];
  })) as Draft;
}

function stored({ scale = 1, precision = 0, optional }: Field, input: string): number | null {
  if (input === "" && optional) return null;

  const factor = 10 ** precision;

  return Math.round(Number(input) * scale * factor) / factor;
}

type TargetsDialogProps = { open: boolean; onOpenChange: (open: boolean) => void };

export function TargetsDialog({ open, onOpenChange }: TargetsDialogProps) {
  // Changes take effect today, so the form edits and saves the set in force on today's date.
  const today = localDate(new Date());
  const query = useTargetsQuery(today);
  // Saving replaces the whole set, so the form waits for the saved targets rather than seeding from defaults.
  const targets = query.data?.targets;
  const status = targets ? null : queryStatus(query, "Loading your targets…");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle {...stylex.props(formStyles.dialogTitle)}>Targets</DialogTitle>
        <DialogDescription {...stylex.props(formStyles.dialogDescription)}>
          The daily goals your days are measured against. Changes apply from today; earlier days keep the targets they had.
        </DialogDescription>
        {status && (
          <p {...stylex.props(query.isError ? formStyles.connectionError : formStyles.dialogDescription)} role={query.isError ? "alert" : undefined}>{status}</p>
        )}
        {/* Keyed by day, so a form left open past midnight restarts from the new day's targets. */}
        {targets && <TargetsForm key={today} date={today} targets={targets} onSaved={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

// Mounted only while the dialog is open, so each opening starts from the targets in force today.
function TargetsForm({ date, targets, onSaved }: { date: string; targets: Targets; onSaved: () => void }) {
  const [draft, setDraft] = useState(() => draftFrom(targets));
  const [invalid, setInvalid] = useState("");
  const save = useSaveTargets(date);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const next = Object.fromEntries(fieldList.map((field) => [field.key, stored(field, draft[field.key].trim())]));

    const parsed = targetsSchema.safeParse(next);

    if (!parsed.success) {
      const field = fieldList.find(({ key }) => key === parsed.error.issues[0]?.path[0]);

      setInvalid(`Check the ${field?.label.toLowerCase() ?? "targets"} value.`);

      return;
    }

    setInvalid("");
    save.mutate(parsed.data, { onSuccess: onSaved });
  }

  return (
    <form {...stylex.props(formStyles.formStack)} onSubmit={submit}>
      {groups.map((group) => (
        <fieldset key={group.title} {...stylex.props(styles.group)}>
          <legend {...stylex.props(formStyles.formSubhead)}>{group.title}</legend>
          <div {...stylex.props(formStyles.manualGrid)}>
            {group.fields.map(({ key, label, unit, step, limits, scale = 1, optional }) => (
              <div key={key}>
                <Label htmlFor={`target-${key}`} {...stylex.props(formStyles.formLabel)}>{label} ({unit})</Label>
                <Input
                  id={`target-${key}`}
                  type="number"
                  inputMode="decimal"
                  min={limits.min / scale}
                  max={limits.max / scale}
                  step={step}
                  value={draft[key]}
                  placeholder={optional ? "No goal" : undefined}
                  required={!optional}
                  onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
                />
              </div>
            ))}
          </div>
        </fieldset>
      ))}
      {(invalid || save.error) && (
        <p {...stylex.props(formStyles.connectionError)} role="alert">{invalid || save.error?.message}</p>
      )}
      <div {...stylex.props(formStyles.dialogActions, styles.actions)}>
        <Button type="button" variant="ghost" onClick={() => setDraft(draftFrom(defaultTargets))}>
          Restore defaults
        </Button>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save targets"}</Button>
      </div>
    </form>
  );
}

const styles = stylex.create({
  group: { border: "none", margin: 0, padding: 0, display: "grid", gap: 10 },
  actions: { justifyContent: "space-between" },
});
