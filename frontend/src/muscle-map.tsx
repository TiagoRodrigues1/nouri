import * as stylex from "@stylexjs/stylex";
import type { MuscleMap as Muscles } from "./lib/api";
import { bodySides } from "./lib/body-map";
import { muscleLabels } from "./lib/exercise-library";
import { colors } from "./theme.stylex";

type MuscleMapProps = {
  muscles: Muscles;
  // A thumbnail shows only the sides holding a primary muscle; full shows the front and the back.
  size: "thumb" | "full";
};

// The figure with the primary muscles strong and the secondary ones light.
export function MuscleMap({ muscles, size }: MuscleMapProps) {
  const label = [
    `Works ${muscles.primary.map((muscle) => muscleLabels[muscle].toLowerCase()).join(", ")}`,
    muscles.secondary.length > 0 ? `and ${muscles.secondary.map((muscle) => muscleLabels[muscle].toLowerCase()).join(", ")}` : null,
  ].filter(Boolean).join(" ");

  return (
    <span role="img" aria-label={label} title={label} {...stylex.props(styles.figure, styles[size])}>
      {bodySides(muscles, size === "thumb" ? "primary" : "all").map(({ side, regions }) => (
        <svg key={side} viewBox="0 0 100 220" aria-hidden="true" {...stylex.props(styles.side)}>
          {regions.flatMap(({ slug, polygons, intensity }) => polygons.map((points, index) => (
            <polygon key={`${slug}-${index}`} points={points} {...stylex.props(styles.region, intensity === "primary" ? styles.primary : intensity === "secondary" ? styles.secondary : null)} />
          )))}
        </svg>
      ))}
    </span>
  );
}

const styles = stylex.create({
  figure: { display: "inline-flex", flexShrink: 0, justifyContent: "center", gap: 2 },
  thumb: { height: 56 },
  full: { height: 160, gap: 12 },
  side: { height: "100%", width: "auto" },
  region: { fill: colors.muscleBody, transitionProperty: "fill", transitionDuration: "200ms" },
  primary: { fill: colors.musclePrimary },
  secondary: { fill: colors.muscleSecondary },
});
