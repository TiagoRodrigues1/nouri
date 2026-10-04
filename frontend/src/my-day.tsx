import * as stylex from "@stylexjs/stylex";
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Beef, BookmarkPlus, Droplet, Flame, Pencil, RotateCcw, Trash2, Wheat } from "lucide-react";
import { Button } from "./components/ui/button";
import { colors } from "./theme.stylex";
import { styles } from "./my-day-styles";
import { DashboardCardsDialog, useDashboardCards } from "./dashboard-cards";
import { clock, entryHour, entryTime } from "./lib/time";
import { useTargetsQuery } from "./lib/use-targets";
import { workoutSummaryQueryOptions } from "./lib/day-query";
import { useLogAgain } from "./lib/use-log-again";
import { queryStatus } from "./query-status";
import { useSupplements } from "./lib/use-supplements";
import { useDashboardPage } from "./dashboard-page-context";
import { SupplementsCard } from "./my-day/supplements-card";
import { format, type CardId, type Day, type FoodEntry } from "./lib/api";
import { recordPaths } from "../../src/journal/paths";
import { ActivityCard, FastingCard, Gauge, LargestCard, MealsCard, MixCard, WaterCard, WindowCard } from "./my-day/cards";

type Row =
  | { kind: "hour"; hour: number }
  | { kind: "entry"; entry: FoodEntry; at: Date }
  | { kind: "now" };

type MyDayProps = { day: Day | undefined; status: ReactNode };

