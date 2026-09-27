import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { Activity as ActivityIcon, Bike, Dumbbell, Flame, Footprints, HeartPulse, PersonStanding, Plus, Watch, Waves } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { activityLabels } from "../overview-dialogs";
import { format, type Activity, type Overview as OverviewData } from "../lib/api";
import { styles } from "../overview-styles";
import { colors } from "../theme.stylex";
import { Caption, DeleteButton, Empty, Section, Stat, Tile, Value, duration } from "./shared";
import { clock } from "../lib/time";

const activityIcons: Record<Activity, ReactNode> = {
  strength: <Dumbbell size={16} />,
  run: <Footprints size={16} />,
  walk: <PersonStanding size={16} />,
  cycle: <Bike size={16} />,
  swim: <Waves size={16} />,
  other: <ActivityIcon size={16} />,
};

type SportsProps = { sports: OverviewData["sports"]; busy: boolean; onLog: () => void; onDelete: (entry: OverviewData["sports"]["entries"][number]) => void };

export function SportsSection({ sports, busy, onLog, onDelete }: SportsProps) {
  const distances = sports.entries.flatMap((entry) => (entry.distanceM === null ? [] : [entry.distanceM]));
  const distanceKm = distances.reduce((sum, meters) => sum + meters, 0) / 1000;

  return (
    <Section
      title="Sports"
      description="Workouts, activities, and data from your wearables."
      icon={<Dumbbell size={18} />}
      color={colors.activity}
      action={<Button variant="outline" size="sm" onClick={onLog}><Plus size={15} /> Log workout</Button>}
    >
      <Tile title="Activity" icon={<ActivityIcon size={16} />}>
        <Value value={sports.totalMinutes === null ? "—" : duration(sports.totalMinutes)} />
        <div {...stylex.props(styles.rows, styles.spaced)}>
          <Stat label="Workouts" value={String(sports.entryCount)} />
          <Stat label="Energy" value={sports.energyKcal === null ? "—" : `${format(sports.energyKcal)} kcal`} />
          <Stat label="Distance" value={distances.length ? `${format(distanceKm, 2)} km` : "—"} />
        </div>
      </Tile>
      <Tile title="Workouts" icon={<Dumbbell size={16} />} aside={`${sports.entryCount} logged`} wide>
        {sports.entries.length === 0 ? (
          <Empty>No workouts logged for this day.</Empty>
        ) : (
          <ul {...stylex.props(styles.list)} aria-label="Logged workouts">
            {sports.entries.map((entry) => (
              <li key={entry.id} {...stylex.props(styles.listRow)}>
                <span {...stylex.props(styles.listIcon(colors.activity))}>{activityIcons[entry.activity]}</span>
                <span {...stylex.props(styles.listText)}>
                  <strong {...stylex.props(styles.listName)}>{activityLabels[entry.activity]}</strong>
                  <small {...stylex.props(styles.listMeta)}>
                    {[clock.format(new Date(entry.occurredAt)), duration(entry.durationMinutes), entry.distanceM === null ? null : `${format(entry.distanceM / 1000, 2)} km`, entry.energyKcal === null ? null : `${format(entry.energyKcal)} kcal`].filter(Boolean).join(" · ")}
                  </small>
                  {entry.strengthExercises?.map((exercise, index) => (
                    <small key={index} {...stylex.props(styles.listMeta)}>
                      {exercise.name} · {exercise.sets} × {exercise.reps}{exercise.weightKg === null ? "" : ` · ${format(exercise.weightKg, 1)} kg`}
                    </small>
                  ))}
                </span>
                <DeleteButton label={`Delete ${activityLabels[entry.activity].toLowerCase()} at ${clock.format(new Date(entry.occurredAt))}`} disabled={busy} onClick={() => onDelete(entry)} />
              </li>
            ))}
          </ul>
        )}
      </Tile>
      <Tile title="Wearables" icon={<Watch size={16} />} aside={<Badge variant="outline">Not connected</Badge>}>
        <div {...stylex.props(styles.rows)}>
          <Stat icon={<Footprints size={14} />} label="Steps" value="—" />
          <Stat icon={<HeartPulse size={14} />} label="Resting heart rate" value="—" />
          <Stat icon={<Flame size={14} />} label="Active energy" value="—" />
        </div>
        <Caption>Apple Health and Health Connect data will appear here once the mobile app syncs it.</Caption>
      </Tile>
    </Section>
  );
}
