import * as stylex from "@stylexjs/stylex";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Beef, Clock3, Flame, PieChart, Plus, Search, Timer, Trash2, Trophy, Utensils, Wheat, Droplet } from "lucide-react";
import { Button } from "./components/ui/button";
import { colors } from "./theme.stylex";
import { styles } from "./my-day-styles";
import { format, type Day, type FoodEntry } from "./lib/api";

// FDA reference daily values for a 2,000 kcal diet.
const reference = { kcal: 2000, proteinG: 50, carbsG: 275, fatG: 78 };

const fastingGoalHours = 16;

const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

type Row =
  | { kind: "hour"; hour: number }
  | { kind: "entry"; entry: FoodEntry; at: Date }
  | { kind: "now" };

type MyDayProps = {
  token: string;
  day: Day | undefined;
  isToday: boolean;
  status: ReactNode;
  deletePending: boolean;
  onLog: () => void;
  onDelete: (entry: FoodEntry) => void;
};

export function MyDay({ token, day, isToday, status, deletePending, onLog, onDelete }: MyDayProps) {
  const now = useNow();
  const entries = day?.food.entries ?? [];
  const totals = day?.food.totals;
  const times = entries.map((entry) => new Date(entry.occurredAt)).sort((a, b) => a.getTime() - b.getTime());
  const eaten = isToday ? times.filter((time) => time <= now) : times;
  const last = eaten.at(-1);
  const connected = Boolean(token);

  return (
    <div {...stylex.props(styles.layout)}>
      <Timeline
        entries={entries}
        now={isToday ? now : null}
        summary={connected ? `${entries.length} ${entries.length === 1 ? "food" : "foods"} · ${format(totals?.kcal)} kcal` : ""}
        status={status}
        deletePending={deletePending}
        onDelete={onDelete}
      />
      <div {...stylex.props(styles.side)}>
        <section {...stylex.props(styles.card, styles.gaugesCard)}>
          <div {...stylex.props(styles.cardHead)}>
            <h2 {...stylex.props(styles.cardTitle, styles.energy)}>
              <Flame size={17} /> Daily totals
            </h2>
            <span {...stylex.props(styles.cardAside)}>vs. reference values for 2,000 kcal</span>
          </div>
          <div {...stylex.props(styles.gauges)}>
            <Gauge icon={<Flame size={14} />} label="Energy" unit="kcal" value={totals?.kcal} target={reference.kcal} color={colors.food} connected={connected} />
            <Gauge icon={<Beef size={14} />} label="Protein" unit="g" value={totals?.proteinG} target={reference.proteinG} color={colors.protein} connected={connected} />
            <Gauge icon={<Wheat size={14} />} label="Carbs" unit="g" value={totals?.carbsG} target={reference.carbsG} color={colors.carbs} connected={connected} />
            <Gauge icon={<Droplet size={14} />} label="Fat" unit="g" value={totals?.fatG} target={reference.fatG} color={colors.fat} connected={connected} />
          </div>
        </section>
        <div {...stylex.props(styles.cards)}>
          {isToday && last ? (
            <FastingCard since={now.getTime() - last.getTime()} last={last} />
          ) : (
            <WindowCard first={times[0]} last={times.at(-1)} />
          )}
          <MixCard proteinG={totals?.proteinG} carbsG={totals?.carbsG} fatG={totals?.fatG} />
          <LargestCard entries={entries} totalKcal={totals?.kcal} />
          <MealsCard times={times} entries={entries} />
          <section {...stylex.props(styles.card, styles.feature)}>
            <h2 {...stylex.props(styles.featureTitle)}>
              <Search size={16} /> Quick log
            </h2>
            <p {...stylex.props(styles.featureHeading)}>What's on your plate?</p>
            <p {...stylex.props(styles.featureText)}>Find a food in the Ciqual catalog or enter your own nutrition details.</p>
            <Button sx={styles.featureButton} onClick={onLog}>
              <Plus size={16} /> Log a food
            </Button>
          </section>
        </div>
      </div>
    </div>
  );
}

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);

    return () => clearInterval(id);
  }, []);

  return now;
}

