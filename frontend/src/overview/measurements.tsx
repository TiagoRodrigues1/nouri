import * as stylex from "@stylexjs/stylex";
import { Activity as ActivityIcon, Plus, Ruler, Scale } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { measurementLabels } from "../overview-dialogs";
import { dateLabel, format, type Overview as OverviewData, type Photo } from "../lib/api";
import { styles } from "../overview-styles";
import { colors } from "../theme.stylex";
import { DeleteButton, Empty, Section, Sparkline, Stat, Tile, Value, Caption, clock } from "./shared";
import { PhotosTile } from "./photos";

type MeasurementsProps = {
  token: string;
  date: string;
  measurements: OverviewData["measurements"];
  photos: Photo[];
  busy: boolean;
  onLog: () => void;
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

export function MeasurementsSection({ token, date, measurements, photos, busy, onLog, onDelete, onUpload, onDeletePhoto }: MeasurementsProps) {
  const { latest, bmi, weightChange } = measurements;
  const asOf = (recorded: { localDate: string } | null) => (recorded && recorded.localDate !== date ? `Recorded ${dateLabel(recorded.localDate)}` : "Recorded this day");

  return (
    <Section
      title="Measurements"
      description="Body measurements carry forward until you record a new value."
      icon={<Ruler size={18} />}
      color={colors.measurements}
      action={<Button variant="outline" size="sm" onClick={onLog}><Plus size={15} /> Log measurement</Button>}
    >
      <Tile
        title="Weight"
        icon={<Scale size={16} />}
        aside={weightChange === null ? null : <Badge variant="secondary">{weightChange > 0 ? "+" : ""}{format(weightChange, 1)} kg</Badge>}
      >
        <Value value={format(latest.weight?.value, 1)} unit="kg" />
        <Sparkline points={measurements.weightHistory.map((point) => point.value)} />
        <Caption>{latest.weight ? asOf(latest.weight) : "No weight recorded yet"}</Caption>
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
                  <DeleteButton label={`Delete ${name.toLowerCase()} ${format(entry.value, 1)} ${unit}`} disabled={busy} onClick={() => onDelete(entry)} />
                </li>
              );
            })}
          </ul>
        )}
      </Tile>
      <PhotosTile token={token} photos={photos} busy={busy} onUpload={onUpload} onDelete={onDeletePhoto} />
    </Section>
  );
}

