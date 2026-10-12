import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defaultDuration, expandSets, parseRepTarget, parseReps, parseSet, parseWeight, previousLabel, previousSets, reduce, repTargetText, repsPlaceholder,
  sessionDate, sessionStats, setPlaceholder, startSession, toWorkoutInput, type Session, type SessionAction,
} from "../../frontend/src/lib/workout-session.js";
import type { Routine } from "../../src/routines/contract.js";
import { workoutInputSchema, type ExerciseHistory } from "../../src/workouts/contract.js";

function counter() {
  let next = 0;

  return () => `id-${++next}`;
}

const push: Routine = {
  id: "8b0c1f7e-2d6a-4c1b-9f43-5a2b7d1e0c11",
  revision: 3,
  name: "Push day",
  exercises: [
    { name: "Bench press", sets: [{ reps: { min: 5, max: 5 } }, { reps: { min: 8, max: 12 } }, { reps: { min: 8, max: 12 } }] },
    { name: "Dip", sets: [{ reps: { min: 10, max: 10 } }] },
  ],
};

const startedAt = "2026-10-05T17:30:00.000Z";

function started(): Session {
  return startSession(push, startedAt, "Europe/Lisbon", counter());
}

function apply(session: Session, ...actions: SessionAction[]): Session {
  return actions.reduce(reduce, session);
}

// Bench press is id-2 with sets id-3, id-4, id-5; Dip is id-6 with set id-7.
const bench = "id-2";

const edit = (setId: string, field: "weight" | "reps", text: string, exerciseId = bench): SessionAction => ({ type: "edit-set", exerciseId, setId, field, text });

const tick = (setId: string, fallback: { weightKg: number | null; reps: number } | null = null, exerciseId = bench): SessionAction => ({ type: "complete-set", exerciseId, setId, fallback });

function doneSetsParse(session: Session): boolean {
  return session.exercises.every((exercise) => exercise.sets.every((set) => !set.done || parseSet(set) !== null));
}

void test("a session copies its routine set by set, every set open and empty", () => {
  const session = started();

  assert.equal(session.title, "Push day");
  assert.deepEqual(session.routine, { id: push.id, name: "Push day" });
  assert.equal(session.finish, null);
  assert.deepEqual(session.exercises.map((exercise) => exercise.name), ["Bench press", "Dip"]);
  assert.deepEqual(session.exercises[0]?.sets.map((set) => set.target), [{ min: 5, max: 5 }, { min: 8, max: 12 }, { min: 8, max: 12 }]);
  assert.ok(session.exercises.every((exercise) => exercise.sets.every((set) => set.weight === "" && set.reps === "" && !set.done)), "every set starts empty and open");

  const empty = startSession(null, startedAt, "Europe/Lisbon", counter());

  assert.equal(empty.title, "Workout", "an empty workout has a plain title");
  assert.deepEqual(empty.exercises, []);
  assert.equal(empty.routine, null);
});

void test("ticking a set fills its empty fields from the fallback and keeps a done set parseable", () => {
  const session = started();
  const filled = apply(session, tick("id-3", { weightKg: 62.5, reps: 7 }));

  assert.deepEqual(filled.exercises[0]?.sets[0], { id: "id-3", target: { min: 5, max: 5 }, weight: "62.5", reps: "7", done: true }, "empty fields take the fallback");

  const typed = apply(session, edit("id-3", "weight", "60"), tick("id-3", { weightKg: 62.5, reps: 7 }));

  assert.deepEqual(typed.exercises[0]?.sets[0]?.weight, "60", "a typed field keeps its value");
  assert.equal(typed.exercises[0]?.sets[0]?.done, true);

  const bodyweight = apply(session, tick("id-3", { weightKg: null, reps: 12 }));

  assert.deepEqual(bodyweight.exercises[0]?.sets[0]?.weight, "", "an empty weight stays bodyweight");

  assert.equal(reduce(session, tick("id-3")), session, "a set with no reps and no fallback stays open");
  assert.equal(apply(session, edit("id-3", "reps", "abc")).exercises[0]?.sets[0]?.done, false);

  const invalid = apply(session, edit("id-3", "reps", "abc"));

  assert.equal(reduce(invalid, tick("id-3", { weightKg: 60, reps: 8 })), invalid, "typed reps that do not parse are not overwritten, so the set stays open");

  const done = apply(session, tick("id-3", { weightKg: 60, reps: 8 }));

  assert.equal(apply(done, edit("id-3", "reps", "9")).exercises[0]?.sets[0]?.done, true, "a done set edited to valid text stays done");
  assert.equal(apply(done, edit("id-3", "reps", "")).exercises[0]?.sets[0]?.done, false, "a done set edited to text that does not parse reopens");
  assert.equal(apply(done, edit("id-3", "weight", "-5")).exercises[0]?.sets[0]?.done, false, "a negative weight reopens the set");
  assert.equal(apply(done, { type: "reopen-set", exerciseId: bench, setId: "id-3" }).exercises[0]?.sets[0]?.done, false);
  assert.equal(reduce(done, tick("id-3", { weightKg: 1, reps: 1 })), done, "ticking a done set changes nothing");
});

