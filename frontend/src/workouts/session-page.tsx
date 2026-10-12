import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Plus, X } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Checkbox } from "../components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { format } from "../lib/api";
import { exerciseHistoryQueryOptions } from "../lib/exercise-history";
import { useNow, useWorkoutSession, type WorkoutSessionHandle } from "../lib/use-workout-session";
import {
  defaultDuration, parseReps, parseWeight, previousLabel, previousSets, repsPlaceholder, sessionDate, sessionStats, setPlaceholder, weightText,
  type Session, type SessionExercise, type SetValues,
} from "../lib/workout-session";
import { maxRoutineExercises, maxRoutineSets } from "../../../src/routines/contract";
import { styles as pageStyles } from "../meals/meals-styles";
import { styles as formStyles } from "../form-styles";
import { ExerciseHeading } from "./exercise-heading";
import { PickExercise, type PickTarget } from "./pick-exercise";
import { clockLabel } from "./resume-bar";
import { styles } from "./workouts-styles";

// The workout in progress: one table of sets per exercise, ticked off as they are done.
export function SessionPage() {
  const workout = useWorkoutSession();

  if (workout.unreadable) {
    return (
      <>
        <h1 {...stylex.props(pageStyles.headline)}>Workout</h1>
        <p {...stylex.props(pageStyles.intro)}>A workout in progress on this device could not be restored.</p>
        <div {...stylex.props(styles.actions)}>
          <Button variant="ghost" {...stylex.props(styles.danger)} onClick={workout.discard}>Discard it</Button>
        </div>
      </>
    );
  }

  if (!workout.session) {
    return (
      <>
        <h1 {...stylex.props(pageStyles.headline)}>Workout</h1>
        <p {...stylex.props(pageStyles.intro)}>No workout is in progress. Start one from a routine, or an empty one.</p>
        <Button asChild>
          <Link to="/workouts">Workouts</Link>
        </Button>
      </>
    );
  }

  return <LiveLog session={workout.session} workout={workout} />;
}

function LiveLog({ session, workout }: { session: Session; workout: WorkoutSessionHandle }) {
  const history = useQuery(exerciseHistoryQueryOptions());
  const now = useNow(1000);
  const stats = sessionStats(session, now);
  const date = sessionDate(session);
  const [picking, setPicking] = useState<PickTarget | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const frozen = session.finish !== null;

  return (
    <div {...stylex.props(styles.page)}>
      <header {...stylex.props(pageStyles.header)}>
        <h1 {...stylex.props(pageStyles.headline)}>{session.title}</h1>
        <Button onClick={() => setFinishing(true)}>Finish</Button>
      </header>
      <div {...stylex.props(styles.stats)} aria-label="Workout so far">
        <Stat label="Time" value={clockLabel(stats.elapsedSeconds)} clock />
        <Stat label="Volume" value={`${format(stats.volumeKg)} kg`} />
        <Stat label="Sets" value={String(stats.doneSets)} />
      </div>
      {session.exercises.map((exercise) => (
        <ExerciseLog
          key={exercise.id}
          exercise={exercise}
          previous={history.data ? previousSets(history.data.exercises, exercise.name, date) : []}
          frozen={frozen}
          workout={workout}
          onReplace={() => setPicking({ kind: "replace", exerciseId: exercise.id })}
        />
      ))}
      {session.exercises.length === 0 && <p {...stylex.props(pageStyles.noFoods)}>Add the exercises you are doing.</p>}
      <Button variant="outline" disabled={frozen || session.exercises.length >= maxRoutineExercises} onClick={() => setPicking({ kind: "add" })}>
        <Plus size={16} /> Add exercise
      </Button>
      <div {...stylex.props(styles.actions)}>
        <Button variant="ghost" {...stylex.props(styles.danger)} disabled={workout.finish.isPending} onClick={() => (stats.doneSets > 0 ? setDiscarding(true) : workout.discard())}>
          Discard workout
        </Button>
      </div>
      <PickExercise
        target={picking}
        onClose={() => setPicking(null)}
        date={date}
        onAdd={(name) => workout.dispatch({ type: "add-exercise", name })}
        onReplace={(exerciseId, name) => workout.dispatch({ type: "replace-exercise", exerciseId, name })}
      />
      <FinishDialog open={finishing} onOpenChange={setFinishing} session={session} doneSets={stats.doneSets} workout={workout} />
      <Dialog open={discarding} onOpenChange={setDiscarding}>
        <DialogContent>
          <DialogTitle {...stylex.props(formStyles.dialogTitle)}>Discard this workout?</DialogTitle>
          <DialogDescription {...stylex.props(formStyles.dialogDescription)}>
            The {stats.doneSets} {stats.doneSets === 1 ? "set" : "sets"} you ticked will not be logged.
          </DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiscarding(false)}>Keep going</Button>
            <Button variant="destructive" onClick={workout.discard}>Discard workout</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, clock = false }: { label: string; value: string; clock?: boolean }) {
  return (
    <span {...stylex.props(styles.stat)}>
      <span {...stylex.props(styles.statLabel)}>{label}</span>
      <strong {...stylex.props(styles.statValue, clock && styles.statClock)}>{value}</strong>
    </span>
  );
}

