import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Dumbbell, Play, Plus } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "../components/ui/dialog";
import type { Routine } from "../lib/api";
import { combinedMuscles } from "../lib/body-map";
import { exerciseLibraryQueryOptions } from "../lib/exercise-library";
import { useRoutines } from "../lib/routines";
import { useWorkoutSession } from "../lib/use-workout-session";
import { Bone, Loading } from "../loading";
import { styles as pageStyles } from "../meals/meals-styles";
import { styles as formStyles } from "../form-styles";
import { MuscleMap } from "../muscle-map";
import { queryFallback } from "../query-status";
import { ResumeBar } from "./resume-bar";
import { styles } from "./workouts-styles";

// The routines you train from. Starting one opens the live log; one workout is in progress at a time.
export function RoutinesPage() {
  const query = useRoutines();
  const workout = useWorkoutSession();
  const navigate = useNavigate();
  // The routine to start once the workout in progress is resumed or discarded; null is an empty workout.
  const [blocked, setBlocked] = useState<{ routine: Routine | null } | null>(null);
  const routines = query.data;

  function start(routine: Routine | null) {
    if (workout.start(routine).outcome === "in-progress") return setBlocked({ routine });
    void navigate({ to: "/workouts/session" });
  }

  return (
    <>
      <header {...stylex.props(pageStyles.header)}>
        <h1 {...stylex.props(pageStyles.headline)}>Workouts</h1>
        <div {...stylex.props(styles.actions)}>
          <Button variant="outline" onClick={() => start(null)}><Play size={16} /> Start empty workout</Button>
          {routines && routines.length > 0 && (
            <Button asChild>
              <Link to="/workouts/routines/new"><Plus size={16} /> New routine</Link>
            </Button>
          )}
        </div>
      </header>
      <p {...stylex.props(pageStyles.intro)}>
        Plan the exercises, sets, and reps of a routine once. Start it at the gym to log each set's weight and reps, and Progress follows every exercise.
      </p>
      {workout.session && <ResumeBar session={workout.session} shell />}
      {!routines || query.isError ? (
        queryFallback(query, <RoutinesSkeleton />, styles.hint)
      ) : routines.length === 0 ? (
        <div {...stylex.props(pageStyles.empty)}>
          <Dumbbell size={28} />
          <p {...stylex.props(pageStyles.emptyTitle)}>No routines yet</p>
          <p {...stylex.props(styles.hint)}>A routine is a workout you repeat, like a push day: its exercises, how many sets, and the reps to aim for.</p>
          <Button asChild>
            <Link to="/workouts/routines/new"><Plus size={16} /> Create a routine</Link>
          </Button>
        </div>
      ) : (
        <ul {...stylex.props(pageStyles.grid)} aria-label="Routines">
          {routines.map((routine) => <li key={routine.id}><RoutineCard routine={routine} onStart={() => start(routine)} /></li>)}
        </ul>
      )}
      <Dialog open={blocked !== null} onOpenChange={(open) => { if (!open) setBlocked(null); }}>
        <DialogContent>
          <DialogTitle {...stylex.props(formStyles.dialogTitle)}>A workout is in progress</DialogTitle>
          <DialogDescription {...stylex.props(formStyles.dialogDescription)}>
            {workout.session?.title} is still open. Resume it, or discard it and start {blocked?.routine?.name ?? "an empty workout"}. Discarding loses its sets.
          </DialogDescription>
          <DialogFooter>
            <Button
              variant="ghost"
              {...stylex.props(styles.danger)}
              disabled={workout.finish.isPending}
              onClick={() => {
                const next = blocked?.routine ?? null;

                workout.discard();
                setBlocked(null);
                start(next);
              }}
            >
              Discard and start
            </Button>
            <Button asChild>
              <Link to="/workouts/session">Resume</Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RoutineCard({ routine, onStart }: { routine: Routine; onStart: () => void }) {
  const library = useQuery(exerciseLibraryQueryOptions());
  const muscles = combinedMuscles(routine.exercises.map((exercise) => exercise.name), library.data);
  const sets = routine.exercises.reduce((count, exercise) => count + exercise.sets.length, 0);

  return (
    <Card {...stylex.props(pageStyles.card)}>
      <div {...stylex.props(pageStyles.cardBody)}>
        <div {...stylex.props(styles.routineTop)}>
          <div {...stylex.props(styles.routineText)}>
            <Link to="/workouts/routines/$routineId" params={{ routineId: routine.id }} {...stylex.props(styles.routineName)}>{routine.name}</Link>
            <p {...stylex.props(styles.hint)}>{routine.exercises.length} {routine.exercises.length === 1 ? "exercise" : "exercises"} · {sets} {sets === 1 ? "set" : "sets"}</p>
            <p {...stylex.props(styles.routineExercises)}>{routine.exercises.map((exercise) => exercise.name).join(" · ")}</p>
          </div>
          {muscles && <span {...stylex.props(styles.routineMuscles)}><MuscleMap muscles={muscles} /></span>}
        </div>
      </div>
      <div {...stylex.props(pageStyles.cardFooter)}>
        <Button size="sm" onClick={onStart} aria-label={`Start ${routine.name}`}><Play size={14} /> Start</Button>
        <Button asChild variant="ghost" size="sm">
          <Link to="/workouts/routines/$routineId" params={{ routineId: routine.id }} aria-label={`Edit ${routine.name}`}>Edit</Link>
        </Button>
      </div>
    </Card>
  );
}

function RoutinesSkeleton() {
  return (
    <Loading label="Loading your routines…">
      <div {...stylex.props(pageStyles.grid)}>
        {[0, 1, 2].map((index) => (
          <Card key={index} {...stylex.props(pageStyles.card)}>
            <div {...stylex.props(pageStyles.cardBody)}>
              <Bone width="45%" height={16} />
              <Bone width="30%" height={11} />
              <Bone width="80%" height={11} />
            </div>
            <div {...stylex.props(pageStyles.cardFooter)}>
              <Bone width={70} height={28} />
              <Bone width={40} height={22} />
            </div>
          </Card>
        ))}
      </div>
    </Loading>
  );
}