export function MyDay({ day, status }: MyDayProps) {
  const { date, isToday, onEditFood: onEdit, onSaveMeal, foodDelete, journal, onManageSupplements, customizingCards, onCustomizingCardsChange } = useDashboardPage();
  const supplements = useSupplements(date);
  const logAgain = useLogAgain(date);
  const busy = foodDelete.isPending || logAgain.pending;
  const onDelete = (entry: FoodEntry) => foodDelete.mutate(entry);
  const now = useNow();
  const entries = day?.food.entries ?? [];
  const totals = day?.food.totals;
  const times = entries.map((entry) => new Date(entry.occurredAt)).sort((a, b) => a.getTime() - b.getTime());
  const eaten = isToday ? times.filter((time) => time <= now) : times;
  const last = eaten.at(-1);
  const layout = useDashboardCards();
  // The Activity card mounts only once the targets and layout arrive, so its read starts here, alongside them.
  // While the layout is unknown it assumes the card is shown.
  useQuery({ ...workoutSummaryQueryOptions(date), enabled: layout.cards?.includes("activity") ?? true });
  const targetsQuery = useTargetsQuery(date);
  const targets = targetsQuery.data?.targets;
  // Cards wait for the targets too, so no gauge draws against a value about to change.
  const shown = targets && layout.cards;

  const cards: Record<CardId, ReactNode> | undefined = targets && {
    totals: (
      <section {...stylex.props(styles.card, styles.full)}>
        <div {...stylex.props(styles.cardHead)}>
          <h2 {...stylex.props(styles.cardTitle, styles.energy)}>
            <Flame size={17} /> Daily totals
          </h2>
          <span {...stylex.props(styles.cardAside)}>vs. your daily targets</span>
        </div>
        <div {...stylex.props(styles.gauges)}>
          <Gauge icon={<Flame size={14} />} label="Energy" unit="kcal" value={totals?.kcal} target={targets.kcal} color={colors.food} />
          <Gauge icon={<Beef size={14} />} label="Protein" unit="g" value={totals?.proteinG} target={targets.proteinG} color={colors.protein} />
          <Gauge icon={<Wheat size={14} />} label="Carbs" unit="g" value={totals?.carbsG} target={targets.carbsG} color={colors.carbs} />
          <Gauge icon={<Droplet size={14} />} label="Fat" unit="g" value={totals?.fatG} target={targets.fatG} color={colors.fat} />
        </div>
      </section>
    ),
    water: (
      <WaterCard
        goalMl={targets.waterMl}
        entries={day?.water.entries ?? []}
        totalMl={day?.water.totalMl}
        pending={journal.create.isPending || journal.remove.isPending}
        onDelete={(entry) => journal.remove.mutate({ path: recordPaths.water, label: "Water", ...entry })}
      />
    ),
    supplements: (
      <SupplementsCard
        day={day?.supplements}
        pending={supplements.pending}
        onTake={supplements.take}
        onRemove={supplements.remove}
        onManage={onManageSupplements}
      />
    ),
    mix: <MixCard kcal={totals?.kcal} proteinG={totals?.proteinG} carbsG={totals?.carbsG} fatG={totals?.fatG} />,
    activity: <ActivityCard date={date} targets={targets} />,
    fasting: isToday && last ? <FastingCard since={now.getTime() - last.getTime()} last={last} goalHours={targets.fastingHours} /> : <WindowCard first={times[0]} last={times.at(-1)} />,
    largest: <LargestCard entries={entries} totalKcal={totals?.kcal} />,
    meals: <MealsCard times={times} entries={entries} />,
  };

  return (
    <div {...stylex.props(styles.layout)}>
      <Timeline
        entries={entries}
        now={isToday ? now : null}
        logAgainWhen={isToday ? "now" : "today"}
        summary={`${entries.length} ${entries.length === 1 ? "food" : "foods"} · ${format(totals?.kcal)} kcal`}
        status={status}
        busy={busy}
        onLogAgain={logAgain.logAgain}
        onEdit={onEdit}
        onDelete={onDelete}
        onSaveMeal={() => onSaveMeal({ entryIds: entries.map((entry) => entry.id), name: "" })}
      />
      <div {...stylex.props(styles.side)}>
        {!targets ? (
          <p {...stylex.props(styles.noCards)}>{queryStatus(targetsQuery, "Loading your targets…", "Targets could not load: ")}</p>
        ) : shown?.length === 0 ? (
          <p {...stylex.props(styles.noCards)}>All cards are hidden. Use the customize button at the top to bring some back.</p>
        ) : (
          <div {...stylex.props(styles.cards)}>
            {shown?.map((id) => <Fragment key={id}>{cards?.[id]}</Fragment>)}
          </div>
        )}
      </div>
      <DashboardCardsDialog
        open={customizingCards && Boolean(layout.cards)}
        onOpenChange={(open) => {
          onCustomizingCardsChange(open);
          layout.mutation.reset();
        }}
        cards={layout.cards ?? []}
        pending={layout.mutation.isPending}
        error={layout.mutation.error?.message ?? ""}
        onSave={(next) => layout.mutation.mutate(next, { onSuccess: () => onCustomizingCardsChange(false) })}
      />
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

  const hours = items.map((item) => entryHour(item.entry));
  const start = Math.min(6, ...hours);
  const end = Math.max(22, ...hours, now ? now.getHours() : 0);
  const rows: Row[] = [];

  for (let hour = end; hour >= start; hour--) {
    let nowPlaced = !now || now.getHours() !== hour;

    for (const item of items) {
      if (entryHour(item.entry) !== hour) continue;

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
  // Logging again always lands today, so a past day says so rather than implying it adds to this one.
  logAgainWhen: "now" | "today";
  summary: string;
  status: ReactNode;
  busy: boolean;
  onLogAgain: (entry: FoodEntry) => void;
  onEdit: (entry: FoodEntry) => void;
  onDelete: (entry: FoodEntry) => void;
  onSaveMeal: () => void;
};

function Timeline({ entries, now, logAgainWhen, summary, status, busy, onLogAgain, onEdit, onDelete, onSaveMeal }: TimelineProps) {
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
        <span {...stylex.props(styles.timelineSummary)}>
          {summary}
          {entries.length > 0 && (
            <Button variant="ghost" size="icon" {...stylex.props(styles.entryAction)} aria-label="Save foods as a meal" title="Save as meal" disabled={busy} onClick={onSaveMeal}>
              <BookmarkPlus size={14} />
            </Button>
          )}
        </span>
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

              const { entry } = row;

              return (
                <li key={entry.id} ref={ref} {...stylex.props(styles.entryRow)}>
                  <span {...stylex.props(styles.entryDot)} />
                  <span {...stylex.props(styles.entryText)}>
                    <span {...stylex.props(styles.entryName)}>{entry.food.name}</span>
                    <span {...stylex.props(styles.entryKcal)}>
                      {format(entry.food.quantity.amount, 2)} {entry.food.quantity.unit} · {format(entry.food.nutrients.kcal)} kcal
                    </span>
                  </span>
                  <time dateTime={entry.occurredAt} {...stylex.props(styles.entryTime)}>{entryTime(entry)}</time>
                  <Button
                    variant="ghost"
                    size="icon"
                    {...stylex.props(styles.entryAction)}
                    aria-label={`Log ${entry.food.name} again ${logAgainWhen}`}
                    title={`Log again ${logAgainWhen}`}
                    disabled={busy}
                    onClick={() => onLogAgain(entry)}
                  >
                    <RotateCcw size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    {...stylex.props(styles.entryAction)}
                    aria-label={`Edit ${entry.food.name}`}
                    disabled={busy}
                    onClick={() => onEdit(entry)}
                  >
                    <Pencil size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    {...stylex.props(styles.entryAction)}
                    aria-label={`Delete ${entry.food.name}`}
                    disabled={busy}
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
