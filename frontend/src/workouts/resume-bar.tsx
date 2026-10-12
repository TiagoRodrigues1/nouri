import * as stylex from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";
import { Button } from "../components/ui/button";
import { sessionStats, type Session } from "../lib/workout-session";
import { useNow } from "../lib/use-workout-session";
import { styles } from "./workouts-styles";

// "4:05" or "1:02:09".
export function clockLabel(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");

  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

export function ResumeBar({ session, shell = false }: { session: Session; shell?: boolean }) {
  const now = useNow(1000);

  return (
    <div role="status" {...stylex.props(styles.resume, shell && styles.resumeShell)}>
      <span aria-hidden="true" {...stylex.props(styles.pulse)} />
      <span {...stylex.props(styles.resumeTitle)}>{session.title}</span>
      <span {...stylex.props(styles.resumeClock)}>{clockLabel(sessionStats(session, now).elapsedSeconds)}</span>
      <span {...stylex.props(styles.spacer)} />
      <Button asChild size="sm">
        <Link to="/workouts/session">Resume</Link>
      </Button>
    </div>
  );
}
