import * as stylex from "@stylexjs/stylex";
import { styles } from "./form-styles";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./components/ui/dialog";
import { Label } from "./components/ui/label";
import { TimePicker } from "./components/ui/time-picker";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { currentTime, dateLabel, occurredAt, timeZone } from "./lib/time";
import { rowSelection } from "./lib/food-selection";
import type { FoodRow } from "./lib/saved-meals";
import { useLogFoods } from "./lib/use-recent-foods";
import { RecentFoodPicker } from "./recent-foods-tab";
import { SelectedFoods } from "./selected-foods";
import { SavedMealsTab } from "./saved-meals-tab";
import { SearchFoodPicker } from "./search-foods-tab";
import { ManualFoodForm } from "./manual-food-form";
import { maxBatchFoods, type FoodSubmission } from "../../src/food/contract";

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
  const [selected, setSelected] = useState<FoodRow[]>([]);
  const logSelected = useLogFoods(() => onOpenChange(false));

  // Each time the dialog opens, default the entry time to now and start with nothing ticked.
  useEffect(() => {
    if (open) {
      setTime(currentTime());
      setSelected([]);
    }
  }, [open]);

  const selection = rowSelection(
    selected,
    (row) => (selected.length >= maxBatchFoods ? toast.error(`You can log up to ${maxBatchFoods} foods at once.`) : setSelected([...selected, row])),
    (key) => setSelected(selected.filter((row) => row.key !== key)),
  );

  return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle {...stylex.props(styles.dialogTitle)}>Log a food</DialogTitle>
          <DialogDescription {...stylex.props(styles.dialogDescription)}>
            Tick foods you logged before or found in the catalog or by barcode, log a saved meal, or
            enter one manually. They will be added to {isToday ? "today" : dateLabel(date)}.
          </DialogDescription>
          <div {...stylex.props(styles.timeField)}>
            <Label {...stylex.props(styles.formLabel, styles.timeLabel)} htmlFor="food-time">Time eaten</Label>
            <TimePicker id="food-time" value={time} onChange={setTime} onNow={() => setTime(currentTime())} />
          </div>
          <Tabs defaultValue="recent">
            <TabsList {...stylex.props(styles.widthFull)}>
              <TabsTrigger value="recent" {...stylex.props(styles.flexOne, styles.compactTab)}>
                Recent
              </TabsTrigger>
              <TabsTrigger value="search" {...stylex.props(styles.flexOne, styles.compactTab)}>
                Search foods
              </TabsTrigger>
              <TabsTrigger value="meals" {...stylex.props(styles.flexOne, styles.compactTab)}>
                Meals
              </TabsTrigger>
              <TabsTrigger value="manual" {...stylex.props(styles.flexOne, styles.compactTab)}>
                Add manually
              </TabsTrigger>
            </TabsList>
            <TabsContent value="recent">
              <RecentFoodPicker selection={selection} />
            </TabsContent>
            <TabsContent value="search">
              <SearchFoodPicker selection={selection} />
            </TabsContent>
            <TabsContent value="meals">
              <SavedMealsTab date={date} time={time} onLogged={() => onOpenChange(false)} onManage={() => onOpenChange(false)} />
            </TabsContent>
            <TabsContent value="manual">
              <ManualFoodForm actionLabel="Add to log" pending={pending} onPick={(food) => onSave(food, time)} />
            </TabsContent>
          </Tabs>
          {selected.length > 0 && (
            <SelectedFoods
              rows={selected}
              pending={logSelected.isPending}
              onChange={setSelected}
              onLog={(items) => logSelected.mutate({ occurredAt: occurredAt(date, time), timeZone, items })}
            />
          )}
        </DialogContent>
      </Dialog>
  );
}