type ExerciseLogProps = { exercise: SessionExercise; previous: SetValues[]; frozen: boolean; workout: WorkoutSessionHandle; onReplace: () => void };

function ExerciseLog({ exercise, previous, frozen, workout, onReplace }: ExerciseLogProps) {
  const { dispatch } = workout;
  const exerciseId = exercise.id;

  return (
    <Card {...stylex.props(styles.exerciseCard)}>
      <ExerciseHeading name={exercise.name} onReplace={onReplace} onRemove={() => dispatch({ type: "remove-exercise", exerciseId })} />
      <Table aria-label={`${exercise.name} sets`} {...stylex.props(styles.table)}>
        <TableHeader>
          <TableRow>
            <TableHead {...stylex.props(styles.narrow)}>SET</TableHead>
            <TableHead {...stylex.props(styles.previousCell)}>PREVIOUS</TableHead>
            <TableHead {...stylex.props(styles.inputCell)}>KG</TableHead>
            <TableHead {...stylex.props(styles.inputCell)}>REPS</TableHead>
            <TableHead {...stylex.props(styles.narrow)}>✓</TableHead>
            <TableHead {...stylex.props(styles.narrow)} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {exercise.sets.map((set, index) => {
            const last = previous[index] ?? null;
            const fallback = setPlaceholder(last, set.target);
            const number = index + 1;
            const setId = set.id;

            return (
              <TableRow key={setId} data-done={set.done || undefined} {...stylex.props(set.done && styles.doneRow)}>
                <TableCell {...stylex.props(styles.narrow, styles.setNumber)}>{number}</TableCell>
                <TableCell {...stylex.props(styles.previousCell)}>
                  {last ? (
                    <Button variant="ghost" size="xs" disabled={frozen} title="Use these" aria-label={`Set ${number} last time ${previousLabel(last)}, use it`} onClick={() => dispatch({ type: "copy-previous", exerciseId, setId, values: last })} {...stylex.props(styles.previous)}>
                      {previousLabel(last)}
                    </Button>
                  ) : <span {...stylex.props(styles.hint)}>—</span>}
                </TableCell>
                <TableCell {...stylex.props(styles.inputCell)}>
                  <Input
                    inputMode="decimal"
                    aria-label={`${exercise.name} set ${number} weight in kg`}
                    placeholder={last?.weightKg != null ? weightText(last.weightKg) : ""}
                    value={set.weight}
                    disabled={frozen}
                    aria-invalid={parseWeight(set.weight) === undefined}
                    onChange={(event) => dispatch({ type: "edit-set", exerciseId, setId, field: "weight", text: event.target.value })}
                    {...stylex.props(styles.numberInput)}
                  />
                </TableCell>
                <TableCell {...stylex.props(styles.inputCell)}>
                  <Input
                    id={`reps-${setId}`}
                    inputMode="numeric"
                    aria-label={`${exercise.name} set ${number} reps`}
                    placeholder={repsPlaceholder(last, set.target)}
                    value={set.reps}
                    disabled={frozen}
                    aria-invalid={set.reps !== "" && parseReps(set.reps) === null}
                    onChange={(event) => dispatch({ type: "edit-set", exerciseId, setId, field: "reps", text: event.target.value })}
                    {...stylex.props(styles.numberInput)}
                  />
                </TableCell>
                <TableCell {...stylex.props(styles.narrow)}>
                  <Checkbox
                    checked={set.done}
                    disabled={frozen}
                    aria-label={`${exercise.name} set ${number} done`}
                    onCheckedChange={(checked) => {
                      if (checked !== true) return dispatch({ type: "reopen-set", exerciseId, setId });

                      // Nothing to fill the reps from: ask for them instead of ticking.
                      if (set.reps.trim() === "" && !fallback) document.getElementById(`reps-${setId}`)?.focus();
                      dispatch({ type: "complete-set", exerciseId, setId, fallback });
                    }}
                  />
                </TableCell>
                <TableCell {...stylex.props(styles.narrow)}>
                  <Button variant="ghost" size="icon-xs" disabled={frozen} aria-label={`Remove ${exercise.name} set ${number}`} onClick={() => dispatch({ type: "remove-set", exerciseId, setId })}>
                    <X size={13} />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <Button variant="secondary" size="sm" disabled={frozen || exercise.sets.length >= maxRoutineSets} onClick={() => dispatch({ type: "add-set", exerciseId })}>
        <Plus size={14} /> Add set
      </Button>
    </Card>
  );
}

type FinishDialogProps = { open: boolean; onOpenChange: (open: boolean) => void; session: Session; doneSets: number; workout: WorkoutSessionHandle };

// Saving logs the done sets as one strength workout. Once sent, the request is kept until the server answers, so
// the only ways on are Retry, which cannot log it twice, and Discard.
function FinishDialog({ open, onOpenChange, session, doneSets, workout }: FinishDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle {...stylex.props(formStyles.dialogTitle)}>Finish {session.title}</DialogTitle>
        {open && <FinishBody onClose={() => onOpenChange(false)} session={session} doneSets={doneSets} workout={workout} />}
      </DialogContent>
    </Dialog>
  );
}

// Mounts with the dialog, so the duration starts from the clock each time it opens.
function FinishBody({ onClose, session, doneSets, workout }: { onClose: () => void; session: Session; doneSets: number; workout: WorkoutSessionHandle }) {
  const navigate = useNavigate();
  const [minutes, setMinutes] = useState(() => String(defaultDuration(session, Date.now())));
  const { finish } = workout;

  async function saved(date: Promise<string | null>) {
    const logged = await date;

    if (logged) void navigate({ to: "/overview", search: { date: logged } });
  }

  if (doneSets === 0) {
    return (
      <>
        <DialogDescription {...stylex.props(formStyles.dialogDescription)}>No sets are ticked yet, so there is nothing to log.</DialogDescription>
        <DialogFooter>
          <Button variant="ghost" {...stylex.props(styles.danger)} onClick={workout.discard}>Discard workout</Button>
          <Button variant="outline" onClick={onClose}>Keep going</Button>
        </DialogFooter>
      </>
    );
  }

  if (session.finish) {
    return (
      <>
        <DialogDescription {...stylex.props(formStyles.dialogDescription)}>
          {finish.isPending ? "Saving your workout…" : "Your workout may not have been saved. Retry sends it again, and it is never logged twice."}
        </DialogDescription>
        <DialogFooter>
          <Button variant="ghost" {...stylex.props(styles.danger)} disabled={finish.isPending} onClick={workout.discard}>Discard workout</Button>
          <Button disabled={finish.isPending} onClick={() => void saved(finish.retry())}>{finish.isPending ? "Saving…" : "Retry"}</Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <form
      {...stylex.props(formStyles.formStack, styles.finishForm)}
      onSubmit={(event) => {
        event.preventDefault();
        void saved(finish.save(Number(minutes)));
      }}
    >
      <div {...stylex.props(styles.durationField)}>
        <Label htmlFor="finish-duration" {...stylex.props(formStyles.formLabel)}>Duration (min)</Label>
        <Input id="finish-duration" type="number" inputMode="numeric" min={1} max={1440} step={1} value={minutes} onChange={(event) => setMinutes(event.target.value)} required />
      </div>
      <div {...stylex.props(formStyles.dialogActions)}>
        <Button type="submit">Save workout</Button>
      </div>
    </form>
  );
}
