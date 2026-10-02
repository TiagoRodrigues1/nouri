import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Clock3, Droplet, PieChart, Timer, Trash2, Trophy, Utensils } from "lucide-react";
import { Button } from "../components/ui/button";
import { colors } from "../theme.stylex";
import { styles } from "../my-day-styles";
import { clock, entryHour } from "../lib/time";
import { workoutSummaryQueryOptions } from "../lib/day-query";
import { format, type FoodEntry, type Targets, type WaterEntry } from "../lib/api";
import { ActivityRings, Bottle, Donut, Ring, type ActivityRing } from "./charts";

type GaugeProps = {
  icon: ReactNode;
  label: string;
  unit: string;
  value: number | null | undefined;
  target: number;
  color: string;
};

export function Gauge({ icon, label, unit, value, target, color }: GaugeProps) {
  return (
    <div {...stylex.props(styles.gauge)}>
      <div {...stylex.props(styles.ringWrap)}>
        <Ring size={72} stroke={6} share={(value ?? 0) / target} color={color} sweep={0.75} />
        <span {...stylex.props(styles.ringCenter, styles.gaugeIcon)}>{icon}</span>
      </div>
      <span {...stylex.props(styles.gaugeValue)}>
        {format(value)}
        <span {...stylex.props(styles.gaugeUnit)}>{unit}</span>
      </span>
      <span {...stylex.props(styles.gaugeLabel)}>
        {label} · {format(target)}
        {unit === "kcal" ? "" : unit}
      </span>
    </div>
  );
}

function duration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));

  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

export function FastingCard({ since, last, goalHours }: { since: number; last: Date; goalHours: number }) {
  return (
    <section {...stylex.props(styles.card)}>
      <div {...stylex.props(styles.cardHead)}>
        <h2 {...stylex.props(styles.cardTitle, styles.fasting)}>
          <Timer size={17} /> Fasting
        </h2>
        <span {...stylex.props(styles.cardAside)}>{goalHours}h goal</span>
      </div>
      <div {...stylex.props(styles.cardBody, styles.centered)}>
        <div {...stylex.props(styles.ringWrap)}>
          <Ring size={112} stroke={10} share={since / (goalHours * 3_600_000)} color={colors.fasting} />
          <span {...stylex.props(styles.ringCenter)}>{duration(since)}</span>
        </div>
        <p {...stylex.props(styles.caption)}>Since your last food at {clock.format(last)}</p>
      </div>
    </section>
  );
}

export function WindowCard({ first, last }: { first: Date | undefined; last: Date | undefined }) {
  const span = first && last ? last.getTime() - first.getTime() : 0;

  return (
    <section {...stylex.props(styles.card)}>
      <div {...stylex.props(styles.cardHead)}>
        <h2 {...stylex.props(styles.cardTitle, styles.fasting)}>
          <Clock3 size={17} /> Eating window
        </h2>
      </div>
      <div {...stylex.props(styles.cardBody, styles.centered)}>
        <div {...stylex.props(styles.ringWrap)}>
          <Ring size={112} stroke={10} share={span / 86_400_000} color={colors.fasting} />
          <span {...stylex.props(styles.ringCenter)}>{first ? duration(span) : "—"}</span>
        </div>
        <p {...stylex.props(styles.caption)}>
          {first && last ? `${clock.format(first)} – ${clock.format(last)}` : "No foods logged"}
        </p>
      </div>
    </section>
  );
}

// Energy per gram, used to show how each macro splits the day's energy.
const kcalPerGram = { proteinG: 4, carbsG: 4, fatG: 9 } as const;

type MixProps = {
  kcal: number | null | undefined;
  proteinG: number | null | undefined;
  carbsG: number | null | undefined;
  fatG: number | null | undefined;
};

