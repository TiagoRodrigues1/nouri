import * as stylex from "@stylexjs/stylex";
import { Activity as ActivityIcon, Pencil, Ruler, Scale } from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { measurementLabels } from "../overview-dialogs";
import { format, type Overview as OverviewData, type Photo } from "../lib/api";
import { styles } from "../overview-styles";
import { colors } from "../theme.stylex";
import { clock, dateLabel } from "../lib/time";
import { DeleteButton, Empty, Section, Sparkline, Stat, Tile, Value, Caption } from "./shared";
import { PhotosTile } from "./photos";

type MeasurementsProps = {
  date: string;
  measurements: OverviewData["measurements"];
  weightGoalKg: number | null;
  photos: Photo[];
  busy: boolean;
  onEdit: (entry: OverviewData["measurements"]["entries"][number]) => void;
  onDelete: (entry: OverviewData["measurements"]["entries"][number]) => void;
  onUpload: (file: File) => void;
  onDeletePhoto: (photo: Photo) => void;
};

// The WHO adult categories.
function bmiCategory(bmi: number): string {
  if (bmi < 18.5) return "Underweight";

  if (bmi < 25) return "Healthy range";

  if (bmi < 30) return "Overweight";

  return "Obesity";
}

function goalProgress(weight: number | undefined, goal: number): string {
  if (weight === undefined) return `Goal ${format(goal, 1)} kg`;
  const gap = Math.abs(weight - goal);

  return gap < 0.05 ? `At your ${format(goal, 1)} kg goal` : `${format(gap, 1)} kg from your ${format(goal, 1)} kg goal`;
}

export function MeasurementsSection({ date, measurements, weightGoalKg, photos, busy, onEdit, onDelete, onUpload, onDeletePhoto }: MeasurementsProps) {
  const { latest, bmi, weightChange } = measurements;
  const asOf = (recorded: { localDate: string } | null) => (recorded && recorded.localDate !== date ? `Recorded ${dateLabel(recorded.localDate)}` : "Recorded this day");

  return (
    <Section
      title="Measurements"
      description="Body measurements carry forward until you record a new value."
      icon={<Ruler size={18} />}
      color={colors.measurements}
    >
      <Tile
        title="Weight"
        icon={<Scale size={16} />}
        aside={weightChange === null ? null : <Badge variant="secondary">{weightChange > 0 ? "+" : ""}{format(weightChange, 1)} kg</Badge>}
      >
        <Value value={format(latest.weight?.value, 1)} unit="kg" />
        <Sparkline points={measurements.weightHistory.map((point) => point.value)} />
        <Caption>{latest.weight ? asOf(latest.weight) : "No weight recorded yet"}</Caption>
        {weightGoalKg !== null && <Caption>{goalProgress(latest.weight?.value, weightGoalKg)}</Caption>}
      </Tile>
      <Tile title="BMI" icon={<ActivityIcon size={16} />} aside={bmi === null ? null : <Badge variant="secondary">{bmiCategory(bmi)}</Badge>}>
        <Value value={format(bmi, 1)} />
        <Caption>
          {bmi === null ? "Record your weight and height to see your BMI." : `From ${format(latest.weight?.value, 1)} kg and ${format(latest.height?.value)} cm`}
        </Caption>
      </Tile>
      <Tile title="Body" icon={<Ruler size={16} />}>
        <div {...stylex.props(styles.rows)}>
          {(["height", "body-fat", "waist"] as const).map((kind) => (
            <Stat
              key={kind}
              label={measurementLabels[kind].name}
              value={latest[kind] ? `${format(latest[kind].value, 1)} ${measurementLabels[kind].unit}` : "—"}
            />
          ))}
        </div>
      </Tile>
      <Tile title="Logged this day" icon={<Ruler size={16} />} aside={`${measurements.entries.length} logged`}>
        {measurements.entries.length === 0 ? (
          <Empty>No measurements logged for this day.</Empty>
        ) : (
          <ul {...stylex.props(styles.list)} aria-label="Logged measurements">
            {measurements.entries.map((entry) => {
              const { name, unit } = measurementLabels[entry.kind];

              return (
                <li key={entry.id} {...stylex.props(styles.listRow)}>
                  <span {...stylex.props(styles.listText)}>
                    <strong {...stylex.props(styles.listName)}>{name}</strong>
                    <small {...stylex.props(styles.listMeta)}>{clock.format(new Date(entry.occurredAt))}</small>
                  </span>
                  <span {...stylex.props(styles.rowValue)}>{format(entry.value, 1)} {unit}</span>
                  <Button variant="ghost" size="icon" {...stylex.props(styles.delete)} aria-label={`Edit ${name.toLowerCase()} ${format(entry.value, 1)} ${unit}`} disabled={busy} onClick={() => onEdit(entry)}>
                    <Pencil size={14} />
                  </Button>
                  <DeleteButton label={`Delete ${name.toLowerCase()} ${format(entry.value, 1)} ${unit}`} disabled={busy} onClick={() => onDelete(entry)} />
                </li>
              );
            })}
          </ul>
        )}
      </Tile>
      <PhotosTile photos={photos} busy={busy} onUpload={onUpload} onDelete={onDeletePhoto} />
    </Section>
  );
}

