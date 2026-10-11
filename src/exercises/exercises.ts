import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { customExercises } from "../db/schema.js";
import type { AppDatabase } from "../db/database.js";
import { softDelete } from "../journal/records.js";
import { withReceipt } from "../journal/receipt.js";
import { exerciseKey } from "../workouts/contract.js";
import { customExerciseSchema, equipment, muscles } from "./contract.js";
import type { CustomExercise, CustomExerciseInput, ExerciseLibrary, LibraryExercise } from "./contract.js";

const snapshot = z.object({
  commit: z.string(),
  exercises: z.array(z.object({ id: z.string(), name: z.string(), muscle: z.enum(muscles), equipment: z.enum(equipment).nullable(), images: z.array(z.string()) })),
});

const data = snapshot.parse(JSON.parse(readFileSync(new URL("../../data/free-exercise-db.json", import.meta.url), "utf8")));

// Served by jsDelivr from the same pinned commit as the snapshot, since the photos run to about 100 MB.
const imageBase = `https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@${data.commit}/exercises/`;

const catalog: LibraryExercise[] = data.exercises.map(({ name, muscle, equipment, images }) => ({
  origin: "catalog", key: exerciseKey(name), name, muscle, equipment, images: images.map((image) => imageBase + image),
}));

const catalogKeys = new Set(catalog.map((exercise) => exercise.key));

const attribution = { label: "Free Exercise DB, released into the public domain", url: `https://github.com/yuhonas/free-exercise-db/tree/${data.commit}` };

const byName = new Intl.Collator("en", { sensitivity: "base", numeric: true });

function custom(row: typeof customExercises.$inferSelect): CustomExercise {
  return { origin: "custom", id: row.id, revision: row.revision, key: row.key, name: row.name, muscle: row.muscle, equipment: row.equipment };
}

// Every exercise the person can pick: the catalog, their own exercises, and names from their workouts that are in neither.
export async function getExerciseLibrary(db: AppDatabase, userId: string): Promise<ExerciseLibrary> {
  const [rows, logged] = await Promise.all([
    db.select().from(customExercises).where(and(eq(customExercises.userId, userId), isNull(customExercises.deletedAt))),
    // Newest first, so the first spelling seen of each key is the latest one, as in the history.
    db.execute<{ name: string }>(sql`
      SELECT exercise->>'name' AS name FROM workouts, jsonb_array_elements(strength_exercises) AS exercise
      WHERE user_id = ${userId} AND deleted_at IS NULL AND strength_exercises IS NOT NULL
      ORDER BY local_date DESC, occurred_at DESC, id DESC`),
  ]);

  const library = new Map(catalog.map((exercise) => [exercise.key, exercise]));

  for (const row of rows) if (!library.has(row.key)) library.set(row.key, custom(row));

  for (const { name } of logged) {
    const key = exerciseKey(name);

    if (!library.has(key)) library.set(key, { origin: "logged", key, name });
  }

  return { exercises: [...library.values()].sort((a, b) => byName.compare(a.name, b.name)), attribution };
}

export type CustomExerciseCommand =
  | { kind: "create"; input: CustomExerciseInput }
  | { kind: "delete"; id: string; revision: number };

// "duplicate" keeps no receipt, so the key can be sent again with another name.
export type CustomExerciseResult =
  | { outcome: "created"; entry: CustomExercise }
  | { outcome: "deleted" | "missing" | "stale" | "key-reuse" }
  | { outcome: "duplicate"; message: string };

function hash(command: CustomExerciseCommand): string {
  return createHash("sha256").update(JSON.stringify({ ...command, kind: `custom-exercise-${command.kind}` })).digest("hex");
}

// A custom exercise may take a name only the person's history has, which gives that history a muscle and
// equipment; it may not take a catalog name or another custom exercise's.
export async function mutateCustomExercise(db: AppDatabase, userId: string, key: string, command: CustomExerciseCommand): Promise<CustomExerciseResult> {
  return withReceipt(db, userId, key, hash(command), (receipt): CustomExerciseResult => {
    const { outcome, body } = receipt;

    if (outcome === "created") return { outcome, entry: customExerciseSchema.parse(body) };

    if (outcome === null || outcome === "updated") throw new Error("Custom exercise receipt cannot be replayed");

    return { outcome };
  }, async (tx): Promise<CustomExerciseResult> => {
    if (command.kind === "delete") return softDelete(tx, customExercises, userId, command.id, command.revision);

    const { name, muscle, equipment } = command.input;
    const nameKey = exerciseKey(name);
    const duplicate = { outcome: "duplicate", message: `An exercise named ${name} already exists` } as const;

    if (catalogKeys.has(nameKey)) return duplicate;

    // The partial unique index settles two creates of one name racing each other.
    const [row] = await tx.insert(customExercises).values({ id: randomUUID(), userId, name, key: nameKey, muscle, equipment })
      .onConflictDoNothing().returning();

    return row ? { outcome: "created", entry: custom(row) } : duplicate;
  });
}

