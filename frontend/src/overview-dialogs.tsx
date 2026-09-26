import * as stylex from "@stylexjs/stylex";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "./components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { TimePicker } from "./components/ui/time-picker";
import { styles as formStyles } from "./form-styles";
import type { MeasurementInput } from "../../src/measurements/contract";
import type { StrengthExercise, WorkoutInput } from "../../src/workouts/contract";
import type { SleepInput } from "../../src/sleep/contract";
import { activities } from "../../src/workouts/contract";
import { measurementKinds, measurementLimits } from "../../src/measurements/contract";
import { currentTime, dateLabel, occurredAt, shiftDate, timeZone, type Activity, type MeasurementKind } from "./lib/api";

export const measurementLabels: Record<MeasurementKind, { name: string; unit: string; step: number }> = {
  weight: { name: "Weight", unit: "kg", step: 0.1 },
  height: { name: "Height", unit: "cm", step: 0.5 },
  "body-fat": { name: "Body fat", unit: "%", step: 0.1 },
  waist: { name: "Waist", unit: "cm", step: 0.5 },
};

export const activityLabels: Record<Activity, string> = {
  strength: "Strength training",
  run: "Run",
  walk: "Walk",
  cycle: "Cycling",
  swim: "Swim",
  other: "Other",
};

const stageFields = [
  { key: "light", label: "Light" },
  { key: "deep", label: "Deep" },
  { key: "rem", label: "REM" },
  { key: "awake", label: "Awake" },
] as const;

type StageKey = (typeof stageFields)[number]["key"];

type FormProps<Input> = {
  date: string;
  pending: boolean;
  onSave: (input: Input) => void;
};

