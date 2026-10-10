import { Flame, Footprints, HeartPulse } from "lucide-react";
import { Progress } from "../components/ui/progress";
import { format, type Overview as OverviewData } from "../lib/api";
import { providerDetails } from "../lib/wearables";
import { colors } from "../theme.stylex";
import { Caption, Empty, Section, Stat, Tile, Value } from "./shared";
import { WorkoutsTile, type WorkoutsProps } from "./workouts";

type ActivityProps = WorkoutsProps & { activity: OverviewData["activity"]; heartRate: OverviewData["heartRate"]; stepsGoal: number | undefined };

// Workouts share a row with steps. Daily totals come only from wearables, so an empty tile says nothing was imported rather than showing zero.
export function ActivitySection({ sports, busy, onDelete, activity, heartRate, stepsGoal }: ActivityProps) {
  return (
    <Section
      title="Activity"
      description="Workouts you log or import, plus steps, active energy, and heart rate from your wearables."
      icon={<Footprints size={18} />}
      color={colors.activity}
    >
      <WorkoutsTile sports={sports} busy={busy} onDelete={onDelete} />
      <Tile title="Steps" icon={<Footprints size={16} />} aside={stepsGoal !== undefined && `${format(stepsGoal)} goal`} wide>
        <Value value={format(activity?.steps)} unit={activity?.steps == null ? undefined : "steps"} />
        {stepsGoal !== undefined && <Progress value={activity?.steps ?? 0} max={stepsGoal} color={colors.activity} aria-label="Steps against your goal" />}
        {activity?.steps == null ? <Empty>No steps imported for this day.</Empty> : <Caption>From {providerDetails[activity.provider].name}</Caption>}
      </Tile>
      <Tile title="Active energy" icon={<Flame size={16} />}>
        <Value value={format(activity?.activeKcal)} unit={activity?.activeKcal == null ? undefined : "kcal"} />
        {activity?.activeKcal == null ? <Empty>No active energy imported for this day.</Empty> : <Caption>Energy burned moving, on top of what the body uses at rest.</Caption>}
      </Tile>
      <Tile title="Heart rate" icon={<HeartPulse size={16} />}>
        <Value value={format(heartRate?.restingBpm)} unit={heartRate?.restingBpm == null ? undefined : "bpm resting"} />
        <HeartRateRange heartRate={heartRate} />
      </Tile>
    </Section>
  );
}

function HeartRateRange({ heartRate }: { heartRate: OverviewData["heartRate"] }) {
  if (!heartRate) return <Empty>No heart rate imported for this day.</Empty>;

  if (!heartRate.range) return <Empty>No average or range for this day.</Empty>;

  return (
    <>
      <Stat label="Average" value={`${format(heartRate.range.averageBpm)} bpm`} />
      <Stat label="Range" value={`${format(heartRate.range.minBpm)}–${format(heartRate.range.maxBpm)} bpm`} />
    </>
  );
}
