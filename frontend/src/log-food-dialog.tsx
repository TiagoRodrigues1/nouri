import * as stylex from "@stylexjs/stylex";
import { styles } from "./form-styles";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "./components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./components/ui/dialog";
import { Label } from "./components/ui/label";
import { Input } from "./components/ui/input";
import { TimePicker } from "./components/ui/time-picker";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { currentTime, dateLabel } from "./lib/time";
import { RecentFoodsTab } from "./recent-foods-tab";
import { SavedMealsTab } from "./saved-meals-tab";
import { SearchFoodsTab } from "./search-foods-tab";
import type { FoodSubmission } from "../../src/food/contract";

type FoodInput = FoodSubmission["food"];

type LogFoodDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string;
  isToday: boolean;
  pending: boolean;
  onSave: (event: FormEvent<HTMLFormElement>, food: FoodInput, time: string) => void;
};

export function LogFoodDialog({ open, onOpenChange, date, isToday, pending, onSave }: LogFoodDialogProps) {
  const [time, setTime] = useState(currentTime);

  // Each time the dialog opens, default the entry time to now.
  useEffect(() => {
    if (open) setTime(currentTime());
  }, [open]);

  return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle {...stylex.props(styles.dialogTitle)}>Log a food</DialogTitle>
          <DialogDescription {...stylex.props(styles.dialogDescription)}>
            Choose a food you logged before, one from the catalog or by barcode, a saved meal, or
            enter one manually. It will be added to {isToday ? "today" : dateLabel(date)}.
          </DialogDescription>
          <div {...stylex.props(styles.timeField)}>
            <Label {...stylex.props(styles.formLabel, styles.timeLabel)} htmlFor="food-time">Time eaten</Label>
            <TimePicker id="food-time" value={time} onChange={setTime} onNow={() => setTime(currentTime())} />
          </div>
          <Tabs defaultValue="recent">
            <TabsList {...stylex.props(styles.widthFull)}>
              <TabsTrigger value="recent" {...stylex.props(styles.flexOne)}>
                Recent
              </TabsTrigger>
              <TabsTrigger value="search" {...stylex.props(styles.flexOne)}>
                Search foods
              </TabsTrigger>
              <TabsTrigger value="meals" {...stylex.props(styles.flexOne)}>
                Saved meals
              </TabsTrigger>
              <TabsTrigger value="manual" {...stylex.props(styles.flexOne)}>
                Add manually
              </TabsTrigger>
            </TabsList>
            <TabsContent value="recent">
              <RecentFoodsTab date={date} time={time} onLogged={() => onOpenChange(false)} />
            </TabsContent>
            <TabsContent value="search">
              <SearchFoodsTab pending={pending} onSave={(event, food) => onSave(event, food, time)} />
            </TabsContent>
            <TabsContent value="meals">
              <SavedMealsTab date={date} time={time} onLogged={() => onOpenChange(false)} />
            </TabsContent>
            <TabsContent value="manual">
              <ManualForm
                disabled={pending}
                onSubmit={(event, food) => onSave(event, food, time)}
              />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
  );
}

function ManualForm({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>, food: FoodInput) => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget);
    onSubmit(event, {
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
      <Button {...stylex.props(styles.widthFull, styles.manualSubmit)} type="submit" disabled={disabled}>
        Add to log
      </Button>
      {!disabled ? null : (
        <p {...stylex.props(styles.fieldHint)}>Connect your food log to save entries.</p>
      )}
    </form>
  );
}