type RecordDialogProps<Input> = FormProps<Input> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// The form mounts only while the dialog is open, so each opening starts from empty fields and the current time.
function RecordDialog({ open, onOpenChange, title, description, children }: Pick<RecordDialogProps<unknown>, "open" | "onOpenChange"> & { title: string; description: string; children: ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle {...stylex.props(formStyles.dialogTitle)}>{title}</DialogTitle>
        <DialogDescription {...stylex.props(formStyles.dialogDescription)}>{description}</DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function MeasurementDialog({ open, onOpenChange, ...props }: RecordDialogProps<MeasurementInput>) {
  return (
    <RecordDialog open={open} onOpenChange={onOpenChange} title="Log a measurement" description={`Record a body measurement for ${dateLabel(props.date)}.`}>
      <MeasurementForm {...props} />
    </RecordDialog>
  );
}

function MeasurementForm({ date, pending, onSave }: FormProps<MeasurementInput>) {
  const [kind, setKind] = useState<MeasurementKind>("weight");
  const [value, setValue] = useState("");
  const [time, setTime] = useState(currentTime);
  const { unit, step } = measurementLabels[kind];
  const limits = measurementLimits[kind];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave({ occurredAt: occurredAt(date, time), timeZone, kind, value: Number(value) });
  }

  return (
    <form {...stylex.props(formStyles.formStack)} onSubmit={submit}>
      <div {...stylex.props(formStyles.manualGrid)}>
        <div>
          <Label htmlFor="measurement-kind" {...stylex.props(formStyles.formLabel)}>Measurement</Label>
          <Select value={kind} onValueChange={(next) => setKind(measurementKinds.find((option) => option === next) ?? "weight")}>
            <SelectTrigger id="measurement-kind" {...stylex.props(formStyles.selectTrigger)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {measurementKinds.map((option) => (
                <SelectItem key={option} value={option}>
                  {measurementLabels[option].name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="measurement-value" {...stylex.props(formStyles.formLabel)}>Value ({unit})</Label>
          <Input id="measurement-value" type="number" inputMode="decimal" min={limits.min} max={limits.max} step={step} value={value} onChange={(event) => setValue(event.target.value)} required />
        </div>
      </div>
      <div {...stylex.props(formStyles.timeField)}>
        <Label htmlFor="measurement-time" {...stylex.props(formStyles.formLabel, formStyles.timeLabel)}>Time</Label>
        <TimePicker id="measurement-time" value={time} onChange={setTime} onNow={() => setTime(currentTime())} />
      </div>
      <div {...stylex.props(formStyles.dialogActions)}>
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save measurement"}</Button>
      </div>
    </form>
  );
}

export function WorkoutDialog({ open, onOpenChange, ...props }: RecordDialogProps<WorkoutInput>) {
  return (
    <RecordDialog open={open} onOpenChange={onOpenChange} title="Log a workout" description={`Add a workout or activity to ${dateLabel(props.date)}.`}>
      <WorkoutForm {...props} />
    </RecordDialog>
  );
}

function WorkoutForm({ date, pending, onSave }: FormProps<WorkoutInput>) {
  const [activity, setActivity] = useState<Activity>("run");
  const [time, setTime] = useState(currentTime);
  const [exercises, setExercises] = useState(() => [{ id: crypto.randomUUID(), name: "", sets: "", reps: "", weight: "" }]);

  function updateExercise(id: string, field: "name" | "sets" | "reps" | "weight", value: string) {
    setExercises((current) => current.map((exercise) => exercise.id === id ? { ...exercise, [field]: value } : exercise));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const optional = (name: string, scale = 1) => (data.get(name) ? Math.round(Number(data.get(name)) * scale) : null);

    onSave({
      occurredAt: occurredAt(date, time),
      timeZone,
      activity,
      durationMinutes: Number(data.get("duration")),
      distanceM: activity === "strength" ? null : optional("distance", 1000),
      energyKcal: optional("energy"),
      strengthExercises: activity === "strength" && exercises.length > 0
        ? exercises.map((exercise): StrengthExercise => ({
          name: exercise.name.trim(),
          sets: Number(exercise.sets),
          reps: Number(exercise.reps),
          weightKg: exercise.weight === "" ? null : Number(exercise.weight),
        }))
        : null,
    });
  }

  return (
    <form {...stylex.props(formStyles.formStack)} onSubmit={submit}>
      <div {...stylex.props(formStyles.manualGrid)}>
        <div>
          <Label htmlFor="workout-activity" {...stylex.props(formStyles.formLabel)}>Activity</Label>
          <Select value={activity} onValueChange={(next) => setActivity(activities.find((option) => option === next) ?? "other")}>
            <SelectTrigger id="workout-activity" {...stylex.props(formStyles.selectTrigger)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {activities.map((option) => (
                <SelectItem key={option} value={option}>
                  {activityLabels[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="workout-duration" {...stylex.props(formStyles.formLabel)}>Duration (min)</Label>
          <Input id="workout-duration" name="duration" type="number" inputMode="numeric" min={1} max={1440} step={1} required />
        </div>
        {activity !== "strength" && (
          <div>
            <Label htmlFor="workout-distance" {...stylex.props(formStyles.formLabel)}>Distance (km, optional)</Label>
            <Input id="workout-distance" name="distance" type="number" inputMode="decimal" min={0.01} max={1000} step={0.01} />
          </div>
        )}
        <div>
          <Label htmlFor="workout-energy" {...stylex.props(formStyles.formLabel)}>Energy (kcal, optional)</Label>
          <Input id="workout-energy" name="energy" type="number" inputMode="numeric" min={0} max={10000} step={1} />
        </div>
      </div>
      {activity === "strength" && (
        <div {...stylex.props(styles.exerciseList)}>
          <p {...stylex.props(formStyles.formSubhead)}>EXERCISES</p>
          {exercises.map((exercise, index) => (
            <div key={exercise.id} {...stylex.props(styles.exerciseCard)}>
              <div {...stylex.props(styles.exerciseHeader)}>
                <strong>Exercise {index + 1}</strong>
                <Button type="button" variant="ghost" size="sm" onClick={() => setExercises((current) => current.filter((item) => item.id !== exercise.id))}>Remove</Button>
              </div>
              <div>
                <Label htmlFor={`exercise-name-${exercise.id}`} {...stylex.props(formStyles.formLabel)}>Exercise name</Label>
                <Input id={`exercise-name-${exercise.id}`} placeholder="e.g. Squat" maxLength={80} value={exercise.name} onChange={(event) => updateExercise(exercise.id, "name", event.target.value)} required />
              </div>
              <div {...stylex.props(styles.exerciseFields)}>
                <div>
                  <Label htmlFor={`exercise-sets-${exercise.id}`} {...stylex.props(formStyles.formLabel)}>Sets</Label>
                  <Input id={`exercise-sets-${exercise.id}`} type="number" inputMode="numeric" min={1} max={100} step={1} value={exercise.sets} onChange={(event) => updateExercise(exercise.id, "sets", event.target.value)} required />
                </div>
                <div>
                  <Label htmlFor={`exercise-reps-${exercise.id}`} {...stylex.props(formStyles.formLabel)}>Reps per set</Label>
                  <Input id={`exercise-reps-${exercise.id}`} type="number" inputMode="numeric" min={1} max={1000} step={1} value={exercise.reps} onChange={(event) => updateExercise(exercise.id, "reps", event.target.value)} required />
                </div>
                <div>
                  <Label htmlFor={`exercise-weight-${exercise.id}`} {...stylex.props(formStyles.formLabel)}>Weight (kg, optional)</Label>
                  <Input id={`exercise-weight-${exercise.id}`} type="number" inputMode="decimal" min={0} max={1000} step={0.1} value={exercise.weight} onChange={(event) => updateExercise(exercise.id, "weight", event.target.value)} />
                </div>
              </div>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" disabled={exercises.length >= 30} onClick={() => setExercises((current) => [...current, { id: crypto.randomUUID(), name: "", sets: "", reps: "", weight: "" }])}>Add exercise</Button>
        </div>
      )}
      <div {...stylex.props(formStyles.timeField)}>
        <Label htmlFor="workout-time" {...stylex.props(formStyles.formLabel, formStyles.timeLabel)}>Started at</Label>
        <TimePicker id="workout-time" value={time} onChange={setTime} onNow={() => setTime(currentTime())} />
      </div>
      <div {...stylex.props(formStyles.dialogActions)}>
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save workout"}</Button>
      </div>
    </form>
  );
}

function minutesBetween(bed: string, wake: string): number {
  const [bedHours, bedMinutes] = bed.split(":").map(Number);
  const [wakeHours, wakeMinutes] = wake.split(":").map(Number);
  const length = wakeHours * 60 + wakeMinutes - (bedHours * 60 + bedMinutes);

  return length > 0 ? length : length + 1440;
}

export function SleepDialog({ open, onOpenChange, ...props }: RecordDialogProps<SleepInput>) {
  return (
    <RecordDialog open={open} onOpenChange={onOpenChange} title="Log sleep" description={`Record the night that ended on ${dateLabel(props.date)}.`}>
      <SleepForm {...props} />
    </RecordDialog>
  );
}

function SleepForm({ date, pending, onSave }: FormProps<SleepInput>) {
  const [bed, setBed] = useState("23:00");
  const [wake, setWake] = useState("07:00");
  const [stages, setStages] = useState<Record<StageKey, string>>({ light: "", deep: "", rem: "", awake: "" });
  const length = minutesBetween(bed, wake);
  const staged = Object.values(stages).some(Boolean);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A bedtime at or after the wake time means the night began the day before.
    const bedDate = bed >= wake ? shiftDate(date, -1) : date;

    onSave({
      startedAt: occurredAt(bedDate, bed),
      endedAt: occurredAt(date, wake),
      timeZone,
      stages: staged ? { light: Number(stages.light), deep: Number(stages.deep), rem: Number(stages.rem), awake: Number(stages.awake) } : null,
    });
  }

  return (
    <form {...stylex.props(formStyles.formStack)} onSubmit={submit}>
      <div {...stylex.props(styles.times)}>
        <div {...stylex.props(formStyles.timeField, styles.timeField)}>
          <Label htmlFor="sleep-bed" {...stylex.props(formStyles.formLabel, formStyles.timeLabel)}>Fell asleep</Label>
          <TimePicker id="sleep-bed" value={bed} onChange={setBed} onNow={() => setBed(currentTime())} />
        </div>
        <div {...stylex.props(formStyles.timeField, styles.timeField)}>
          <Label htmlFor="sleep-wake" {...stylex.props(formStyles.formLabel, formStyles.timeLabel)}>Woke up</Label>
          <TimePicker id="sleep-wake" value={wake} onChange={setWake} onNow={() => setWake(currentTime())} />
        </div>
        <span {...stylex.props(styles.length)}>{Math.floor(length / 60)} h {length % 60} min</span>
      </div>
      <p {...stylex.props(formStyles.formSubhead)}>SLEEP STAGES, MINUTES (OPTIONAL)</p>
      <div {...stylex.props(styles.stages)}>
        {stageFields.map((field) => (
          <div key={field.key}>
            <Label htmlFor={`sleep-${field.key}`} {...stylex.props(formStyles.formLabel)}>{field.label}</Label>
            <Input
              id={`sleep-${field.key}`}
              type="number"
              inputMode="numeric"
              min={0}
              max={length}
              step={1}
              value={stages[field.key]}
              onChange={(event) => setStages({ ...stages, [field.key]: event.target.value })}
              required={staged}
            />
          </div>
        ))}
      </div>
      <p {...stylex.props(formStyles.fieldHint)}>Fill in all four stages from your tracker, or leave them empty.</p>
      <div {...stylex.props(formStyles.dialogActions)}>
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save sleep"}</Button>
      </div>
    </form>
  );
}

const styles = stylex.create({
  exerciseList: { display: "grid", gap: 12 },
  exerciseCard: { display: "grid", gap: 12, padding: 14, borderWidth: 1, borderStyle: "solid", borderColor: "#e1e4e5", borderRadius: 8 },
  exerciseHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 },
  exerciseFields: { display: "grid", gridTemplateColumns: { default: "repeat(3, minmax(0, 1fr))", "@media (max-width: 520px)": "1fr 1fr" }, gap: 10 },
  times: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 20px" },
  timeField: { marginBottom: 0 },
  length: { marginLeft: "auto", fontSize: 13, fontWeight: 600 },
  stages: {
    display: "grid",
    gridTemplateColumns: { default: "repeat(4, minmax(0, 1fr))", "@media (max-width: 520px)": "repeat(2, minmax(0, 1fr))" },
    gap: 12,
  },
});
