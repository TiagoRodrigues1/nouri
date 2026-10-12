import * as stylex from "@stylexjs/stylex";
import type { FormEvent, ReactNode } from "react";
import { X } from "lucide-react";
import { styles } from "./form-styles";
import { Button } from "./components/ui/button";
import { Checkbox } from "./components/ui/checkbox";
import { Input } from "./components/ui/input";
import { format } from "./lib/api";
import { nutrientLine, unitLabels } from "./lib/food-text";
import { batchItems, rowsKcal } from "./lib/food-selection";
import { rowFood, type DraftRow } from "./lib/saved-meals";
import type { FoodBatchInput } from "../../src/food/contract";

// A Recent or Search result the log dialog ticks into its selection, instead of opening an amount form.
export function SelectableResult({ id, name, meta, checked, onToggle }: { id: string; name: string; meta: ReactNode; checked: boolean; onToggle: () => void }) {
  return (
    <div {...stylex.props(styles.selectableRow, checked && styles.selectableRowChecked)}>
      <Checkbox id={id} checked={checked} aria-label={`Select ${name}`} onCheckedChange={onToggle} />
      <label htmlFor={id} {...stylex.props(styles.mealRowText)}>
        <strong {...stylex.props(styles.resultsText, styles.resultsName)}>{name}</strong>
        <small {...stylex.props(styles.resultsText, styles.resultsMeta)}>{meta}</small>
      </label>
    </div>
  );
}

// The ticked foods, each at an amount that starts from its last or default one, logged together.
export function SelectedFoods({ rows, pending, onChange, onLog }: { rows: DraftRow[]; pending: boolean; onChange: (rows: DraftRow[]) => void; onLog: (items: FoodBatchInput["items"]) => void }) {
  const count = `${rows.length} ${rows.length === 1 ? "food" : "foods"}`;

  // The browser checks each amount before this runs.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const items = batchItems(rows);

    if (items && items.length > 0) onLog(items);
  }

  return (
    <form {...stylex.props(styles.formStack, styles.selectedFoods)} onSubmit={submit}>
      <ul {...stylex.props(styles.mealRows)} aria-label="Selected foods">
        {rows.map((row, index) => {
          const { name, quantity, nutrients } = rowFood(row);

          return (
            <li key={row.key} {...stylex.props(styles.selectedFoodRow, index > 0 && styles.resultsItemBorder)}>
              <span {...stylex.props(styles.selectedFoodText)}>
                <strong {...stylex.props(styles.resultsText, styles.resultsName)}>{name}</strong>
                <small {...stylex.props(styles.resultsText, styles.resultsMeta)}>{nutrientLine(nutrients)}</small>
              </span>
              <span {...stylex.props(styles.mealAmount)}>
                <Input
                  type="number"
                  min="0.001"
                  max="10000"
                  step="0.001"
                  aria-label={`Amount of ${name} in ${unitLabels[quantity.unit]}`}
                  value={row.amount}
                  onChange={(event) => onChange(rows.map((other) => (other.key === row.key ? { ...other, amount: event.target.value } : other)))}
                  required
                />
                <span {...stylex.props(styles.mealUnit)}>{unitLabels[quantity.unit]}</span>
              </span>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${name}`} title="Remove" onClick={() => onChange(rows.filter((other) => other.key !== row.key))}>
                <X size={15} />
              </Button>
            </li>
          );
        })}
      </ul>
      <p {...stylex.props(styles.mealSummary)}>
        <span>{count} selected</span>
        <strong>{format(rowsKcal(rows))} kcal</strong>
      </p>
      <Button type="submit" disabled={pending} {...stylex.props(styles.selectedButton)}>
        Log {count}
      </Button>
    </form>
  );
}
