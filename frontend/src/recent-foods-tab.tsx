import * as stylex from "@stylexjs/stylex";
import { useState, type FormEvent } from "react";
import { ChevronRight } from "lucide-react";
import { styles } from "./form-styles";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { format, type RecentFood } from "./lib/api";
import { nutrientLine, unitLabels } from "./lib/food-text";
import { calendarDate, localDate, shiftDate } from "./lib/time";
import { typedAmount } from "./lib/typed-amount";
import { useRecentFoods } from "./lib/use-recent-foods";
import { draftRow } from "./lib/saved-meals";
import type { FoodSelection } from "./lib/food-selection";
import { SelectableResult } from "./selected-foods";
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

type RecentPick =
  | { actionLabel: string; pending?: boolean; onPick: (recent: RecentFood, amount: number) => void }
  // The log dialog ticks foods into a selection it logs together.
  | { selection: FoodSelection };

// Foods logged before, most recent first, each offered at its last amount. The meal editor picks one at a time.
export function RecentFoodPicker(props: RecentPick) {
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
          const meta = `${format(quantity.amount)} ${unitLabels[quantity.unit]} · ${nutrientLine(recent.food.nutrients)} · ${lastEatenLabel(recent.lastEaten)}`;

          if ("selection" in props) {
            const key = `entry:${recent.entryId}`;

            return (
              <li key={recent.entryId} {...stylex.props(index > 0 && styles.resultsItemBorder)}>
                <SelectableResult
                  id={`recent-${recent.entryId}`}
                  name={name}
                  meta={meta}
                  checked={props.selection.has(key)}
                  onToggle={() => props.selection.toggle(key, { ...draftRow({ kind: "entry", entryId: recent.entryId }, recent.food), key })}
                />
              </li>
            );
          }

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
                  <small {...stylex.props(styles.resultsText, styles.resultsMeta)}>{meta}</small>
                </span>
                <ChevronRight size={16} />
              </button>
            </li>
          );
        })}
      </ul>
      {/* Keyed by entry, so choosing another food restarts from its last amount. */}
      {selected && "onPick" in props && (
        <RecentFoodForm key={selected.entryId} recent={selected} pending={props.pending ?? false} actionLabel={props.actionLabel} onPick={(amount) => props.onPick(selected, amount)} />
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
