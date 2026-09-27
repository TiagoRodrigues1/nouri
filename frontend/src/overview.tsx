import * as stylex from "@stylexjs/stylex";
import { Fragment, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { useTargets } from "./lib/use-targets";
import { queryStatus } from "./query-status";
import { TargetsNotice } from "./targets-notice";
import { NutritionSection } from "./overview/nutrition";
import { SportsSection } from "./overview/sports";
import { MeasurementsSection } from "./overview/measurements";
import { SleepSection } from "./overview/sleep";
import { SupplementsSection } from "./overview/supplements";
import { styles } from "./overview-styles";
import { maxPhotoBytes } from "../../src/photos/contract";
import { getOverview, type RecordPath } from "./lib/api";
import { occurredAt, timeZone } from "./lib/time";
import { useDashboardPage } from "./dashboard-page-context";
import { recordPaths } from "../../src/journal/paths";

const categories = [
  { id: "nutrition", name: "Nutrition" },
  { id: "sports", name: "Sports" },
  { id: "measurements", name: "Measurements" },
  { id: "sleep", name: "Sleep" },
  { id: "supplements", name: "Supplements" },
] as const;

type Category = (typeof categories)[number]["id"];

type Tab = "all" | Category;

export function Overview() {
  const { token, date, onLogFood, onLogWorkout, onLogSleep, onLogMeasurement, journal, water } = useDashboardPage();
  const [tab, setTab] = useState<Tab>("all");

  const query = useQuery({
    queryKey: ["overview", token, date],
    queryFn: () => getOverview(token, date),
    enabled: Boolean(token),
  });

  async function upload(file: File) {
    if (file.size > maxPhotoBytes) {
      toast.error("Photos must be 8 MB or smaller.");

      return;
    }

    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const form = new FormData();
    form.set("file", file);
    form.set("occurredAt", occurredAt(date));
    form.set("timeZone", timeZone);
    journal.create.mutate({ path: recordPaths.photo, label: "Photo", input: form, signature: JSON.stringify([date, hash]) });
  }

  const data = query.data;
  const targets = useTargets(token, date);
  const remove = (path: RecordPath, label: string) => (entry: { id: string; revision: number }) => journal.remove.mutate({ path, label, ...entry });
  const busy = journal.create.isPending || journal.remove.isPending;

  const sections: Record<Category, ReactNode> = data ? {
    nutrition: <NutritionSection nutrition={data.nutrition} targets={targets.targets} onLogFood={onLogFood} waterPending={water.pending} onAddWater={water.add} />,
    sports: <SportsSection sports={data.sports} busy={busy} onLog={onLogWorkout} onDelete={remove("/v1/workouts", "Workout")} />,
    measurements: (
      <MeasurementsSection
        token={token}
        date={date}
        measurements={data.measurements}
        weightGoalKg={targets.targets?.weightKg ?? null}
        photos={data.photos}
        busy={busy}
        onLog={onLogMeasurement}
        onDelete={remove("/v1/measurements", "Measurement")}
        onUpload={upload}
        onDeletePhoto={remove("/v1/progress-photos", "Photo")}
      />
    ),
    sleep: <SleepSection sleep={data.sleep} goalMinutes={targets.targets?.sleepMinutes} busy={busy} onLog={onLogSleep} onDelete={remove("/v1/sleep-sessions", "Sleep session")} />,
    supplements: <SupplementsSection day={data.supplements} />,
  } : { nutrition: null, sports: null, measurements: null, sleep: null, supplements: null };

  const status = queryStatus(token, query, { disconnected: "Connect your log to see your overview.", loading: "Loading your overview…" });

  return (
    <>
      <Tabs value={tab} onValueChange={(next) => setTab(next === "all" ? "all" : (categories.find((category) => category.id === next)?.id ?? "all"))}>
        <TabsList {...stylex.props(styles.tabs)} aria-label="Overview categories">
          <TabsTrigger value="all">All</TabsTrigger>
          {categories.map((category) => (
            <TabsTrigger key={category.id} value={category.id}>{category.name}</TabsTrigger>
          ))}
        </TabsList>
        {status ? (
          <p {...stylex.props(styles.status)}>{status}</p>
        ) : (
          <>
            <TargetsNotice state={targets} style={styles.targetsNotice} />
            <TabsContent value="all" {...stylex.props(styles.sections)}>
              {categories.map((category) => <Fragment key={category.id}>{sections[category.id]}</Fragment>)}
            </TabsContent>
            {categories.map((category) => (
              <TabsContent key={category.id} value={category.id} {...stylex.props(styles.sections)}>{sections[category.id]}</TabsContent>
            ))}
          </>
        )}
      </Tabs>
    </>
  );
}
