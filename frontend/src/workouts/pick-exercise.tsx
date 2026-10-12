import { ExercisePicker } from "../exercise-picker";

// What the exercise picker is open for: adding an exercise, or replacing one.
export type PickTarget = { kind: "add" } | { kind: "replace"; exerciseId: string };

type PickExerciseProps = {
  target: PickTarget | null;
  onClose: () => void;
  date: string;
  onAdd: (name: string) => void;
  onReplace: (exerciseId: string, name: string) => void;
};

export function PickExercise({ target, onClose, date, onAdd, onReplace }: PickExerciseProps) {
  function pick(name: string) {
    if (target?.kind === "add") onAdd(name);
    else if (target) onReplace(target.exerciseId, name);
  }

  return <ExercisePicker open={target !== null} onOpenChange={(open) => { if (!open) onClose(); }} date={date} onPick={pick} />;
}
