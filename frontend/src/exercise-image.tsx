import * as stylex from "@stylexjs/stylex";
import { Dumbbell } from "lucide-react";
import { colors } from "./theme.stylex";
import { exerciseMuscles } from "./lib/body-map";
import type { LibraryExercise } from "./lib/api";
import { MuscleMap } from "./muscle-map";

type ExerciseImageProps = {
  exercise: LibraryExercise | undefined;
  size: "row" | "card";
};

// The figure with the muscles an exercise works, or a dumbbell for a logged name, which has no muscles. It is
// decoration: the muscle is always written beside it.
export function ExerciseImage({ exercise, size }: ExerciseImageProps) {
  const muscles = exerciseMuscles(exercise);

  return (
    <span aria-hidden="true" {...stylex.props(styles.frame, styles[size])}>
      {muscles ? <MuscleMap muscles={muscles} /> : <Dumbbell size={size === "card" ? 22 : 16} />}
    </span>
  );
}

const styles = stylex.create({
  frame: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    padding: 3,
    borderRadius: 6,
    backgroundColor: colors.muted,
    color: colors.mutedForeground,
  },
  row: { width: 44, height: 44 },
  card: { width: 60, height: 60 },
});
