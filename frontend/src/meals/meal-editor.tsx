import * as stylex from "@stylexjs/stylex";
import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { ChevronLeft, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Checkbox } from "../components/ui/checkbox";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { TimePicker } from "../components/ui/time-picker";
import { format, type SavedMeal } from "../lib/api";
import { dayQueryOptions } from "../lib/day-query";
import { nutrientLine, unitLabels } from "../lib/food-text";
import { draftItems, entryRows, maxMealItems, rowFood, savedRows, type DraftRow } from "../lib/saved-meals";
import { totalNutrients } from "../../../src/food/contract";
import { currentTime, dateLabel, timeZone } from "../lib/time";
import { useDeleteMeal, useSaveMeal, useSavedMeals } from "../lib/use-saved-meals";
import { useExitingRows } from "../lib/use-exiting-rows";
import { Bone, Loading } from "../loading";
import { queryFallback } from "../query-status";
import { styles as formStyles } from "../form-styles";
import { AddFoodPanel } from "./add-food-panel";
import { styles } from "./meals-styles";

// A new meal, empty or, from the Timeline's Save as meal, holding that day's foods.
export function NewMealPage() {
  const { date } = useSearch({ strict: false });

  // Keyed by date, so moving between days or to an empty meal starts over.
  return date === undefined ? <MealEditor key="new" meal={null} initialRows={[]} /> : <MealFromDay key={date} date={date} />;
}

function MealFromDay({ date }: { date: string }) {
  const day = useQuery(dayQueryOptions(date));

  // A failed refetch keeps the editor, so a draft is never lost to it.
  if (!day.data) return queryFallback(day, <EditorSkeleton label="Loading the day's foods…" />, styles.hint);

  return <MealEditor meal={null} initialRows={entryRows(day.data.food.entries)} from={date} />;
}

export function EditMealPage() {
  const { mealId } = useParams({ strict: false });
  const query = useSavedMeals();
  const meal = query.data?.find((candidate) => candidate.id === mealId);

  if (!query.data) return queryFallback(query, <EditorSkeleton label="Loading the meal…" />, styles.hint);

  if (!meal) {
    return (
      <>
        <BackLink />
        <p {...stylex.props(styles.hint)}>This meal no longer exists.</p>
      </>
    );
  }

  // Keyed by revision, so a saved edit restarts from what the server kept.
  return <MealEditor key={`${meal.id}:${meal.revision}`} meal={meal} initialRows={savedRows(meal)} />;
}

function BackLink() {
  return (
    <Link to="/meals" {...stylex.props(styles.back, styles.pageTop)}>
      <ChevronLeft size={15} /> Meals
    </Link>
  );
}