void test("sets and exercises are added, removed, and replaced within the routine limits", () => {
  const session = started();
  const added = apply(session, { type: "add-set", exerciseId: bench, setId: "new-set" });

  assert.deepEqual(added.exercises[0]?.sets.at(-1), { id: "new-set", target: { min: 8, max: 12 }, weight: "", reps: "", done: false }, "a new set copies the last set's target");

  let full = session;

  for (let index = 0; index < 30; index += 1) full = reduce(full, { type: "add-set", exerciseId: bench, setId: `set-${index}` });

  assert.equal(full.exercises[0]?.sets.length, 20, "an exercise stops at 20 sets");

  const removed = apply(session, { type: "remove-set", exerciseId: bench, setId: "id-4" });

  assert.deepEqual(removed.exercises[0]?.sets.map((set) => set.id), ["id-3", "id-5"]);

  const withRow = apply(session, { type: "add-exercise", exerciseId: "row", setId: "row-1", name: "Cable row" });

  assert.deepEqual(withRow.exercises.at(-1), { id: "row", name: "Cable row", sets: [{ id: "row-1", target: null, weight: "", reps: "", done: false }] }, "a new exercise has one open set with no target");

  let crowded = session;

  for (let index = 0; index < 30; index += 1) crowded = reduce(crowded, { type: "add-exercise", exerciseId: `e-${index}`, setId: `s-${index}`, name: "Curl" });

  assert.equal(crowded.exercises.length, 20, "a session stops at 20 exercises");

  const replaced = apply(session, tick("id-3", { weightKg: 60, reps: 5 }), { type: "replace-exercise", exerciseId: bench, name: "Dumbbell press" });

  assert.equal(replaced.exercises[0]?.name, "Dumbbell press");
  assert.deepEqual(replaced.exercises[0]?.sets.map((set) => [set.target, set.reps, set.done]), [[{ min: 5, max: 5 }, "", false], [{ min: 8, max: 12 }, "", false], [{ min: 8, max: 12 }, "", false]], "a replaced exercise keeps the plan and drops what was done");

  assert.deepEqual(apply(session, { type: "remove-exercise", exerciseId: bench }).exercises.map((exercise) => exercise.name), ["Dip"]);
  assert.equal(reduce(session, { type: "remove-exercise", exerciseId: "nope" }), session, "an unknown exercise changes nothing");
  assert.equal(reduce(session, edit("nope", "reps", "5")), session, "an unknown set changes nothing");
});

void test("a frozen session ignores every edit until it thaws, and keeps its first key", () => {
  const done = apply(started(), tick("id-3", { weightKg: 60, reps: 5 }));
  const finish = { key: "key-1", input: toWorkoutInput(done, 45) };
  const frozen = reduce(done, { type: "freeze", finish });

  assert.deepEqual(frozen.finish, finish);

  const edits: SessionAction[] = [
    edit("id-3", "reps", "6"),
    tick("id-4", { weightKg: 60, reps: 8 }),
    { type: "reopen-set", exerciseId: bench, setId: "id-3" },
    { type: "copy-previous", exerciseId: bench, setId: "id-4", values: { weightKg: 1, reps: 1 } },
    { type: "add-set", exerciseId: bench, setId: "x" },
    { type: "remove-set", exerciseId: bench, setId: "id-3" },
    { type: "add-exercise", exerciseId: "y", setId: "z", name: "Curl" },
    { type: "replace-exercise", exerciseId: bench, name: "Curl" },
    { type: "remove-exercise", exerciseId: bench },
    { type: "freeze", finish: { key: "key-2", input: finish.input } },
  ];

  for (const action of edits) assert.equal(reduce(frozen, action), frozen, `${action.type} is ignored while frozen`);

  const thawed = reduce(frozen, { type: "thaw" });

  assert.equal(thawed.finish, null);
  assert.equal(apply(thawed, edit("id-3", "reps", "6")).exercises[0]?.sets[0]?.reps, "6", "a thawed session takes edits again");
});

