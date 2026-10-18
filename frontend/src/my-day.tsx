import * as stylex from "@stylexjs/stylex";
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Beef, BookmarkPlus, Droplet, Flame, ListX, Pencil, RotateCcw, Trash2, Wheat } from "lucide-react";
import { Button } from "./components/ui/button";
import { colors } from "./theme.stylex";
import { styles } from "./my-day-styles";
import { styles as dashboardStyles } from "./dashboard-styles";
import { DashboardCardsDialog, useDashboardCards } from "./dashboard-cards";
import { clock, currentTime, entryHour, entryTime, occurredAt, timeZone } from "./lib/time";
import { useTargetsQuery } from "./lib/use-targets";
import { dayQueryOptions, workoutSummaryQueryOptions } from "./lib/day-query";
import { useLogAgain } from "./lib/use-log-again";
import { useUndoMealLog } from "./lib/use-saved-meals";
import { queryError } from "./query-status";
import { useSupplements } from "./lib/use-supplements";
import { useArrivals } from "./lib/use-arrivals";
import { useDashboardPage } from "./dashboard-page-context";
import { SupplementsCard } from "./my-day/supplements-card";
import { format, type CardId, type FoodEntry } from "./lib/api";
import { recordPaths } from "../../src/journal/paths";
import { defaultCards } from "../../src/dashboard/contract";
import type { MealLogRef } from "../../src/meals/contract";
import { Bone } from "./loading";
import { CardSkeleton, CardsSkeleton, TimelineSkeleton } from "./my-day/skeletons";
import { ActivityCard, FastingCard, Gauge, LargestCard, MealsCard, MixCard, WaterCard, WindowCard } from "./my-day/cards";

type Row =
  | { kind: "hour"; hour: number }
  | { kind: "entry"; entry: FoodEntry; at: Date }
  // Heads the foods one logging of a saved meal added.
  | { kind: "meal"; log: MealLogRef }
  | { kind: "now" };