function MealEditor({ meal, initialRows, from }: { meal: SavedMeal | null; initialRows: DraftRow[]; from?: string }) {
  const navigate = useNavigate();
  const toList = () => void navigate({ to: "/meals" });
  const save = useSaveMeal(toList);
  const remove = useDeleteMeal(toList);
  const [name, setName] = useState(meal?.name ?? "");
  const [rows, setRows] = useState(initialRows);
  const rowMotion = useExitingRows();
  const [daily, setDaily] = useState(Boolean(meal?.daily));
  const [dailyTime, setDailyTime] = useState(meal?.daily?.time ?? "08:00");
  const totals = totalNutrients(rows.map((row) => rowFood(row).nutrients));
  const tooMany = rows.length > maxMealItems;

  function add(row: DraftRow) {
    rowMotion.add(row.key);
    setRows((current) => [...current, row]);
    toast.success(`${row.food.name} added to the meal.`);
  }

  function change(key: string, amount: string) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, amount } : row)));
  }

  // The browser checks the name and each amount before this runs.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const items = draftItems(rows);

    if (!items || items.length === 0 || tooMany) return;
    save.mutate({ meal, input: { name: name.trim(), items, daily: daily ? { time: dailyTime, timeZone } : null } });
  }

  return (
    <>
      <BackLink />
      <header {...stylex.props(styles.header)}>
        <h1 {...stylex.props(styles.headline)}>{meal ? meal.name : "New meal"}</h1>
      </header>
      <p {...stylex.props(styles.intro)}>
        {from ? `Starting from the foods of ${dateLabel(from)}. Remove what doesn't belong and adjust the amounts.` : "Add foods from your recent foods, the catalog, a barcode, or a label."}
      </p>
      <div {...stylex.props(styles.editor)}>
        <Card {...stylex.props(styles.panel)}>
          <form {...stylex.props(styles.form)} onSubmit={submit}>
            <div>
              <Label {...stylex.props(formStyles.formLabel)} htmlFor="meal-name">Meal name</Label>
              <Input id="meal-name" {...stylex.props(styles.nameInput)} maxLength={80} placeholder="e.g. Usual breakfast" value={name} onChange={(event) => setName(event.target.value)} required />
            </div>
            <div {...stylex.props(styles.section)}>
              <h2 {...stylex.props(styles.panelTitle)}>Foods</h2>
              {rows.length === 0 ? (
                <p {...stylex.props(styles.noFoods)}>No foods yet. Add some from the panel{" "}<span aria-hidden>→</span></p>
              ) : (
                <ul {...stylex.props(styles.rows)} aria-label="Foods in this meal">
                  {rows.map((row, index) => <FoodRow key={row.key} row={row} first={index === 0} motion={rowMotion.rowProps(row.key)} onAmount={(amount) => change(row.key, amount)} onRemove={() => rowMotion.remove(row.key, () => setRows((current) => current.filter((other) => other.key !== row.key)))} />)}
                </ul>
              )}
              {tooMany && <p {...stylex.props(styles.hint, styles.danger)} role="alert">A meal holds up to {maxMealItems} foods.</p>}
            </div>
            <div {...stylex.props(styles.totals)} aria-label="Meal totals">
              <Total label="kcal" value={format(totals.kcal)} />
              <Total label="Protein g" value={format(totals.proteinG, 1)} />
              <Total label="Carbs g" value={format(totals.carbsG, 1)} />
              <Total label="Fat g" value={format(totals.fatG, 1)} />
            </div>
            <div {...stylex.props(styles.dailyBox)}>
              <div {...stylex.props(styles.daily)}>
                <Checkbox id="meal-daily" checked={daily} onCheckedChange={(checked) => setDaily(checked === true)} />
                <label htmlFor="meal-daily" {...stylex.props(styles.dailyLabel, daily && styles.dailyOn)}>Log every day at</label>
                <TimePicker id="meal-daily-time" value={dailyTime} onChange={setDailyTime} onNow={() => setDailyTime(currentTime())} />
              </div>
              <p {...stylex.props(styles.hint)}>Its foods are already on each day's log from today. Delete one on a day you skip it.</p>
            </div>
            <div {...stylex.props(styles.actions)}>
              {meal && (
                <Button type="button" variant="ghost" {...stylex.props(styles.danger)} disabled={remove.isPending} onClick={() => remove.mutate(meal)}>
                  Delete meal
                </Button>
              )}
              <span {...stylex.props(styles.spacer)} />
              <Button type="button" variant="outline" onClick={toList}>Cancel</Button>
              <Button type="submit" disabled={save.isPending || rowMotion.busy || rows.length === 0 || tooMany}>Save meal</Button>
            </div>
          </form>
        </Card>
        <AddFoodPanel onAdd={add} />
      </div>
    </>
  );
}

type RowMotionProps = ReturnType<ReturnType<typeof useExitingRows>["rowProps"]>;

function FoodRow({ row, first, motion, onAmount, onRemove }: { row: DraftRow; first: boolean; motion: RowMotionProps; onAmount: (amount: string) => void; onRemove: () => void }) {
  const { name, quantity, nutrients } = rowFood(row);

  return (
    <li {...motion} {...stylex.props(styles.row, !first && styles.rowBorder)}>
      <span {...stylex.props(styles.rowText)}>
        <strong {...stylex.props(styles.rowName)}>{name}</strong>
        <small {...stylex.props(styles.rowMeta)}>{nutrientLine(nutrients)}</small>
      </span>
      <span {...stylex.props(styles.amount)}>
        <Input
          type="number"
          min="0.001"
          max="10000"
          step="0.001"
          aria-label={`Amount of ${name} in ${unitLabels[quantity.unit]}`}
          value={row.amount}
          onChange={(event) => onAmount(event.target.value)}
          required
        />
        <span {...stylex.props(styles.unit)}>{unitLabels[quantity.unit]}</span>
      </span>
      <Button type="button" variant="ghost" size="icon" {...stylex.props(styles.remove)} aria-label={`Remove ${name}`} title="Remove" onClick={onRemove}>
        <X size={15} />
      </Button>
    </li>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <span {...stylex.props(styles.total)}>
      <strong {...stylex.props(styles.totalValue)}>{value}</strong>
      <span {...stylex.props(styles.totalLabel)}>{label}</span>
    </span>
  );
}

// The editor's two panels: name, foods, and totals on the left; the food picker on the right.
function EditorSkeleton({ label }: { label: string }) {
  return (
    <Loading label={label}>
      <BackLink />
      <header {...stylex.props(styles.header)}><Bone width={220} height={36} /></header>
      <div {...stylex.props(styles.intro)}><Bone width="40%" height={12} /></div>
      <div {...stylex.props(styles.editor)}>
        <Card {...stylex.props(styles.panel)}>
          <Bone width="100%" height={40} />
          <div {...stylex.props(styles.section)}>
            {[0, 1, 2].map((index) => <Bone key={index} width="100%" height={46} />)}
          </div>
          <Bone width="100%" height={58} />
        </Card>
        <Card {...stylex.props(styles.panel)}>
          <Bone width={80} height={13} />
          <Bone width="100%" height={34} />
          <Bone width="100%" height={180} />
        </Card>
      </div>
    </Loading>
  );
}
