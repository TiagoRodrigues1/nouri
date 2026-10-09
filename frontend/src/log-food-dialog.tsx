import * as stylex from "@stylexjs/stylex";
import { styles } from "./form-styles";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./components/ui/dialog";
import { Label } from "./components/ui/label";
import { TimePicker } from "./components/ui/time-picker";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { currentTime, dateLabel } from "./lib/time";
import { RecentFoodsTab } from "./recent-foods-tab";
import { SavedMealsTab } from "./saved-meals-tab";
import { SearchFoodPicker } from "./search-foods-tab";
import { ManualFoodForm } from "./manual-food-form";
import type { FoodSubmission } from "../../src/food/contract";

type FoodInput = FoodSubmission["food"];

type LogFoodDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string;
  isToday: boolean;
  pending: boolean;
  onSave: (food: FoodInput, time: string) => void;
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
                Meals
              </TabsTrigger>
              <TabsTrigger value="manual" {...stylex.props(styles.flexOne)}>
                Add manually
              </TabsTrigger>
            </TabsList>
            <TabsContent value="recent">
              <RecentFoodsTab date={date} time={time} onLogged={() => onOpenChange(false)} />
            </TabsContent>
            <TabsContent value="search">
              <SearchFoodPicker actionLabel="Add to log" pending={pending} onPick={(food) => onSave(food, time)} />
            </TabsContent>
            <TabsContent value="meals">
              <SavedMealsTab date={date} time={time} onLogged={() => onOpenChange(false)} onManage={() => onOpenChange(false)} />
            </TabsContent>
            <TabsContent value="manual">
              <ManualFoodForm actionLabel="Add to log" pending={pending} onPick={(food) => onSave(food, time)} />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
  );
}
