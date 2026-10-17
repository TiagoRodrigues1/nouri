import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { styles } from "./form-styles";
import { Checkbox } from "./components/ui/checkbox";

// A Recent or Search result the meal editor ticks into its selection, instead of opening an amount form.
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
