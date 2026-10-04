import * as stylex from "@stylexjs/stylex";
import { Fragment, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { useTargetsQuery } from "./lib/use-targets";
import { queryStatus } from "./query-status";
import { SportsSection } from "./overview/sports";
import { MeasurementsSection } from "./overview/measurements";
import { SleepSection } from "./overview/sleep";
import { ActivitySection } from "./overview/activity";
import { styles } from "./overview-styles";
import { maxPhotoBytes, maxThumbnailBytes } from "../../src/photos/contract";
import type { RecordPath } from "./lib/api";
import { overviewQueryOptions } from "./lib/day-query";
import { occurredAt, timeZone } from "./lib/time";
import { useDashboardPage } from "./dashboard-page-context";
import { recordPaths } from "../../src/journal/paths";

// Food, water, and supplements live on Today, so the Overview covers the rest of the day.
const categories = [
  { id: "sports", name: "Sports" },
  { id: "activity", name: "Activity" },
  { id: "measurements", name: "Measurements" },
  { id: "sleep", name: "Sleep" },
] as const;

type Category = (typeof categories)[number]["id"];

type Tab = "all" | Category;

// Grid tiles are about 150 px wide at 3:4, so a 320 px short side stays sharp on a 2x screen.
const thumbnailShortSide = 320;

const thumbnailLongSide = 960;

// A small JPEG for the photo grid. Null when the browser cannot decode the image, so the grid falls back to the original.
async function thumbnailOf(file: File): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, thumbnailShortSide / Math.min(bitmap.width, bitmap.height), thumbnailLongSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");

    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");

    if (!context) return null;
    // JPEG has no transparency, so a PNG's clear areas become white rather than black.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));

    return blob && blob.size <= maxThumbnailBytes ? blob : null;
  } catch {
    return null;
  }
}

export function Overview() {
  const { date, journal } = useDashboardPage();
  const [tab, setTab] = useState<Tab>("all");

  const query = useQuery(overviewQueryOptions(date));

  async function upload(file: File) {
    if (file.size > maxPhotoBytes) {
      toast.error("Photos must be 8 MB or smaller.");

      return;
    }

    const [digest, thumbnail] = await Promise.all([crypto.subtle.digest("SHA-256", await file.arrayBuffer()), thumbnailOf(file)]);
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const form = new FormData();
    form.set("file", file);

    if (thumbnail) form.set("thumbnail", thumbnail, "thumbnail.jpg");
    form.set("occurredAt", occurredAt(date));
    form.set("timeZone", timeZone);
    journal.create.mutate({ path: recordPaths.photo, label: "Photo", input: form, signature: JSON.stringify([date, hash]) });
  }

  const data = query.data;
  const targetsQuery = useTargetsQuery(date);
  const targets = targetsQuery.data?.targets;
  // A failed refetch keeps the cached targets on screen, so the notice shows only while there are none.
  const targetsStatus = targets ? null : queryStatus(targetsQuery, "Loading your targets…", "Targets could not load: ");
  const remove = (path: RecordPath, label: string) => (entry: { id: string; revision: number }) => journal.remove.mutate({ path, label, ...entry });
  const busy = journal.create.isPending || journal.remove.isPending;

  const sections: Record<Category, ReactNode> = data ? {
    sports: <SportsSection sports={data.sports} busy={busy} onDelete={remove(recordPaths.workout, "Workout")} />,
    activity: <ActivitySection activity={data.activity} heartRate={data.heartRate} stepsGoal={targets?.steps} />,
    measurements: (
      <MeasurementsSection
        date={date}
        measurements={data.measurements}
        weightGoalKg={targets?.weightKg ?? null}
        photos={data.photos}
        busy={busy}
        onDelete={remove(recordPaths.measurement, "Measurement")}
        onUpload={upload}
        onDeletePhoto={remove(recordPaths.photo, "Photo")}
      />
    ),
    sleep: <SleepSection sleep={data.sleep} goalMinutes={targets?.sleepMinutes} busy={busy} onDelete={remove(recordPaths.sleep, "Sleep session")} />,
  } : { sports: null, activity: null, measurements: null, sleep: null };

  const status = queryStatus(query, "Loading your overview…");

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
            {targetsStatus && <p {...stylex.props(styles.targetsNotice)}>{targetsStatus}</p>}
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
