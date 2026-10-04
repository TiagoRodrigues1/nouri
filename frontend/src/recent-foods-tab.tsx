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
import { queryStatus } from "./query-status";
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
  const query = useRecentFoods();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const log = useLogRecent(onLogged);
  const foods = query.data;
  const status = queryStatus(query, "Loading your recent foods…");

  if (status || !foods) return <p {...stylex.props(styles.searchMessage)}>{status}</p>;

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
        <RecentFoodForm
          key={selected.entryId}
          recent={selected}
          pending={log.isPending}
          onLog={(amount) => log.mutate({ recent: selected, input: { occurredAt: occurredAt(date, time), timeZone, amount } })}
        />
      )}
    </>
  );
}

function RecentFoodForm({ recent, pending, onLog }: { recent: RecentFood; pending: boolean; onLog: (amount: number) => void }) {
  const { name, quantity } = recent.food;
  const [amount, setAmount] = useState(String(quantity.amount));
  const typed = typedAmount(amount);
  const preview = typed === null ? recent.food : scaleFood(recent.food, typed);

  // The browser checks the amount before this runs.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (typed !== null) onLog(typed);
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
        Add to log
      </Button>
    </form>
  );
}
