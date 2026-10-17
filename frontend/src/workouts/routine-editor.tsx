import * as stylex from "@stylexjs/stylex";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ChevronLeft, Plus, X } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import type { Routine } from "../lib/api";
import { maxRoutineExercises, maxRoutineSets, type RoutineExercise } from "../../../src/routines/contract";
import { appendExercise, appendSet, changeById, changeSet } from "../lib/exercise-list";
import { useDeleteRoutine, useRoutines, useSaveRoutine } from "../lib/routines";
import { localDate } from "../lib/time";
import { parseRepTarget, repTargetText } from "../lib/workout-session";
import { Bone, Loading } from "../loading";
import { styles as pageStyles } from "../meals/meals-styles";
import { styles as formStyles } from "../form-styles";
import { queryFallback } from "../query-status";
import { ExerciseHeading } from "./exercise-heading";
import { PickExercise, type PickTarget } from "./pick-exercise";
import { styles } from "./workouts-styles";

type DraftSet = { id: string; reps: string };

type DraftExercise = { id: string; name: string; sets: DraftSet[] };

const draftSet = (reps: string): DraftSet => ({ id: crypto.randomUUID(), reps });

function draftExercises(routine: Routine | null): DraftExercise[] {
  return (routine?.exercises ?? []).map((exercise) => ({
    id: crypto.randomUUID(),
    name: exercise.name,
    sets: exercise.sets.map((set) => draftSet(repTargetText(set.reps))),
  }));
}

// The routine's exercises; null while a rep target does not parse.
function plannedExercises(exercises: DraftExercise[]): RoutineExercise[] | null {
  const planned: RoutineExercise[] = [];

  for (const exercise of exercises) {
    const sets = [];

    for (const set of exercise.sets) {
      const reps = parseRepTarget(set.reps);

      if (!reps) return null;
      sets.push({ reps });
    }

    planned.push({ name: exercise.name, sets });
  }

  return planned;
}

export function NewRoutinePage() {
  return <RoutineEditor routine={null} />;
}

export function EditRoutinePage() {
  const { routineId } = useParams({ strict: false });
  const query = useRoutines();
  const routine = query.data?.find((candidate) => candidate.id === routineId);

  if (!query.data) return queryFallback(query, <EditorSkeleton />, styles.hint);

  if (!routine) {
    return (
      <>
        <BackLink />
        <p {...stylex.props(styles.hint)}>This routine no longer exists.</p>
      </>
    );
  }

  // Keyed by revision, so a saved edit restarts from what the server kept.
  return <RoutineEditor key={`${routine.id}:${routine.revision}`} routine={routine} />;
}

function BackLink() {
  return (
    <Link to="/workouts" {...stylex.props(pageStyles.back)}>
      <ChevronLeft size={15} /> Workouts
    </Link>
  );
}