export function MixCard({ kcal, proteinG, carbsG, fatG }: MixProps) {
  const parts = [
    { label: "Protein", kcal: (proteinG ?? 0) * kcalPerGram.proteinG, color: colors.protein },
    { label: "Carbs", kcal: (carbsG ?? 0) * kcalPerGram.carbsG, color: colors.carbs },
    { label: "Fat", kcal: (fatG ?? 0) * kcalPerGram.fatG, color: colors.fat },
  ];

  const total = parts.reduce((sum, part) => sum + part.kcal, 0);
  const share = (kcal: number) => (total ? Math.round((kcal / total) * 100) : 0);

  return (
    <section {...stylex.props(styles.card)}>
      <div {...stylex.props(styles.cardHead)}>
        <h2 {...stylex.props(styles.cardTitle, styles.mix)}>
          <PieChart size={17} /> Energy mix
        </h2>
        <span {...stylex.props(styles.cardAside)}>from macros</span>
      </div>
      <div {...stylex.props(styles.cardBody, styles.ringBody)}>
        <div {...stylex.props(styles.ringWrap)}>
          <Donut size={112} stroke={14} parts={parts.map((part) => ({ value: part.kcal, color: part.color }))} />
          <span {...stylex.props(styles.ringCenter, styles.ringStack)}>
            <span {...stylex.props(styles.ringStackValue)}>{total ? format(kcal ?? total) : "—"}</span>
            <span {...stylex.props(styles.ringStackUnit)}>kcal</span>
          </span>
        </div>
        <div {...stylex.props(styles.mixRows)}>
          {parts.map((part) => (
            <div key={part.label} {...stylex.props(styles.mixRow)}>
              <span {...stylex.props(styles.swatch(part.color))} />
              <span {...stylex.props(styles.mixLabel)}>{part.label}</span>
              <span {...stylex.props(styles.mixValue)}>{total ? `${share(part.kcal)}%` : "—"}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// The Move ring counts the estimates that were recorded; a workout without one adds nothing.
export function ActivityCard({ date, targets }: { date: string; targets: Targets }) {
  const sports = useQuery(workoutSummaryQueryOptions(date)).data;

  const rings: ActivityRing[] = [
    { label: "Move", value: sports?.burnedKcal ?? 0, goal: targets.burnedKcal, unit: "kcal", color: colors.move },
    { label: "Exercise", value: sports?.totalMinutes ?? 0, goal: targets.exerciseMinutes, unit: "min", color: colors.exercise },
    { label: "Workouts", value: sports?.entryCount ?? 0, goal: targets.workouts, unit: "", color: colors.workouts },
  ];

  return (
    <section {...stylex.props(styles.card)} aria-label="Activity">
      <div {...stylex.props(styles.cardHead)}>
        <h2 {...stylex.props(styles.cardTitle, styles.activity)}><Activity size={17} /> Activity</h2>
      </div>
      <div {...stylex.props(styles.cardBody, styles.ringBody)}>
        <ActivityRings rings={rings} size={112} stroke={12} />
        <div {...stylex.props(styles.mixRows)}>
          {rings.map((ring) => (
            <div key={ring.label} {...stylex.props(styles.mixRow)}>
              <span {...stylex.props(styles.swatch(ring.color))} />
              <span {...stylex.props(styles.mixLabel)}>{ring.label}</span>
              <span {...stylex.props(styles.mixValue)}>
                {format(ring.value)}/{format(ring.goal)}
                {ring.unit && <span {...stylex.props(styles.ringGoalUnit)}> {ring.unit}</span>}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function MealsCard({ times, entries }: { times: Date[]; entries: FoodEntry[] }) {
  const hours = Array.from({ length: 18 }, (_, index) => index + 6);
  const byHour = new Map<number, number>();

  for (const entry of entries) {
    const hour = Math.min(Math.max(entryHour(entry), 6), 23);

    byHour.set(hour, (byHour.get(hour) ?? 0) + (entry.food.nutrients.kcal ?? 0));
  }

  const peak = Math.max(1, ...byHour.values());
  const first = times[0];
  const last = times.at(-1);

  return (
    <section {...stylex.props(styles.card, styles.wide)}>
      <div {...stylex.props(styles.cardHead)}>
        <h2 {...stylex.props(styles.cardTitle, styles.meals)}>
          <Utensils size={17} /> Foods by hour
        </h2>
        <span {...stylex.props(styles.cardAside)}>{first && last ? `${clock.format(first)} – ${clock.format(last)}` : ""}</span>
      </div>
      <div>
        <span {...stylex.props(styles.bigValue)}>{entries.length}</span>
        <span {...stylex.props(styles.bigUnit)}>{entries.length === 1 ? "food" : "foods"} logged</span>
      </div>
      <div {...stylex.props(styles.bars)} aria-hidden>
        {hours.map((hour) => {
          const kcal = byHour.get(hour) ?? 0;

          return <span key={hour} {...stylex.props(styles.bar(`${(kcal / peak) * 100}%`), byHour.has(hour) ? styles.barFilled : styles.barEmpty)} />;
        })}
      </div>
      <div {...stylex.props(styles.barAxis)} aria-hidden>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>23:00</span>
      </div>
    </section>
  );
}

export function LargestCard({ entries, totalKcal }: { entries: FoodEntry[]; totalKcal: number | null | undefined }) {
  const largest = entries.reduce<FoodEntry | undefined>(
    (best, entry) => ((entry.food.nutrients.kcal ?? 0) > (best?.food.nutrients.kcal ?? -1) ? entry : best),
    undefined,
  );

  const kcal = largest?.food.nutrients.kcal;

  return (
    <section {...stylex.props(styles.card)}>
      <div {...stylex.props(styles.cardHead)}>
        <h2 {...stylex.props(styles.cardTitle, styles.largest)}>
          <Trophy size={17} /> Largest food
        </h2>
      </div>
      <div {...stylex.props(styles.cardBody)}>
        <div>
          <span {...stylex.props(styles.bigValue)}>{format(kcal)}</span>
          <span {...stylex.props(styles.bigUnit)}>kcal</span>
        </div>
        <p {...stylex.props(styles.mealName)}>{largest?.food.name ?? "Nothing logged yet"}</p>
        <p {...stylex.props(styles.caption)}>
          {kcal != null && totalKcal ? `${Math.round((kcal / totalKcal) * 100)}% of the day's energy` : " "}
        </p>
      </div>
    </section>
  );
}

function waterProgress(totalMl: number, goalMl: number): string {
  if (totalMl >= goalMl) return "Goal reached. Nice work!";

  return `${Math.round((totalMl / goalMl) * 100)}% of your goal · ${format(goalMl - totalMl)} ml to go`;
}

type WaterCardProps = {
  goalMl: number;
  entries: WaterEntry[];
  totalMl: number | null | undefined;
  pending: boolean;
  onDelete: (entry: WaterEntry) => void;
};

export function WaterCard({ goalMl, entries, totalMl, pending, onDelete }: WaterCardProps) {
  return (
    <section {...stylex.props(styles.card, styles.wide)} aria-label="Water">
      <div {...stylex.props(styles.cardHead)}>
        <h2 {...stylex.props(styles.cardTitle, styles.water)}>
          <Droplet size={17} /> Water
        </h2>
        <span {...stylex.props(styles.cardAside)}>{format(goalMl)} ml goal</span>
      </div>
      <div {...stylex.props(styles.waterBody)}>
        <Bottle share={(totalMl ?? 0) / goalMl} />
        <div {...stylex.props(styles.waterControls)}>
          <div>
            <span {...stylex.props(styles.bigValue)}>{format(totalMl ?? 0)}</span>
            <span {...stylex.props(styles.bigUnit)}>ml</span>
            <p {...stylex.props(styles.caption, styles.waterCaption)}>{waterProgress(totalMl ?? 0, goalMl)}</p>
          </div>
          {/* The list keeps a fixed height and scrolls, so logging drinks never resizes the card. */}
          <ul {...stylex.props(styles.waterList)} aria-label="Logged water">
            {entries.length === 0 && <li {...stylex.props(styles.waterEmpty)}>No drinks logged yet</li>}
            {entries.toReversed().map((entry) => (
              <li key={entry.id} {...stylex.props(styles.waterRow)}>
                <time dateTime={entry.occurredAt} {...stylex.props(styles.entryTime)}>{clock.format(new Date(entry.occurredAt))}</time>
                <span {...stylex.props(styles.waterAmount)}>{format(entry.volumeMl)} ml</span>
                <Button
                  variant="ghost"
                  size="icon"
                  {...stylex.props(styles.entryAction)}
                  aria-label={`Delete ${entry.volumeMl} ml of water at ${clock.format(new Date(entry.occurredAt))}`}
                  disabled={pending}
                  onClick={() => onDelete(entry)}
                >
                  <Trash2 size={14} />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