void test("any sequence of actions keeps every done set parseable", () => {
  let seed = 7;

  const random = (count: number) => {
    seed = (seed * 48_271) % 2_147_483_647;

    return seed % count;
  };

  const texts = ["", "8", "62.5", "62,5", "abc", "-1", "0", "1001", " 12 ", "7.5"];
  let session = started();
  let doneSeen = 0;

  for (let step = 0; step < 2000; step += 1) {
    const exercise = session.exercises[random(Math.max(1, session.exercises.length))];
    const set = exercise?.sets[random(Math.max(1, exercise.sets.length))];
    const exerciseId = exercise?.id ?? "none";
    const setId = set?.id ?? "none";
    const text = texts[random(texts.length)] ?? "";

    const actions: SessionAction[] = [
      { type: "edit-set", exerciseId, setId, field: random(2) === 0 ? "weight" : "reps", text },
      { type: "complete-set", exerciseId, setId, fallback: random(2) === 0 ? null : { weightKg: random(3) === 0 ? null : 50, reps: 1 + random(12) } },
      { type: "reopen-set", exerciseId, setId },
      { type: "add-set", exerciseId, setId: `s${step}` },
      { type: "remove-set", exerciseId, setId },
      { type: "add-exercise", exerciseId: `e${step}`, setId: `s${step}`, name: "Curl" },
    ];

    session = reduce(session, actions[random(actions.length)] ?? actions[0]!);
    assert.ok(doneSetsParse(session), `every done set parses after step ${step}`);
    doneSeen += session.exercises.some((candidate) => candidate.sets.some((each) => each.done)) ? 1 : 0;
  }

  assert.ok(doneSeen > 500, "the sequence spends most of its time with done sets");
});

void test("done sets become workout rows with equal neighbours merged, and expand back exactly", () => {
  const session = apply(
    started(),
    tick("id-3", { weightKg: 62, reps: 7 }),
    tick("id-4", { weightKg: 62, reps: 7 }),
    edit("id-5", "weight", "60"),
    tick("id-5", { weightKg: 62, reps: 8 }),
    { type: "add-exercise", exerciseId: "pull", setId: "pull-1", name: "Pull-up" },
    tick("pull-1", { weightKg: null, reps: 10 }, "pull"),
  );

  const input = toWorkoutInput(session, 52);

  assert.deepEqual(input, {
    occurredAt: startedAt,
    timeZone: "Europe/Lisbon",
    activity: "strength",
    durationMinutes: 52,
    distanceM: null,
    energyKcal: null,
    strengthExercises: [
      { name: "Bench press", sets: 2, reps: 7, weightKg: 62 },
      { name: "Bench press", sets: 1, reps: 8, weightKg: 60 },
      { name: "Pull-up", sets: 1, reps: 10, weightKg: null },
    ],
  }, "undone sets and exercises with none done are left out");
  assert.deepEqual(workoutInputSchema.parse(input), input, "the server's schema accepts the input");

  const benchRows = input.strengthExercises?.filter((row) => row.name === "Bench press") ?? [];

  assert.deepEqual(expandSets(benchRows), [{ weightKg: 62, reps: 7 }, { weightKg: 62, reps: 7 }, { weightKg: 60, reps: 8 }], "expanding the rows gives the done sets in order");

  const alternating = apply(started(), tick("id-3", { weightKg: 60, reps: 5 }), tick("id-4", { weightKg: 65, reps: 5 }), tick("id-5", { weightKg: 60, reps: 5 }));

  assert.equal(toWorkoutInput(alternating, 30).strengthExercises?.length, 3, "only neighbouring equal sets merge");
  assert.equal(toWorkoutInput(started(), 30).strengthExercises, null, "a session with nothing done logs no exercises");
});

void test("stats count the done sets and their volume, and the duration comes from the start", () => {
  assert.equal(sessionStats(started(), Date.parse(startedAt)).doneSets, 0);

  const session = apply(started(), tick("id-3", { weightKg: 60, reps: 5 }), tick("id-7", { weightKg: null, reps: 10 }, "id-6"));
  const now = Date.parse(startedAt) + 32 * 60_000 + 10_000;

  assert.deepEqual(sessionStats(session, now), { elapsedSeconds: 32 * 60 + 10, volumeKg: 300, doneSets: 2 }, "bodyweight sets add no volume");
  assert.equal(sessionStats(session, Date.parse(startedAt) - 5000).elapsedSeconds, 0, "a clock behind the start shows zero");
  assert.equal(defaultDuration(session, now), 32);
  assert.equal(defaultDuration(session, Date.parse(startedAt)), 1, "a duration is at least a minute");
  assert.equal(defaultDuration(session, Date.parse(startedAt) + 3 * 86_400_000), 1440, "a duration is at most a day");
  assert.equal(sessionDate(startSession(null, "2026-10-05T23:30:00Z", "Europe/Lisbon", counter())), "2026-10-06", "the date is the day the session began in its zone");
});

