import * as stylex from "@stylexjs/stylex";
import { Dumbbell } from "lucide-react";
import { colors } from "./theme.stylex";
import type { LibraryExercise } from "./lib/api";

// Swaps between the start and end photos, like a two-frame GIF: hold each pose, then cross-fade.
const swap = stylex.keyframes({
  "0%, 40%": { opacity: 0 },
  "50%, 90%": { opacity: 1 },
  "100%": { opacity: 0 },
});

type ExerciseImageProps = {
  exercise: LibraryExercise | undefined;
  size: "row" | "card";
  // Shows the movement. The end photo only loads while animating.
  animate: boolean;
};

// The catalog's photos of an exercise, or a dumbbell for custom and logged exercises, which have none.
export function ExerciseImage({ exercise, size, animate }: ExerciseImageProps) {
  const [start, end] = exercise?.origin === "catalog" ? exercise.images : [];

  return (
    <span aria-hidden="true" {...stylex.props(styles.frame, styles[size])}>
      {start ? (
        <>
          <img src={start} alt="" loading="lazy" decoding="async" {...stylex.props(styles.photo)} />
          {animate && end && <img src={end} alt="" decoding="async" {...stylex.props(styles.photo, styles.end)} />}
        </>
      ) : (
        <Dumbbell size={size === "card" ? 22 : 16} />
      )}
    </span>
  );
}

const styles = stylex.create({
  frame: {
    position: "relative",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    overflow: "hidden",
    borderRadius: 6,
    backgroundColor: colors.muted,
    color: colors.mutedForeground,
  },
  row: { width: 48, height: 36 },
  card: { width: 72, height: 48 },
  photo: { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" },
  end: {
    opacity: 0,
    animationName: { default: swap, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: "2.4s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
  },
});
