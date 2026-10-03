import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Activity as ActivityIcon, Bike, Dumbbell, Footprints, PersonStanding, Waves } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { activityLabels } from "../overview-dialogs";
import { format, type Activity, type Overview as OverviewData } from "../lib/api";
import { styles } from "../overview-styles";
import { colors } from "../theme.stylex";
import { DeleteButton, Empty, Section, Tile, Value, duration } from "./shared";
import { clock } from "../lib/time";
import { providerDetails } from "../lib/wearables";
import { exerciseKey } from "../../../src/workouts/contract";

const activityIcons: Record<Activity, ReactNode> = {
  strength: <Dumbbell size={16} />,
  run: <Footprints size={16} />,
  walk: <PersonStanding size={16} />,
  cycle: <Bike size={16} />,
  swim: <Waves size={16} />,
  other: <ActivityIcon size={16} />,
};

type Entry = OverviewData["sports"]["entries"][number];

type SportsProps = { sports: OverviewData["sports"]; busy: boolean; onDelete: (entry: Entry) => void };

// Imported workouts keep their provider's name, such as "Evening Run", and say where they came from.
function title(entry: Entry): string {
  return (entry.source.kind === "wearable" && entry.source.title) || activityLabels[entry.activity];
}

function origin(entry: Entry): string | null {
  if (entry.source.kind === "manual") return null;
  const service = providerDetails[entry.source.provider].name;

  return entry.source.device ? `${entry.source.device} · ${service}` : service;
}

export function SportsSection({ sports, busy, onDelete }: SportsProps) {
  const distances = sports.entries.flatMap((entry) => (entry.distanceM === null ? [] : [entry.distanceM]));
  const distanceKm = distances.reduce((sum, meters) => sum + meters, 0) / 1000;
  const summary = [`${sports.entryCount} logged`, sports.energyKcal === null ? null : `${format(sports.energyKcal)} kcal`, distances.length ? `${format(distanceKm, 2)} km` : null].filter(Boolean).join(" · ");

  return (
    <Section
      title="Sports"
      description="Workouts you log or import from your wearables."
      icon={<Dumbbell size={18} />}
      color={colors.activity}
    >
      <Tile title="Workouts" icon={<Dumbbell size={16} />} aside={summary} wide>
        <Value value={sports.totalMinutes === null ? "—" : duration(sports.totalMinutes)} />
        {sports.entries.length === 0 ? (
          <Empty>No workouts logged for this day.</Empty>
        ) : (
          <ul {...stylex.props(styles.list)} aria-label="Logged workouts">
            {sports.entries.map((entry) => (
              <li key={entry.id} {...stylex.props(styles.listRow)}>
                <span {...stylex.props(styles.listIcon(colors.activity))}>{activityIcons[entry.activity]}</span>
                <span {...stylex.props(styles.listText)}>
                  <strong {...stylex.props(styles.listName)}>{title(entry)}</strong>
                  <small {...stylex.props(styles.listMeta)}>
                    {[clock.format(new Date(entry.occurredAt)), duration(entry.durationMinutes), entry.distanceM === null ? null : `${format(entry.distanceM / 1000, 2)} km`, entry.energyKcal === null ? null : `${format(entry.energyKcal)} kcal`, origin(entry)].filter(Boolean).join(" · ")}
                  </small>
                  {entry.strengthExercises?.map((exercise, index) => (
                    <small key={index} {...stylex.props(styles.listMeta)}>
                      <Link to="/progress" search={{ date: entry.localDate, exercise: exerciseKey(exercise.name) }} title={`See ${exercise.name} progress`} {...stylex.props(styles.inlineLink)}>{exercise.name}</Link> · {exercise.sets} × {exercise.reps}{exercise.weightKg === null ? "" : ` · ${format(exercise.weightKg, 1)} kg`}
                    </small>
                  ))}
                </span>
                {entry.source.kind !== "manual" ? <Badge variant="outline">Imported</Badge> : <DeleteButton label={`Delete ${activityLabels[entry.activity].toLowerCase()} at ${clock.format(new Date(entry.occurredAt))}`} disabled={busy} onClick={() => onDelete(entry)} />}
              </li>
            ))}
          </ul>
        )}
      </Tile>
    </Section>
  );
}
