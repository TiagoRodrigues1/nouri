import * as stylex from "@stylexjs/stylex";
import { useState, type FormEvent } from "react";
import { Button } from "./components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { styles as formStyles } from "./form-styles";
import { activityLevels, ageLimits, sexes, weeklyChangeLimits } from "../../src/profile/contract";
import { defaultTargets, targetLimits, targetsSchema } from "../../src/targets/contract";
import { useSaveTargets, useTargetsQuery } from "./lib/use-targets";
import { useProfileQuery, useSaveProfile } from "./lib/use-profile";
import { format } from "./lib/api";
import type { Profile, ProfileView, SuggestedTargets, Suggestion, Targets } from "./lib/api";
import { selectValue } from "./lib/select-value";
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

// Partial so a suggestion fills only the targets it covers.
function draftFrom<T extends Partial<Targets>>(targets: T): { [K in keyof T]: string } {
  // SAFETY: the entries are exactly the keys of `targets`, each mapped to a string.
  return Object.fromEntries(fieldList.filter(({ key }) => key in targets).map(({ key, scale = 1 }) => {
    const value = targets[key];

    return [key, value == null ? "" : String(value / scale)];
  })) as { [K in keyof T]: string };
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
  const query = useTargetsQuery(today, open);
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
      <ProfileSuggestion date={date} onSuggest={(suggested) => setDraft((current) => ({ ...current, ...draftFrom(suggested) }))} />
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

const sexLabels: Record<Profile["sex"], string> = { female: "Female", male: "Male" };

const activityLabels: Record<Profile["activity"], string> = {
  sedentary: "Sedentary: little exercise",
  light: "Light: exercise 1–3 days a week",
  moderate: "Moderate: exercise 3–5 days a week",
  active: "Active: exercise 6–7 days a week",
  "very-active": "Very active: hard daily training or physical work",
};

// Every rate the API accepts, fastest loss first.
const weeklyChanges = Array.from(
  { length: (weeklyChangeLimits.max - weeklyChangeLimits.min) / weeklyChangeLimits.step + 1 },
  (_, index) => weeklyChangeLimits.min + index * weeklyChangeLimits.step,
);

function weeklyChangeLabel(kg: number): string {
  if (kg === 0) return "Maintain weight";

  return `${kg < 0 ? "Lose" : "Gain"} ${format(Math.abs(kg), 2)} kg a week`;
}

// What the suggested energy does to weight, saying so when a cut is slower than asked.
function expectedChange({ expectedWeeklyChangeKg }: Suggestion["basis"], asked: number): string {
  if (expectedWeeklyChangeKg === 0) return "keeps your weight steady";

  const change = `${expectedWeeklyChangeKg < 0 ? "loses" : "gains"} about ${format(Math.abs(expectedWeeklyChangeKg), 2)} kg a week`;

  return asked < 0 && expectedWeeklyChangeKg > asked ? `${change}, since a cut stays above resting energy` : change;
}

// The profile form keeps age as text while typing and stores a birth year, which does not go stale.
type ProfileDraft = Omit<Profile, "birthYear"> & { age: string };

function profileDraftFrom(profile: Profile | null, date: string): ProfileDraft {
  if (!profile) return { sex: "female", age: "", activity: "moderate", weeklyChangeKg: 0 };

  const { birthYear, ...rest } = profile;

  return { ...rest, age: String(Number(date.slice(0, 4)) - birthYear) };
}

// Names the measurements left to log. The section saves the profile itself and checks the age before saving.
function missingMeasurements(missing: ProfileView["missing"]): string | null {
  const measurements = missing.filter((item) => item === "weight" || item === "height");

  return measurements.length > 0 ? `Log your ${measurements.join(" and ")} on Overview to get a suggestion.` : null;
}

type ProfileSuggestionProps = { date: string; onSuggest: (targets: SuggestedTargets) => void };

// Suggests nutrition targets without saving them: they fill the form, and the person saves the targets as usual.
function ProfileSuggestion({ date, onSuggest }: ProfileSuggestionProps) {
  const query = useProfileQuery(date);
  const status = query.data ? null : queryStatus(query, "Loading your profile…");

  return (
    <fieldset {...stylex.props(styles.group)}>
      <legend {...stylex.props(formStyles.formSubhead)}>SUGGEST FROM PROFILE</legend>
      {status && (
        <p {...stylex.props(query.isError ? formStyles.connectionError : formStyles.dialogDescription)} role={query.isError ? "alert" : undefined}>{status}</p>
      )}
      {query.data && <ProfileFields date={date} view={query.data} onSuggest={onSuggest} />}
    </fieldset>
  );
}

function ProfileFields({ date, view, onSuggest }: { date: string; view: ProfileView; onSuggest: ProfileSuggestionProps["onSuggest"] }) {
  const [draft, setDraft] = useState(() => profileDraftFrom(view.profile, date));
  const [invalid, setInvalid] = useState("");
  const [suggested, setSuggested] = useState<{ suggestion: Suggestion; asked: number } | null>(null);
  const save = useSaveProfile(date);
  const age = Number(draft.age);

  function suggest() {
    if (draft.age.trim() === "" || !Number.isInteger(age) || age < ageLimits.min || age > ageLimits.max) {
      setInvalid(`Enter an age from ${ageLimits.min} to ${ageLimits.max}.`);

      return;
    }

    setInvalid("");

    const { age: _age, ...rest } = draft;

    save.mutate({ ...rest, birthYear: Number(date.slice(0, 4)) - age }, {
      onSuccess: ({ suggestion }) => {
        setSuggested(suggestion && { suggestion, asked: rest.weeklyChangeKg });

        if (suggestion) onSuggest(suggestion.targets);
      },
    });
  }

  const missing = missingMeasurements(view.missing);

  return (
    <>
      <p {...stylex.props(formStyles.dialogDescription)}>
        Uses your latest weight and height from Overview. Sex and age are only used in the energy formula.
      </p>
      <div {...stylex.props(formStyles.manualGrid)}>
        <div>
          <Label htmlFor="profile-sex" {...stylex.props(formStyles.formLabel)}>Sex</Label>
          <Select value={draft.sex} onValueChange={(next) => setDraft({ ...draft, sex: selectValue(sexes, next, "female") })}>
            <SelectTrigger id="profile-sex" {...stylex.props(formStyles.selectTrigger)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sexes.map((sex) => <SelectItem key={sex} value={sex}>{sexLabels[sex]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="profile-age" {...stylex.props(formStyles.formLabel)}>Age (years)</Label>
          <Input
            id="profile-age"
            type="number"
            inputMode="numeric"
            min={ageLimits.min}
            max={ageLimits.max}
            step={1}
            value={draft.age}
            onChange={(event) => setDraft({ ...draft, age: event.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="profile-activity" {...stylex.props(formStyles.formLabel)}>Activity</Label>
          <Select value={draft.activity} onValueChange={(next) => setDraft({ ...draft, activity: selectValue(activityLevels, next, "moderate") })}>
            <SelectTrigger id="profile-activity" {...stylex.props(formStyles.selectTrigger)}>
              <SelectValue>{activityLabels[draft.activity].split(":")[0]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {activityLevels.map((level) => <SelectItem key={level} value={level}>{activityLabels[level]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="profile-goal" {...stylex.props(formStyles.formLabel)}>Goal</Label>
          <Select value={String(draft.weeklyChangeKg)} onValueChange={(next) => setDraft({ ...draft, weeklyChangeKg: Number(next) })}>
            <SelectTrigger id="profile-goal" {...stylex.props(formStyles.selectTrigger)}>
              <SelectValue>{weeklyChangeLabel(draft.weeklyChangeKg)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {weeklyChanges.map((kg) => <SelectItem key={kg} value={String(kg)}>{weeklyChangeLabel(kg)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      {(invalid || save.error) && (
        <p {...stylex.props(formStyles.connectionError)} role="alert">{invalid || save.error?.message}</p>
      )}
      {suggested ? (
        <p {...stylex.props(formStyles.dialogDescription)} role="status">
          Filled in energy, macros, and water for {format(suggested.suggestion.basis.weightKg, 1)} kg, {format(suggested.suggestion.basis.heightCm)} cm, age {suggested.suggestion.basis.age}.
          Maintenance is about {format(suggested.suggestion.basis.maintenanceKcal)} kcal, and {format(suggested.suggestion.targets.kcal)} kcal {expectedChange(suggested.suggestion.basis, suggested.asked)}. Check them, then save.
        </p>
      ) : missing && (
        <p {...stylex.props(formStyles.dialogDescription)} role="status">{missing}</p>
      )}
      <div>
        <Button type="button" variant="outline" disabled={save.isPending} onClick={suggest}>
          {save.isPending ? "Suggesting…" : "Suggest targets"}
        </Button>
      </div>
    </>
  );
}

const styles = stylex.create({
  group: { border: "none", margin: 0, padding: 0, display: "grid", gap: 10 },
  actions: { justifyContent: "space-between" },
});
