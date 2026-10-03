import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ChartColumn } from "lucide-react";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui/table";
import { useDashboardPage } from "./dashboard-page-context";
import { format, type ExerciseSession } from "./lib/api";
import { exerciseHistoryQueryOptions, sessionsUpTo, setsLabel } from "./lib/exercise-history";
import { shortDayLabel } from "./lib/time";
import { ProgressChart } from "./progress-chart";
import { queryStatus } from "./query-status";
import { styles } from "./progress-styles";

export function Progress() {
  const { date } = useDashboardPage();
  const selected = useSearch({ from: "/progress", select: (search) => search.exercise });
  const navigate = useNavigate();
  const query = useQuery(exerciseHistoryQueryOptions());
  const status = queryStatus(query, "Loading your exercises…");

  if (status || !query.data) return <p {...stylex.props(styles.status)}>{status}</p>;

  // The header date bounds the history, so stepping back shows what you had done by then.
  const exercises = query.data.exercises
    .map((exercise) => ({ ...exercise, sessions: sessionsUpTo(exercise, date) }))
    .filter((exercise) => exercise.sessions.length > 0);

  const exercise = exercises.find((candidate) => candidate.key === selected) ?? exercises[0];

  if (!exercise) {
    return <p {...stylex.props(styles.status)}>No strength exercises logged by this day. Log a strength workout with its exercises to follow them here.</p>;
  }

  // Bodyweight exercises have no weight to chart, so they follow total reps instead.
  const weighted = exercise.sessions.some((session) => session.topWeightKg !== null);

  const charted = exercise.sessions.flatMap((session) => {
    const value = weighted ? session.topWeightKg : session.totalReps;

    return value === null ? [] : [{ date: session.date, value, label: `${shortDayLabel(session.date)} · ${setsLabel(session)}` }];
  });

  const best = charted.reduce<(typeof charted)[number] | undefined>((top, point) => (top && top.value >= point.value ? top : point), undefined);

  const count = exercise.sessions.length;
  const newest = [...exercise.sessions].reverse();

  return (
    <div {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.toolbar)}>
        <Select value={exercise.key} onValueChange={(key) => void navigate({ to: "/progress", search: { date, exercise: key } })}>
          <SelectTrigger aria-label="Exercise" {...stylex.props(styles.picker)}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {exercises.map((option) => (
              <SelectItem key={option.key} value={option.key}>{option.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p {...stylex.props(styles.summary)}>
          {count === 1 ? "1 session" : `${count} sessions`} since {shortDayLabel(exercise.sessions[0]?.date ?? date)}
          {best && <>. Best: <strong>{format(best.value, 1)} {weighted ? "kg" : "reps"}</strong> on {shortDayLabel(best.date)}</>}
        </p>
      </div>
      <Card {...stylex.props(styles.card)}>
        <h2 {...stylex.props(styles.cardTitle)}>{weighted ? "Top weight per session (kg)" : "Total reps per session"}</h2>
        <ProgressChart points={charted} label={`${exercise.name}, ${weighted ? "top weight in kilograms" : "total reps"}`} unit={weighted ? "kg" : "reps"} />
      </Card>
      <Card {...stylex.props(styles.tableCard)}>
        <Table aria-label={`${exercise.name} sessions`}>
          <TableHeader>
            <TableRow>
              <TableHead {...stylex.props(styles.dayColumn)}>Day</TableHead>
              <TableHead>Sets</TableHead>
              <TableHead {...stylex.props(styles.number)}>Top weight</TableHead>
              <TableHead {...stylex.props(styles.number)}>Reps</TableHead>
              <TableHead {...stylex.props(styles.number)}>Volume</TableHead>
              <TableHead {...stylex.props(styles.number)}>Open</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {newest.map((session) => <SessionRow key={`${session.workoutId}`} session={session} />)}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function SessionRow({ session }: { session: ExerciseSession }) {
  const label = shortDayLabel(session.date);

  return (
    <TableRow>
      <TableHead scope="row" {...stylex.props(styles.dayColumn)}>{label}</TableHead>
      <TableCell>{setsLabel(session)}</TableCell>
      <TableCell {...stylex.props(styles.number, session.topWeightKg === null && styles.muted)}>{session.topWeightKg === null ? "Bodyweight" : `${format(session.topWeightKg, 1)} kg`}</TableCell>
      <TableCell {...stylex.props(styles.number)}>{session.totalReps}</TableCell>
      <TableCell {...stylex.props(styles.number, session.volumeKg === null && styles.muted)} title={session.volumeKg === null ? "A set has no weight" : undefined}>
        {session.volumeKg === null ? "—" : `${format(session.volumeKg)} kg`}
      </TableCell>
      <TableCell {...stylex.props(styles.number)}>
        <Button asChild variant="ghost" size="icon-sm">
          <Link to="/overview" search={{ date: session.date }} aria-label={`Open ${label} in Overview`} title="Open in Overview">
            <ChartColumn size={15} />
          </Link>
        </Button>
      </TableCell>
    </TableRow>
  );
}
