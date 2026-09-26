import * as stylex from "@stylexjs/stylex";
import { Fragment, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { Button } from "./components/ui/button";
import { useWater } from "./lib/use-water";
import { useJournal } from "./overview/use-journal";
import { NutritionSection } from "./overview/nutrition";
import { SportsSection } from "./overview/sports";
import { MeasurementsSection } from "./overview/measurements";
import { SleepSection } from "./overview/sleep";
import { styles } from "./overview-styles";
import { maxPhotoBytes } from "../../src/photos/contract";
import { getOverview, occurredAt, timeZone, type RecordPath } from "./lib/api";

const categories = [
  { id: "nutrition", name: "Nutrition" },
  { id: "sports", name: "Sports" },
  { id: "measurements", name: "Measurements" },
  { id: "sleep", name: "Sleep" },
] as const;

type Category = (typeof categories)[number]["id"];

type Tab = "all" | Category;

type OverviewProps = {
  token: string;
  date: string;
  onLogFood: () => void;
  onLogWorkout: () => void;
  onLogSleep: () => void;
  onLogMeasurement: () => void;
  onConnect: () => void;
};

export function Overview({ token, date, onLogFood, onLogWorkout, onLogSleep, onLogMeasurement, onConnect }: OverviewProps) {
  const water = useWater(token, date, onConnect);
  const [tab, setTab] = useState<Tab>("all");
  const journal = useJournal(token);

  const query = useQuery({
    queryKey: ["overview", token, date],
    queryFn: () => getOverview(token, date),
    enabled: Boolean(token),
  });

  function upload(file: File) {
    if (file.size > maxPhotoBytes) {
      toast.error("Photos must be 8 MB or smaller.");

      return;
    }

    const form = new FormData();
    form.set("file", file);
    form.set("occurredAt", occurredAt(date));
    form.set("timeZone", timeZone);
    journal.create.mutate({ path: "/v1/progress-photos", label: "Photo", input: form, signature: JSON.stringify([date, file.name, file.size, file.lastModified]) });
  }

  const data = query.data;
  const remove = (path: RecordPath, label: string) => (entry: { id: string; revision: number }) => journal.remove.mutate({ path, label, ...entry });
  const busy = journal.create.isPending || journal.remove.isPending;

  const sections: Record<Category, ReactNode> = data ? {
    nutrition: <NutritionSection nutrition={data.nutrition} onLogFood={onLogFood} waterPending={water.pending} onAddWater={water.add} />,
    sports: <SportsSection sports={data.sports} busy={busy} onLog={onLogWorkout} onDelete={remove("/v1/workouts", "Workout")} />,
    measurements: (
      <MeasurementsSection
        token={token}
        date={date}
        measurements={data.measurements}
        photos={data.photos}
        busy={busy}
        onLog={onLogMeasurement}
        onDelete={remove("/v1/measurements", "Measurement")}
        onUpload={upload}
        onDeletePhoto={remove("/v1/progress-photos", "Photo")}
      />
    ),
    sleep: <SleepSection sleep={data.sleep} busy={busy} onLog={onLogSleep} onDelete={remove("/v1/sleep-sessions", "Sleep session")} />,
  } : { nutrition: null, sports: null, measurements: null, sleep: null };

  const status = !token ? (
    "Connect your log to see your overview."
  ) : query.isPending ? (
    "Loading your overview…"
  ) : query.isError ? (
    <>
      {query.error.message}{" "}
      <Button variant="outline" size="sm" onClick={() => void query.refetch()}>Try again</Button>
    </>
  ) : null;

  return (
    <>
      <Tabs value={tab} onValueChange={(next) => setTab(next === "all" ? "all" : (categories.find((category) => category.id === next)?.id ?? "all"))}>
        <TabsList sx={styles.tabs} aria-label="Overview categories">
          <TabsTrigger value="all">All</TabsTrigger>
          {categories.map((category) => (
            <TabsTrigger key={category.id} value={category.id}>{category.name}</TabsTrigger>
          ))}
        </TabsList>
        {status ? (
          <p {...stylex.props(styles.status)}>{status}</p>
        ) : (
          <>
            <TabsContent value="all" sx={styles.sections}>
              {categories.map((category) => <Fragment key={category.id}>{sections[category.id]}</Fragment>)}
            </TabsContent>
            {categories.map((category) => (
              <TabsContent key={category.id} value={category.id} sx={styles.sections}>{sections[category.id]}</TabsContent>
            ))}
          </>
        )}
      </Tabs>
    </>
  );
}