function timelineRows(entries: FoodEntry[], now: Date | null): Row[] {
  const items = entries
    .map((entry) => ({ entry, at: new Date(entry.occurredAt) }))
    .sort((a, b) => b.at.getTime() - a.at.getTime());

  const hours = items.map((item) => item.at.getHours());
  const start = Math.min(6, ...hours);
  const end = Math.max(22, ...hours, now ? now.getHours() : 0);
  const rows: Row[] = [];

  for (let hour = end; hour >= start; hour--) {
    let nowPlaced = !now || now.getHours() !== hour;

    for (const item of items) {
      if (item.at.getHours() !== hour) continue;

      if (!nowPlaced && now && item.at <= now) {
        rows.push({ kind: "now" });
        nowPlaced = true;
      }

      rows.push({ kind: "entry", ...item });
    }

    if (!nowPlaced) rows.push({ kind: "now" });
    rows.push({ kind: "hour", hour });
  }

  return rows;
}

type TimelineProps = {
  entries: FoodEntry[];
  now: Date | null;
  summary: string;
  status: ReactNode;
  deletePending: boolean;
  onDelete: (entry: FoodEntry) => void;
};

function Timeline({ entries, now, summary, status, deletePending, onDelete }: TimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<HTMLLIElement>(null);
  const hasNow = now !== null;

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const target = focusRef.current;

    if (scroller && target) scroller.scrollTop = target.offsetTop - scroller.clientHeight / 2;
  }, [hasNow, entries.length]);

  const rows = timelineRows(entries, now);
  const focusIndex = hasNow ? rows.findIndex((row) => row.kind === "now") : rows.findIndex((row) => row.kind === "entry");

  return (
    <section {...stylex.props(styles.timelinePanel)} aria-label="Day timeline">
      <header {...stylex.props(styles.timelineHeader)}>
        <h2 {...stylex.props(styles.timelineTitle)}>Timeline</h2>
        <span {...stylex.props(styles.timelineSummary)}>{summary}</span>
      </header>
      <div {...stylex.props(styles.timelineBody)}>
        <div ref={scrollRef} {...stylex.props(styles.timelineScroll)}>
          {status && <div {...stylex.props(styles.timelineMessage)}>{status}</div>}
          <ol {...stylex.props(styles.timeline)} aria-label="Logged foods">
            {rows.map((row, index) => {
              const ref = index === focusIndex ? focusRef : undefined;

              if (row.kind === "hour")
                return (
                  <li key={`hour-${row.hour}`} ref={ref} aria-hidden {...stylex.props(styles.hourRow)}>
                    <span {...stylex.props(styles.hourLabel)}>{String(row.hour).padStart(2, "0")}:00</span>
                    <span {...stylex.props(styles.hourTick)} />
                  </li>
                );

              if (row.kind === "now")
                return (
                  <li key="now" ref={ref} aria-hidden {...stylex.props(styles.nowRow)}>
                    <span {...stylex.props(styles.nowPill)}>{now && clock.format(now)}</span>
                  </li>
                );

              const { entry, at } = row;

              return (
                <li key={entry.id} ref={ref} {...stylex.props(styles.entryRow)}>
                  <span {...stylex.props(styles.entryDot)} />
                  <span {...stylex.props(styles.entryText)}>
                    <span {...stylex.props(styles.entryName)}>{entry.food.name}</span>
                    <span {...stylex.props(styles.entryKcal)}>
                      {format(entry.food.quantity.amount, 2)} {entry.food.quantity.unit} · {format(entry.food.nutrients.kcal)} kcal
                    </span>
                  </span>
                  <time dateTime={entry.occurredAt} {...stylex.props(styles.entryTime)}>{clock.format(at)}</time>
                  <Button
                    variant="ghost"
                    size="icon"
                    sx={styles.entryDelete}
                    aria-label={`Delete ${entry.food.name}`}
                    disabled={deletePending}
                    onClick={() => onDelete(entry)}
                  >
                    <Trash2 size={14} />
                  </Button>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}

type RingProps = {
  size: number;
  stroke: number;
  share: number;
  color: string;
  sweep?: number;
};

function Ring({ size, stroke, share, color, sweep = 1 }: RingProps) {
  const radius = (size - stroke) / 2;
  const length = 2 * Math.PI * radius;
  const arc = length * sweep;
  const filled = arc * Math.min(Math.max(share, 0), 1);
  const rotate = sweep === 1 ? -90 : 90 + (360 * (1 - sweep)) / 2;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <g transform={`rotate(${rotate} ${size / 2} ${size / 2})`} fill="none" strokeWidth={stroke} strokeLinecap="round">
        <circle cx={size / 2} cy={size / 2} r={radius} strokeDasharray={`${arc} ${length}`} {...stylex.props(styles.ringTrack)} />
        {filled > 0 && (
          <circle cx={size / 2} cy={size / 2} r={radius} strokeDasharray={`${filled} ${length}`} {...stylex.props(styles.ringStroke(color))} />
        )}
      </g>
    </svg>
  );
}

type GaugeProps = {
  icon: ReactNode;
  label: string;
  unit: string;
  value: number | null | undefined;
  target: number;
  color: string;
  connected: boolean;
};

function Gauge({ icon, label, unit, value, target, color, connected }: GaugeProps) {
  return (
    <div {...stylex.props(styles.gauge)}>
      <div {...stylex.props(styles.ringWrap)}>
        <Ring size={72} stroke={6} share={(value ?? 0) / target} color={color} sweep={0.75} />
        <span {...stylex.props(styles.ringCenter, styles.gaugeIcon)}>{icon}</span>
      </div>
      <span {...stylex.props(styles.gaugeValue)}>
        {connected ? format(value) : "—"}
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

function FastingCard({ since, last }: { since: number; last: Date }) {
  return (
    <section {...stylex.props(styles.card)}>
      <div {...stylex.props(styles.cardHead)}>
        <h2 {...stylex.props(styles.cardTitle, styles.fasting)}>
          <Timer size={17} /> Fasting
        </h2>
        <span {...stylex.props(styles.cardAside)}>{fastingGoalHours}h goal</span>
      </div>
      <div {...stylex.props(styles.cardBody, styles.centered)}>
        <div {...stylex.props(styles.ringWrap)}>
          <Ring size={112} stroke={10} share={since / (fastingGoalHours * 3_600_000)} color={colors.fasting} />
          <span {...stylex.props(styles.ringCenter)}>{duration(since)}</span>
        </div>
        <p {...stylex.props(styles.caption)}>Since your last food at {clock.format(last)}</p>
      </div>
    </section>
  );
}

function WindowCard({ first, last }: { first: Date | undefined; last: Date | undefined }) {
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

type MixProps = {
  proteinG: number | null | undefined;
  carbsG: number | null | undefined;
  fatG: number | null | undefined;
};

function MixCard({ proteinG, carbsG, fatG }: MixProps) {
  const parts = [
    { label: "Protein", kcal: (proteinG ?? 0) * 4, color: colors.protein },
    { label: "Carbs", kcal: (carbsG ?? 0) * 4, color: colors.carbs },
    { label: "Fat", kcal: (fatG ?? 0) * 9, color: colors.fat },
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
      <div {...stylex.props(styles.cardBody)}>
        <div {...stylex.props(styles.mixBar)}>
          {parts.map((part) => (
            <span key={part.label} {...stylex.props(styles.mixSegment(`${total ? (part.kcal / total) * 100 : 0}%`, part.color))} />
          ))}
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

function MealsCard({ times, entries }: { times: Date[]; entries: FoodEntry[] }) {
  const hours = Array.from({ length: 18 }, (_, index) => index + 6);
  const byHour = new Map<number, number>();

  for (const entry of entries) {
    const hour = Math.min(Math.max(new Date(entry.occurredAt).getHours(), 6), 23);

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

function LargestCard({ entries, totalKcal }: { entries: FoodEntry[]; totalKcal: number | null | undefined }) {
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
