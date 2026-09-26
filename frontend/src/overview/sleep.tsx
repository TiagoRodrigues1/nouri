import * as stylex from "@stylexjs/stylex";
import { BedDouble, Moon, Plus } from "lucide-react";
import { Button } from "../components/ui/button";
import { Progress } from "../components/ui/progress";
import { sleepGoalMinutes } from "../lib/goals";
import { type Overview as OverviewData } from "../lib/api";
import { styles } from "../overview-styles";
import { colors } from "../theme.stylex";
import { Caption, DeleteButton, Empty, Section, Tile, Value, clock, duration } from "./shared";

type SleepProps = { sleep: OverviewData["sleep"]; busy: boolean; onLog: () => void; onDelete: (session: OverviewData["sleep"]["sessions"][number]) => void };

export function SleepSection({ sleep, busy, onLog, onDelete }: SleepProps) {
  const stages = sleep.stages;
  const stageTotal = stages ? stages.awake + stages.light + stages.deep + stages.rem : 0;

  const parts = stages ? [
    { label: "Deep", minutes: stages.deep, color: colors.sleepDeep },
    { label: "Light", minutes: stages.light, color: colors.sleepLight },
    { label: "REM", minutes: stages.rem, color: colors.sleepRem },
    { label: "Awake", minutes: stages.awake, color: colors.sleepAwake },
  ] : [];

  return (
    <Section
      title="Sleep"
      description="Nights count toward the day they end on."
      icon={<Moon size={18} />}
      color={colors.sleep}
      action={<Button variant="outline" size="sm" onClick={onLog}><Plus size={15} /> Log sleep</Button>}
    >
      <Tile title="Time asleep" icon={<BedDouble size={16} />} aside="7–9 h recommended">
        <Value value={sleep.totalMinutes === null ? "—" : duration(sleep.totalMinutes)} />
        <Progress value={sleep.totalMinutes ?? 0} max={sleepGoalMinutes} color={colors.sleep} aria-label="Sleep against 8 hours" />
        <Caption>{sleep.sessions.length === 0 ? "No sleep logged" : `${sleep.sessions.length} ${sleep.sessions.length === 1 ? "session" : "sessions"}`}</Caption>
      </Tile>
      <Tile title="Sleep stages" icon={<Moon size={16} />}>
        {stages && stageTotal > 0 ? (
          <>
            <div {...stylex.props(styles.stageBar)} role="img" aria-label={parts.map((part) => `${part.label} ${duration(part.minutes)}`).join(", ")}>
              {parts.map((part) => <span key={part.label} {...stylex.props(styles.stageSegment(`${(part.minutes / stageTotal) * 100}%`, part.color))} />)}
            </div>
            <div {...stylex.props(styles.rows)}>
              {parts.map((part) => (
                <div key={part.label} {...stylex.props(styles.row)}>
                  <span {...stylex.props(styles.swatch(part.color))} />
                  <span {...stylex.props(styles.rowLabel, styles.grow)}>{part.label}</span>
                  <span {...stylex.props(styles.rowValue)}>{duration(part.minutes)} · {Math.round((part.minutes / stageTotal) * 100)}%</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <Empty>{sleep.sessions.length ? "Add stage minutes when you log sleep to see REM, deep, and light sleep." : "No sleep logged for this day."}</Empty>
        )}
      </Tile>
      <Tile title="Sessions" icon={<BedDouble size={16} />}>
        {sleep.sessions.length === 0 ? (
          <Empty>No sleep logged for this day.</Empty>
        ) : (
          <ul {...stylex.props(styles.list)} aria-label="Logged sleep">
            {sleep.sessions.map((session) => {
              const range = `${clock.format(new Date(session.startedAt))} – ${clock.format(new Date(session.endedAt))}`;

              return (
                <li key={session.id} {...stylex.props(styles.listRow)}>
                  <span {...stylex.props(styles.listText)}>
                    <strong {...stylex.props(styles.listName)}>{range}</strong>
                    <small {...stylex.props(styles.listMeta)}>{duration(session.durationMinutes)}</small>
                  </span>
                  <DeleteButton label={`Delete sleep ${range}`} disabled={busy} onClick={() => onDelete(session)} />
                </li>
              );
            })}
          </ul>
        )}
      </Tile>
    </Section>
  );
}

