import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { BedDouble, Moon, Plus } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Progress } from "../components/ui/progress";
import { type Overview as OverviewData } from "../lib/api";
import { styles } from "../overview-styles";
import { colors } from "../theme.stylex";
import { clock } from "../lib/time";
import { providerDetails } from "../lib/wearables";
import { Caption, DeleteButton, Empty, Section, Tile, Value, duration } from "./shared";

type Session = OverviewData["sleep"]["sessions"][number];

type SleepProps = { connection: ReactNode; sleep: OverviewData["sleep"]; goalMinutes: number | undefined; busy: boolean; onLog: () => void; onDelete: (session: Session) => void };

// Imported sleep names its device and service; it changes only at its source, so it has no delete button.
function origin(session: Session) {
  if (session.source.kind === "manual") return duration(session.durationMinutes);
  const service = providerDetails[session.source.provider].name;
  const source = session.source.device ? `${session.source.device} · ${service}` : service;

  return `${duration(session.durationMinutes)} · ${source}`;
}

export function SleepSection({ connection, sleep, goalMinutes, busy, onLog, onDelete }: SleepProps) {
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
      <Tile title="Time asleep" icon={<BedDouble size={16} />} aside={goalMinutes !== undefined && `${duration(goalMinutes)} goal`}>
        <Value value={sleep.totalMinutes === null ? "—" : duration(sleep.totalMinutes)} />
        {goalMinutes !== undefined && <Progress value={sleep.totalMinutes ?? 0} max={goalMinutes} color={colors.sleep} aria-label="Sleep against your goal" />}
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
                    <small {...stylex.props(styles.listMeta)}>{origin(session)}</small>
                  </span>
                  {session.source.kind !== "manual" ? <Badge variant="outline">Imported</Badge> : <DeleteButton label={`Delete sleep ${range}`} disabled={busy} onClick={() => onDelete(session)} />}
                </li>
              );
            })}
          </ul>
        )}
      </Tile>
      {connection}
    </Section>
  );
}