// The Today page: the day's timeline beside its cards.
export function MyDay() {
  const { date, isToday, onEditFood: onEdit, onSaveMeal, foodDelete, journal, onManageSupplements, customizingCards, onCustomizingCardsChange } = useDashboardPage();
  const supplements = useSupplements(date);
  const logAgain = useLogAgain(date);
  const removeMeal = useUndoMealLog();
  const busy = foodDelete.isPending || logAgain.pending || removeMeal.isPending;
  const onDelete = (entry: FoodEntry) => foodDelete.mutate(entry);
  const now = useNow();
  const dayQuery = useQuery(dayQueryOptions(date));
  const day = dayQuery.data;
  const loading = dayQuery.isPending;
  const entries = day?.food.entries ?? [];
  const mealLogs = day?.mealLogs ?? [];
  const intakes = [...(day?.supplements.items.flatMap((item) => item.intakes) ?? []), ...(day?.supplements.unlisted ?? [])];
  const arrived = useArrivals([...entries, ...mealLogs, ...intakes].map((record) => record.id), date, day !== undefined);

  // While the day loads, the timeline and cards show their skeletons instead of a message.
  const status = loading ? null : queryError(dayQuery)
    ?? (entries.length === 0 ? <strong {...stylex.props(dashboardStyles.emptyTitle)}>No foods logged yet</strong> : null);

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

  // A card drawn from the day shows its skeleton until the day is here. Activity reads its own summary.
  const fromDay = (id: CardId, card: ReactNode) => (loading ? <CardSkeleton id={id} /> : card);

  const cards: Record<CardId, ReactNode> | undefined = targets && {
    totals: fromDay("totals",
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
      </section>,
    ),
    water: fromDay("water",
      <WaterCard
        goalMl={targets.waterMl}
        entries={day?.water.entries ?? []}
        totalMl={day?.water.totalMl}
        pending={journal.create.isPending || journal.remove.isPending}
        onAdd={(volumeMl) => {
          const input = { occurredAt: occurredAt(date, currentTime()), timeZone, volumeMl };

          journal.create.mutate({ path: recordPaths.water, input, label: "Water", signature: `${recordPaths.water} ${JSON.stringify(input)}` });
        }}
        onDelete={(entry) => journal.remove.mutate({ path: recordPaths.water, label: "Water", ...entry })}
      />,
    ),
    supplements: fromDay("supplements",
      <SupplementsCard
        day={day?.supplements}
        pending={supplements.pending}
        arrived={arrived}
        onTake={supplements.take}
        onRemove={supplements.remove}
        onManage={onManageSupplements}
      />,
    ),
    mix: fromDay("mix", <MixCard kcal={totals?.kcal} proteinG={totals?.proteinG} carbsG={totals?.carbsG} fatG={totals?.fatG} />),
    activity: <ActivityCard date={date} targets={targets} />,
    fasting: fromDay("fasting", isToday && last ? <FastingCard since={now.getTime() - last.getTime()} last={last} goalHours={targets.fastingHours} /> : <WindowCard first={times[0]} last={times.at(-1)} />),
    largest: fromDay("largest", <LargestCard entries={entries} totalKcal={totals?.kcal} />),
    meals: fromDay("meals", <MealsCard times={times} entries={entries} />),
  };

  return (
    <div {...stylex.props(styles.layout)}>
      <Timeline
        entries={entries}
        mealLogs={mealLogs}
        arrived={arrived}
        now={isToday ? now : null}
        logAgainWhen={isToday ? "now" : "today"}
        summary={`${entries.length} ${entries.length === 1 ? "food" : "foods"} · ${format(totals?.kcal)} kcal`}
        loading={loading}
        status={status}
        busy={busy}
        onLogAgain={logAgain.logAgain}
        onEdit={onEdit}
        onDelete={onDelete}
        onRemoveMeal={(log) => removeMeal.mutate(log)}
        onSaveMeal={onSaveMeal}
      />
      <div {...stylex.props(styles.side)}>
        {!targets && targetsQuery.isError ? (
          <p {...stylex.props(styles.noCards)}>{queryError(targetsQuery, "Targets could not load: ")}</p>
        ) : !targets || !layout.cards ? (
          <CardsSkeleton cards={layout.cards ?? defaultCards} />
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

// Latest first by hour. A meal log's foods share their time, and sit together under its row, which comes before the
// first of them shown; one moved to another time stays in the log without a row of its own.
function timelineRows(entries: FoodEntry[], mealLogs: MealLogRef[], now: Date | null): Row[] {
  const items = entries
    .map((entry) => ({ entry, at: new Date(entry.occurredAt) }))
    .sort((a, b) => b.at.getTime() - a.at.getTime() || (a.entry.mealLogId ?? "").localeCompare(b.entry.mealLogId ?? ""));

  const logs = new Map(mealLogs.map((log) => [log.id, log]));
  const headed = new Set<string>();

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

      const log = item.entry.mealLogId ? logs.get(item.entry.mealLogId) : undefined;

      if (log && !headed.has(log.id)) {
        rows.push({ kind: "meal", log });
        headed.add(log.id);
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
  mealLogs: MealLogRef[];
  now: Date | null;
  // Logging again always lands today, so a past day says so rather than implying it adds to this one.
  logAgainWhen: "now" | "today";
  summary: string;
  // The day is still loading, so the timeline shows placeholder rows.
  loading: boolean;
  status: ReactNode;
  busy: boolean;
  onLogAgain: (entry: FoodEntry) => void;
  onEdit: (entry: FoodEntry) => void;
  onDelete: (entry: FoodEntry) => void;
  onRemoveMeal: (log: MealLogRef) => void;
  onSaveMeal: () => void;
  // Foods and meals logged since the day opened, which fade in where they land.
  arrived: ReadonlySet<string>;
};

function Timeline({ entries, mealLogs, arrived, now, logAgainWhen, summary, loading, status, busy, onLogAgain, onEdit, onDelete, onRemoveMeal, onSaveMeal }: TimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<HTMLLIElement>(null);
  const hasNow = now !== null;

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const target = focusRef.current;

    if (scroller && target) scroller.scrollTop = target.offsetTop - scroller.clientHeight / 2;
  }, [hasNow, entries.length]);

  const rows = timelineRows(entries, mealLogs, now);
  const focusIndex = hasNow ? rows.findIndex((row) => row.kind === "now") : rows.findIndex((row) => row.kind === "entry");

  return (
    <section {...stylex.props(styles.timelinePanel)} aria-label="Day timeline">
      <header {...stylex.props(styles.timelineHeader)}>
        <h2 {...stylex.props(styles.timelineTitle)}>Timeline</h2>
        <span {...stylex.props(styles.timelineSummary)}>
          {loading ? <Bone width={92} height={11} /> : summary}
          {entries.length > 0 && (
            <Button variant="ghost" size="icon" {...stylex.props(styles.entryAction)} aria-label="Save foods as a meal" title="Save as meal" disabled={busy} onClick={onSaveMeal}>
              <BookmarkPlus size={14} />
            </Button>
          )}
        </span>
      </header>
      <div {...stylex.props(styles.timelineBody)}>
        <div ref={scrollRef} {...stylex.props(styles.timelineScroll)}>
          {loading && <TimelineSkeleton />}
          {status && <div {...stylex.props(styles.timelineMessage)}>{status}</div>}
          {!loading && <ol {...stylex.props(styles.timeline)} aria-label="Logged foods">
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

              if (row.kind === "meal")
                return (
                  <li key={`meal-${row.log.id}`} ref={ref} data-form-enter={arrived.has(row.log.id) ? "" : undefined} {...stylex.props(styles.mealRow)}>
                    <span {...stylex.props(styles.mealLogName)}>{row.log.name}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      {...stylex.props(styles.entryAction)}
                      aria-label={`Remove ${row.log.name} and its foods`}
                      title="Remove meal"
                      disabled={busy}
                      onClick={() => onRemoveMeal(row.log)}
                    >
                      <ListX size={14} />
                    </Button>
                  </li>
                );

              const { entry } = row;

              return (
                <li key={entry.id} ref={ref} data-form-enter={arrived.has(entry.id) ? "" : undefined} {...stylex.props(styles.entryRow)}>
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
          </ol>}
        </div>
      </div>
    </section>
  );
}
