import * as stylex from "@stylexjs/stylex";
import { useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { styles } from "./form-styles";
import { Button } from "./components/ui/button";
import { Checkbox } from "./components/ui/checkbox";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { createCommunityFood } from "./lib/api";
import { useIdempotentWrite } from "./lib/use-idempotent";
import { manualFood, per100Max, scaleFood, type CommunityFoodInput, type FoodInput, type RecordedFood } from "../../src/food/contract";

const nutrientFields = [
  ["kcal", "Calories (kcal)", per100Max.kcal],
  ["protein", "Protein (g)", per100Max.proteinG],
  ["carbs", "Carbs (g)", per100Max.carbsG],
  ["fat", "Fat (g)", per100Max.fatG],
] as const;

// A food typed from its label: nutrition per 100 g or ml, and the amount eaten. With a barcode, or when the person
// chooses to share it, the food joins Nouri's foods first, so others find it once it is reviewed. The caller gets
// the eaten amount as the journal records it either way.
export function ManualFoodForm({
  actionLabel,
  pending = false,
  barcode = null,
  onPick,
}: {
  actionLabel: string;
  pending?: boolean;
  barcode?: string | null;
  onPick: (food: FoodInput["food"]) => void;
}) {
  const [unit, setUnit] = useState<"g" | "ml">("g");
  const [share, setShare] = useState(false);
  const shared = barcode !== null || share;
  const queryClient = useQueryClient();

  // The label this form last added. Sending it again, after the log failed, logs the same food instead of adding
  // the label twice.
  const added = useRef<{ label: string; food: RecordedFood } | null>(null);
  const add = useIdempotentWrite((label: CommunityFoodInput, key) => createCommunityFood(key, label), { refresh: [] });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const text = (name: string) => form.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value.trim() ?? "";

    // A value the label leaves out stays unknown rather than zero.
    const optional = (name: string) => text(name) === "" ? null : Number(text(name));

    const nutrients = {
      kcal: optional("kcal"),
      proteinG: optional("protein"),
      carbsG: optional("carbs"),
      fatG: optional("fat"),
    };

    const name = text("name");
    const amount = Number(text("amount"));
    const pick = (per100: RecordedFood) => onPick(manualFood(scaleFood(per100, amount)));

    if (!shared) {
      pick({ name, quantity: { amount: 100, unit }, nutrients, catalogRef: null });

      return;
    }

    const serving = optional("serving");
    const label = { name, brand: text("brand") || null, barcode, unit, nutrientsPer100: nutrients, serving: serving === null ? null : { amount: serving } };
    const signature = JSON.stringify(label);

    if (added.current?.label === signature) {
      pick(added.current.food);

      return;
    }

    add.mutate(label, {
      onSuccess: ({ result }) => {
        added.current = { label: signature, food: result.food };
        pick(result.food);
        void queryClient.invalidateQueries({ queryKey: ["foods"] });
      },
    });
  }

  return (
    <form {...stylex.props(styles.formStack)} onSubmit={submit}>
      {barcode !== null && <p {...stylex.props(styles.fieldHint)}>Barcode {barcode}. Type its label below.</p>}
      <div>
        <Label {...stylex.props(styles.formLabel)} htmlFor="food-name">Food name</Label>
        <Input id="food-name" name="name" maxLength={200} placeholder="e.g. Homemade granola" required />
      </div>
      <div {...stylex.props(styles.manualGrid)}>
        <div>
          <Label {...stylex.props(styles.formLabel)} htmlFor="food-brand">Brand (optional)</Label>
          <Input id="food-brand" name="brand" maxLength={100} />
        </div>
        <div>
          <Label {...stylex.props(styles.formLabel)} htmlFor="food-unit">Label is per</Label>
          <Select value={unit} onValueChange={(next) => setUnit(next === "ml" ? "ml" : "g")}>
            <SelectTrigger id="food-unit" {...stylex.props(styles.selectTrigger)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="g">100 g</SelectItem>
              <SelectItem value="ml">100 ml</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <p {...stylex.props(styles.formSubhead)}>NUTRITION PER 100 {unit.toUpperCase()}</p>
      <p {...stylex.props(styles.fieldHint)}>Leave a value blank when the label doesn't give it.</p>
      <div {...stylex.props(styles.manualGrid)}>
        {nutrientFields.map(([name, label, max]) => (
          <div key={name}>
            <Label {...stylex.props(styles.formLabel)} htmlFor={`manual-${name}`}>{label}</Label>
            <Input id={`manual-${name}`} name={name} type="number" min="0" max={max} step="0.001" />
          </div>
        ))}
      </div>
      {/* Up to 10 kg or l, as for a Ciqual food, so the scaled nutrients stay within what an entry holds. */}
      <div {...stylex.props(styles.manualGrid)}>
        <div>
          <Label {...stylex.props(styles.formLabel)} htmlFor="manual-serving">Serving in {unit} (optional)</Label>
          <Input id="manual-serving" name="serving" type="number" min="0.001" max="10000" step="0.001" />
        </div>
        <div>
          <Label {...stylex.props(styles.formLabel)} htmlFor="manual-amount">Amount eaten in {unit}</Label>
          <Input id="manual-amount" name="amount" type="number" min="0.001" max="10000" step="0.001" required />
        </div>
      </div>
      {barcode === null && (
        <div {...stylex.props(styles.shareRow)}>
          <Checkbox id="manual-share" checked={share} onCheckedChange={(checked) => setShare(checked === true)} />
          <Label htmlFor="manual-share">Share with other Nouri users</Label>
        </div>
      )}
      {shared && <p {...stylex.props(styles.fieldHint)}>It joins Nouri's foods. Others find it once it's reviewed.</p>}
      <Button {...stylex.props(styles.widthFull, styles.manualSubmit)} type="submit" disabled={pending || add.isPending}>
        {actionLabel}
      </Button>
      {!pending ? null : (
        <p {...stylex.props(styles.fieldHint)}>Connect your food log to save entries.</p>
      )}
    </form>
  );
}
