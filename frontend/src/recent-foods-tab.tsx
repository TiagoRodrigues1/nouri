import * as stylex from "@stylexjs/stylex";
import { useState, type FormEvent } from "react";
import { ChevronRight } from "lucide-react";
import { styles } from "./form-styles";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { format, type RecentFood } from "./lib/api";
import { nutrientLine, unitLabels } from "./lib/food-text";
import { calendarDate, localDate, occurredAt, shiftDate, timeZone } from "./lib/time";
import { typedAmount } from "./lib/typed-amount";
import { useLogRecent, useRecentFoods } from "./lib/use-recent-foods";
import { ListSkeleton } from "./loading";
import { queryFallback } from "./query-status";
import { scaleFood } from "../../src/food/contract";

const shortDate = new Intl.DateTimeFormat("en", { day: "numeric", month: "short" });

function lastEatenLabel(date: string): string {
  const today = localDate(new Date());

  if (date === today) return "today";

  if (date === shiftDate(today, -1)) return "yesterday";

  return shortDate.format(calendarDate(date));
}

// Foods logged before, most recent first. Choosing one logs it at the dialog's date and time, at the amount typed.
export function RecentFoodsTab({ date, time, onLogged }: { date: string; time: string; onLogged: () => void }) {
  const log = useLogRecent(onLogged);

  return (
    <RecentFoodPicker
      actionLabel="Add to log"
      pending={log.isPending}
      onPick={(recent, amount) => log.mutate({ recent, input: { occurredAt: occurredAt(date, time), timeZone, amount } })}
    />
  );
}

// Foods logged before, most recent first, each offered at its last amount. The meal editor shares it.
export function RecentFoodPicker({ actionLabel, pending = false, onPick }: { actionLabel: string; pending?: boolean; onPick: (recent: RecentFood, amount: number) => void }) {
  const query = useRecentFoods();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const foods = query.data;

  if (!foods || query.isError) return queryFallback(query, <ListSkeleton label="Loading your recent foods…" />, styles.searchMessage);

  if (foods.length === 0) {
    return <p {...stylex.props(styles.searchMessage)}>No foods logged yet. Search for a food or add one manually, and it will show up here next time.</p>;
  }

  const selected = foods.find((recent) => recent.entryId === selectedId) ?? null;

  return (
    <>
      <ul {...stylex.props(styles.resultsList)} aria-label="Recent foods">
        {foods.map((recent, index) => {
          const { name, quantity } = recent.food;

          return (
            <li key={recent.entryId} {...stylex.props(index > 0 && styles.resultsItemBorder)}>
              <button
                type="button"
                {...stylex.props(styles.resultsButton, recent.entryId === selectedId && styles.resultsButtonSelected)}
                aria-pressed={recent.entryId === selectedId}
                onClick={() => setSelectedId(recent.entryId)}
              >
                <span>
                  <strong {...stylex.props(styles.resultsText, styles.resultsName)}>{name}</strong>
                  <small {...stylex.props(styles.resultsText, styles.resultsMeta)}>
                    {format(quantity.amount)} {unitLabels[quantity.unit]} · {nutrientLine(recent.food.nutrients)} · {lastEatenLabel(recent.lastEaten)}
                  </small>
                </span>
                <ChevronRight size={16} />
              </button>
            </li>
          );
        })}
      </ul>
      {/* Keyed by entry, so choosing another food restarts from its last amount. */}
      {selected && (
        <RecentFoodForm key={selected.entryId} recent={selected} pending={pending} actionLabel={actionLabel} onPick={(amount) => onPick(selected, amount)} />
      )}
    </>
  );
}

function RecentFoodForm({ recent, pending, actionLabel, onPick }: { recent: RecentFood; pending: boolean; actionLabel: string; onPick: (amount: number) => void }) {
  const { name, quantity } = recent.food;
  const [amount, setAmount] = useState(String(quantity.amount));
  const typed = typedAmount(amount);
  const preview = typed === null ? recent.food : scaleFood(recent.food, typed);

  // The browser checks the amount before this runs.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (typed !== null) onPick(typed);
  }

  return (
    <form {...stylex.props(styles.selectedForm)} onSubmit={submit}>
      <strong {...stylex.props(styles.selectedName)}>{name}</strong>
      <Label {...stylex.props(styles.formLabel, styles.selectedLabel)} htmlFor="recent-amount">Amount in {unitLabels[quantity.unit]}</Label>
      <Input
        id="recent-amount"
        type="number"
        min="0.001"
        max="10000"
        step="0.001"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        required
      />
      <small {...stylex.props(styles.resultsMeta)}>{nutrientLine(preview.nutrients)}</small>
      <Button type="submit" disabled={pending} {...stylex.props(styles.selectedButton)}>
        {actionLabel}
      </Button>
    </form>
  );
}
