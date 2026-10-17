import * as stylex from "@stylexjs/stylex";
import { styles } from "./form-styles";
import { format } from "./lib/api";
import { nutrientLine, unitLabels } from "./lib/food-text";
import { recentDayLabel } from "./lib/time";
import { useRecentFoods } from "./lib/use-recent-foods";
import { draftRow } from "./lib/saved-meals";
import type { FoodSelection } from "./lib/food-selection";
import { SelectableResult } from "./selected-foods";
import { ListSkeleton } from "./loading";
import { queryFallback } from "./query-status";

// Foods logged before, most recent first, each ticked into the selection at its last amount.
export function RecentFoodPicker({ selection }: { selection: FoodSelection }) {
  const query = useRecentFoods();
  const foods = query.data;

  if (!foods || query.isError) return queryFallback(query, <ListSkeleton label="Loading your recent foods…" />, styles.searchMessage);

  if (foods.length === 0) {
    return <p {...stylex.props(styles.searchMessage)}>No foods logged yet. Search for a food or add one manually, and it will show up here next time.</p>;
  }

  return (
    <ul {...stylex.props(styles.resultsList)} aria-label="Recent foods">
      {foods.map((recent, index) => {
        const { name, quantity } = recent.food;
        const key = `entry:${recent.entryId}`;

        return (
          <li key={recent.entryId} {...stylex.props(index > 0 && styles.resultsItemBorder)}>
            <SelectableResult
              id={`recent-${recent.entryId}`}
              name={name}
              meta={`${format(quantity.amount)} ${unitLabels[quantity.unit]} · ${nutrientLine(recent.food.nutrients)} · ${recentDayLabel(recent.lastEaten)}`}
              checked={selection.has(key)}
              onToggle={() => selection.toggle({ ...draftRow({ kind: "entry", entryId: recent.entryId }, recent.food), key })}
            />
          </li>
        );
      })}
    </ul>
  );
}