function RoutineEditor({ routine }: { routine: Routine | null }) {
  const navigate = useNavigate();
  const toList = () => void navigate({ to: "/workouts" });
  const save = useSaveRoutine(toList);
  const remove = useDeleteRoutine(toList);
  const [name, setName] = useState(routine?.name ?? "");
  const [exercises, setExercises] = useState(() => draftExercises(routine));
  const [picking, setPicking] = useState<PickTarget | null>(null);

  // The browser checks the name and each rep target before this runs.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const planned = plannedExercises(exercises);

    if (planned && planned.length > 0) save.mutate({ routine, input: { name: name.trim(), exercises: planned } });
  }

  return (
    <>
      <BackLink />
      <header {...stylex.props(pageStyles.header)}>
        <h1 {...stylex.props(pageStyles.headline)}>{routine ? routine.name : "New routine"}</h1>
      </header>
      <p {...stylex.props(pageStyles.intro)}>Choose the exercises, then the sets and the reps to aim for in each: a number like 8, or a range like 8-12.</p>
      <form {...stylex.props(styles.page)} onSubmit={submit}>
        <div>
          <Label {...stylex.props(formStyles.formLabel)} htmlFor="routine-name">Routine name</Label>
          <Input id="routine-name" {...stylex.props(pageStyles.nameInput)} maxLength={80} placeholder="e.g. Push day" value={name} onChange={(event) => setName(event.target.value)} required />
        </div>
        {exercises.map((exercise) => (
          <Card key={exercise.id} {...stylex.props(styles.exerciseCard)}>
            <ExerciseHeading name={exercise.name} onReplace={() => setPicking({ kind: "replace", exerciseId: exercise.id })} onRemove={() => setExercises((current) => changeById(current, exercise.id, () => null))} />
            <Table aria-label={`${exercise.name} sets`}>
              <TableHeader>
                <TableRow>
                  <TableHead {...stylex.props(styles.narrow)}>SET</TableHead>
                  <TableHead>REPS</TableHead>
                  <TableHead {...stylex.props(styles.narrow)} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {exercise.sets.map((set, index) => {
                  const invalid = parseRepTarget(set.reps) === null;

                  return (
                    <TableRow key={set.id}>
                      <TableCell {...stylex.props(styles.narrow, styles.setNumber)}>{index + 1}</TableCell>
                      <TableCell>
                        <Input
                          inputMode="numeric"
                          aria-label={`${exercise.name} set ${index + 1} reps`}
                          aria-invalid={invalid}
                          placeholder="8-12"
                          value={set.reps}
                          onChange={(event) => setExercises((current) => changeSet(current, exercise.id, set.id, (other) => ({ ...other, reps: event.target.value })))}
                          required
                          {...stylex.props(styles.numberInput)}
                        />
                      </TableCell>
                      <TableCell {...stylex.props(styles.narrow)}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove ${exercise.name} set ${index + 1}`}
                          disabled={exercise.sets.length === 1}
                          onClick={() => setExercises((current) => changeSet(current, exercise.id, set.id, () => null))}
                        >
                          <X size={14} />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={exercise.sets.length >= maxRoutineSets}
              onClick={() => setExercises((current) => appendSet(current, exercise.id, (last) => draftSet(last?.reps ?? "8-12")))}
            >
              <Plus size={14} /> Add set
            </Button>
          </Card>
        ))}
        {exercises.length === 0 && <p {...stylex.props(pageStyles.noFoods)}>No exercises yet.</p>}
        <Button type="button" variant="outline" disabled={exercises.length >= maxRoutineExercises} onClick={() => setPicking({ kind: "add" })}>
          <Plus size={16} /> Add exercise
        </Button>
        <div {...stylex.props(styles.actions)}>
          {routine && (
            <Button type="button" variant="ghost" {...stylex.props(styles.danger)} disabled={remove.isPending} onClick={() => remove.mutate(routine)}>
              Delete routine
            </Button>
          )}
          <span {...stylex.props(styles.spacer)} />
          <Button type="button" variant="outline" onClick={toList}>Cancel</Button>
          <Button type="submit" disabled={save.isPending || exercises.length === 0}>Save routine</Button>
        </div>
      </form>
      <PickExercise
        target={picking}
        onClose={() => setPicking(null)}
        date={localDate(new Date())}
        onAdd={(name) => setExercises((current) => appendExercise(current, { id: crypto.randomUUID(), name, sets: [draftSet("8-12"), draftSet("8-12"), draftSet("8-12")] }))}
        onReplace={(exerciseId, name) => setExercises((current) => changeById(current, exerciseId, (exercise) => ({ ...exercise, name })))}
      />
    </>
  );
}

function EditorSkeleton() {
  return (
    <Loading label="Loading the routine…">
      <BackLink />
      <header {...stylex.props(pageStyles.header)}><Bone width={220} height={36} /></header>
      <div {...stylex.props(styles.page)}>
        <Bone width="100%" height={40} />
        {[0, 1].map((index) => <Bone key={index} width="100%" height={180} />)}
      </div>
    </Loading>
  );
}
