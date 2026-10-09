import * as stylex from "@stylexjs/stylex";
import type { FormEvent } from "react";
import { styles } from "./form-styles";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import type { FoodInput } from "../../src/food/contract";

// A food typed from its label: a name, an amount in grams, and the nutrition for that amount.
export function ManualFoodForm({
  actionLabel,
  pending = false,
  onPick,
}: {
  actionLabel: string;
  pending?: boolean;
  onPick: (food: FoodInput["food"]) => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onPick({
      name:
        event.currentTarget
          .querySelector<HTMLInputElement>("#food-name")
          ?.value.trim() ?? "",
      quantity: { amount: Number(data.get("grams")), unit: "g" },
      nutrients: {
        kcal: Number(data.get("kcal")),
        proteinG: Number(data.get("protein")),
        carbsG: Number(data.get("carbs")),
        fatG: Number(data.get("fat")),
      },
    });
  }

  return (
    <form {...stylex.props(styles.formStack)} onSubmit={submit}>
      <div>
        <Label {...stylex.props(styles.formLabel)} htmlFor="food-name">Food name</Label>
        <Input
          id="food-name"
          name="name"
          maxLength={200}
          placeholder="e.g. Homemade granola"
          required
        />
      </div>
      <div>
        <Label {...stylex.props(styles.formLabel)} htmlFor="manual-grams">Amount in grams</Label>
        <Input
          id="manual-grams"
          name="grams"
          type="number"
          min="0.001"
          max="1000000"
          step="0.001"
          required
        />
      </div>
      <p {...stylex.props(styles.formSubhead)}>NUTRITION FOR THIS AMOUNT</p>
      <div {...stylex.props(styles.manualGrid)}>
        {[
          ["kcal", "Calories (kcal)"],
          ["protein", "Protein (g)"],
          ["carbs", "Carbs (g)"],
          ["fat", "Fat (g)"],
        ].map(([name, label]) => (
          <div key={name}>
            <Label {...stylex.props(styles.formLabel)} htmlFor={`manual-${name}`}>{label}</Label>
            <Input
              id={`manual-${name}`}
              name={name}
              type="number"
              min="0"
              max="1000000"
              step="0.001"
              required
            />
          </div>
        ))}
      </div>
      <Button {...stylex.props(styles.widthFull, styles.manualSubmit)} type="submit" disabled={pending}>
        {actionLabel}
      </Button>
      {!pending ? null : (
        <p {...stylex.props(styles.fieldHint)}>Connect your food log to save entries.</p>
      )}
    </form>
  );
}