void test("previous sets come from the latest session on or before the date, old rows expanded", () => {
  const sessions = [
    { workoutId: "7e0b1c2d-3a4f-4b5c-8d6e-1f2a3b4c5d01", date: "2026-09-28", occurredAt: "2026-09-28T17:00:00.000Z", sets: [{ sets: 3, reps: 8, weightKg: 60 }], topWeightKg: 60, totalReps: 24, volumeKg: 1440 },
    { workoutId: "7e0b1c2d-3a4f-4b5c-8d6e-1f2a3b4c5d02", date: "2026-10-02", occurredAt: "2026-10-02T17:00:00.000Z", sets: [{ sets: 2, reps: 7, weightKg: 62 }, { sets: 1, reps: 8, weightKg: 60 }], topWeightKg: 62, totalReps: 22, volumeKg: 1348 },
  ];

  const history: ExerciseHistory[] = [{ key: "bench press", name: "Bench Press", sessions }];

  assert.deepEqual(previousSets(history, "  BENCH   press ", "2026-10-05"), [{ weightKg: 62, reps: 7 }, { weightKg: 62, reps: 7 }, { weightKg: 60, reps: 8 }], "the latest session matches by key");
  assert.deepEqual(previousSets(history, "Bench press", "2026-09-30"), [{ weightKg: 60, reps: 8 }, { weightKg: 60, reps: 8 }, { weightKg: 60, reps: 8 }], "a \"3 × 8\" row from the form is three sets");
  assert.deepEqual(previousSets(history, "Bench press", "2026-09-01"), [], "nothing before the first session");
  assert.deepEqual(previousSets(history, "Dip", "2026-10-05"), [], "an exercise never done has no previous sets");
});

void test("placeholders show the routine's target or the last values, and ticking fills the same", () => {
  const previous = { weightKg: 62, reps: 7 };

  assert.deepEqual(setPlaceholder(previous, { min: 8, max: 12 }), { weightKg: 62, reps: 8 }, "a range fills its low end");
  assert.deepEqual(setPlaceholder(previous, null), previous, "without a target the last set is repeated");
  assert.deepEqual(setPlaceholder(null, { min: 5, max: 5 }), { weightKg: null, reps: 5 }, "without a previous set the weight stays empty");
  assert.equal(setPlaceholder(null, null), null, "nothing to fill without a previous set or a target");

  assert.equal(repsPlaceholder(previous, { min: 8, max: 12 }), "8–12");
  assert.equal(repsPlaceholder(previous, null), "7");
  assert.equal(repsPlaceholder(null, null), "");
  assert.equal(previousLabel(previous), "62kg × 7");
  assert.equal(previousLabel({ weightKg: 62.5, reps: 7 }), "62.5kg × 7");
  assert.equal(previousLabel({ weightKg: null, reps: 12 }), "× 12", "bodyweight shows reps only");
});

void test("rep targets read as one number or a range", () => {
  assert.deepEqual(parseRepTarget("8"), { min: 8, max: 8 });
  assert.deepEqual(parseRepTarget("8-12"), { min: 8, max: 12 });
  assert.deepEqual(parseRepTarget(" 8 – 12 "), { min: 8, max: 12 }, "an en dash and spaces are accepted");
  assert.deepEqual(parseRepTarget("10-10"), { min: 10, max: 10 });

  for (const text of ["", "0", "12-8", "8-", "-8", "abc", "8.5", "1001", "8-12-15", "8 12"]) assert.equal(parseRepTarget(text), null, `"${text}" is not a rep target`);

  assert.equal(repTargetText({ min: 8, max: 12 }), "8–12");
  assert.equal(repTargetText({ min: 5, max: 5 }), "5");
});

void test("set values parse from typed text", () => {
  assert.deepEqual(parseSet({ weight: "62,5", reps: "7" }), { weightKg: 62.5, reps: 7 }, "a decimal comma is a decimal point");
  assert.deepEqual(parseSet({ weight: " ", reps: "12" }), { weightKg: null, reps: 12 });
  assert.deepEqual(parseSet({ weight: "0", reps: "1" }), { weightKg: 0, reps: 1 });

  for (const [weight, reps] of [["60", ""], ["60", "0"], ["60", "7.5"], ["60", "1001"], ["-1", "5"], ["1000.5", "5"], ["abc", "5"], ["Infinity", "5"]] as const) {
    assert.equal(parseSet({ weight, reps }), null, `${weight} kg × ${reps} does not parse`);
  }

  assert.equal(parseWeight(""), null, "an empty weight is bodyweight");
  assert.equal(parseWeight("abc"), undefined, "text that is not a weight is invalid");
  assert.equal(parseReps("8"), 8);
  assert.equal(parseReps("0"), null);
});
