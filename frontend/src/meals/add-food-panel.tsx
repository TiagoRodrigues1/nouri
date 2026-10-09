import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { Card } from "../components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { styles as formStyles } from "../form-styles";
import { draftRow, type DraftRow } from "../lib/saved-meals";
import { ManualFoodForm } from "../manual-food-form";
import { RecentFoodPicker } from "../recent-foods-tab";
import { SearchFoodPicker } from "../search-foods-tab";
import { recordedFood } from "../../../src/food/contract";
import { styles } from "./meals-styles";

// The food dialog's pickers, adding to the meal instead of the log. A Ciqual food is added by reference so the
// server measures it; a scanned or typed food is added as its label reads.
export function AddFoodPanel({ onAdd }: { onAdd: (row: DraftRow) => void }) {
  // Remounting the manual form clears it for the next food.
  const [manualKey, setManualKey] = useState(0);

  return (
    <Card {...stylex.props(styles.panel)}>
      <h2 {...stylex.props(styles.panelTitle)}>Add food</h2>
      <Tabs defaultValue="recent">
        <TabsList {...stylex.props(formStyles.widthFull)}>
          <TabsTrigger value="recent" {...stylex.props(formStyles.flexOne)}>Recent</TabsTrigger>
          <TabsTrigger value="search" {...stylex.props(formStyles.flexOne)}>Search</TabsTrigger>
          <TabsTrigger value="manual" {...stylex.props(formStyles.flexOne)}>Manual</TabsTrigger>
        </TabsList>
        <TabsContent value="recent">
          <RecentFoodPicker
            actionLabel="Add to meal"
            onPick={(recent, amount) => onAdd(draftRow({ kind: "entry", entryId: recent.entryId }, recent.food, amount))}
          />
        </TabsContent>
        <TabsContent value="search">
          <SearchFoodPicker
            actionLabel="Add to meal"
            onPick={(food, preview) => onAdd(draftRow({ kind: "submitted", food }, preview))}
          />
        </TabsContent>
        <TabsContent value="manual">
          <ManualFoodForm
            key={manualKey}
            actionLabel="Add to meal"
            onPick={(food) => {
              onAdd(draftRow({ kind: "submitted", food }, recordedFood(food)));
              setManualKey((key) => key + 1);
            }}
          />
        </TabsContent>
      </Tabs>
    </Card>
  );
}
