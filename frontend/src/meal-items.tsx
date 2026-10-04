import * as stylex from "@stylexjs/stylex";
import { Checkbox } from "./components/ui/checkbox";
import { Input } from "./components/ui/input";
import { styles } from "./form-styles";
import { format } from "./lib/api";
import { nutrientLine, unitLabels } from "./lib/food-text";
import { includedKcal, rowFood, type MealRow } from "./lib/saved-meals";

// The foods of a meal, each with whether it is included and its amount. Saving and logging share it.
export function MealItems({ rows, onChange, label }: { rows: MealRow[]; onChange: (rows: MealRow[]) => void; label: string }) {
  const kcal = includedKcal(rows);

  function change(id: string, patch: Partial<MealRow>) {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  return (
    <>
      <ul {...stylex.props(styles.mealRows)} aria-label={label}>
        {rows.map((row, index) => {
          const { name, quantity, nutrients } = rowFood(row);

          return (
            <li key={row.id} {...stylex.props(styles.mealRow, index > 0 && styles.resultsItemBorder, !row.included && styles.mealRowExcluded)}>
              <Checkbox id={`meal-item-${row.id}`} checked={row.included} aria-label={`Include ${name}`} onCheckedChange={(checked) => change(row.id, { included: checked === true })} />
              <label htmlFor={`meal-item-${row.id}`} {...stylex.props(styles.mealRowText)}>
                <strong {...stylex.props(styles.resultsText, styles.resultsName)}>{name}</strong>
                <small {...stylex.props(styles.resultsText, styles.resultsMeta)}>
                  {nutrientLine(nutrients)}
                </small>
              </label>
              <span {...stylex.props(styles.mealAmount)}>
                <Input
                  type="number"
                  min="0.001"
                  max="10000"
                  step="0.001"
                  aria-label={`Amount of ${name} in ${unitLabels[quantity.unit]}`}
                  value={row.amount}
                  disabled={!row.included}
                  required={row.included}
                  onChange={(event) => change(row.id, { amount: event.target.value })}
                />
                <span {...stylex.props(styles.mealUnit)}>{unitLabels[quantity.unit]}</span>
              </span>
            </li>
          );
        })}
      </ul>
      <p {...stylex.props(styles.mealSummary)}>
        <span>{rows.filter((row) => row.included).length} of {rows.length} foods</span>
        <strong>{format(kcal)} kcal</strong>
      </p>
    </>
  );
}
