import * as stylex from "@stylexjs/stylex";
import type { MuscleMap as Muscles } from "./lib/api";
import { bodySides } from "./lib/body-map";
import { muscleLabels } from "./lib/exercise-library";
import { colors } from "./theme.stylex";

// The sides of the figure that hold a primary muscle, with the primary muscles strong and the secondary ones light.
// It fills the height of its container.
export function MuscleMap({ muscles }: { muscles: Muscles }) {
  const label = [
    `Works ${muscles.primary.map((muscle) => muscleLabels[muscle].toLowerCase()).join(", ")}`,
    muscles.secondary.length > 0 ? `and ${muscles.secondary.map((muscle) => muscleLabels[muscle].toLowerCase()).join(", ")}` : null,
  ].filter(Boolean).join(" ");

  return (
    <span role="img" aria-label={label} title={label} {...stylex.props(styles.figure)}>
      {bodySides(muscles).map(({ side, regions }) => (
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
  figure: { display: "inline-flex", height: "100%", justifyContent: "center", gap: 1 },
  side: { height: "100%", width: "auto" },
  region: { fill: colors.muscleBody },
  primary: { fill: colors.musclePrimary },
  secondary: { fill: colors.muscleSecondary },
});
