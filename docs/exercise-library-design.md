# Exercise library

## Problem

Logging a strength workout means typing each exercise's name. The field suggests names from your own history, so the first time you do an exercise you type it from nothing. Spellings drift, so "Bench", "Bench press", and "Barbell bench press" end up as three separate histories. Apps like Hevy work the other way round. You pick from a library of known exercises, filtered by muscle and equipment. When an exercise is missing, you create it once with its muscle and equipment, and then pick it like any other.

The existing system constrains the design. A workout stores its exercises as `{ name, sets, reps, weightKg }` rows in the `strength_exercises` jsonb. The history, the Progress page, the Overview links, and the MCP `log_workout` tool all identify an exercise by `exerciseKey(name)`. Workouts already logged use whatever names were typed then. Imported workouts have no exercises.

## Usage (caller's view)

In the workout dialog, each exercise card has a **Choose exercise** button instead of a text field:

```
Exercise 1                                         Remove
[ (figure) Barbell Squat      Quadriceps · Barbell ]
Last time, Thu 24 Sep: 3 × 8 · 60 kg            [Repeat]
Sets [  ]   Reps per set [  ]   Weight (kg) [  ]
```

The button opens a picker. A new workout starts with no cards, and **Add exercise** opens the picker first, so no card is ever left without an exercise. It has a search field, muscle and equipment filters, a **Recent** group with the exercises done on or before the dialog's date, most recent first, and then **All exercises**. Each row shows a figure with the muscles the exercise works (see [workout-routines-design.md](workout-routines-design.md)), the muscle, and the equipment. Custom exercises are marked *Custom* and have a **Delete** button. When nothing matches, **Create "…"** opens a short form (name, muscle, equipment) with the search text already filled in. Saving the form creates the exercise and picks it. **Add exercise** opens the picker and adds a card for the exercise you choose.

```ts
const { exercises } = await getExerciseLibrary();
// [{ origin: "catalog", key: "barbell squat", name: "Barbell Squat", muscle: "quadriceps", muscles: { primary: ["quadriceps"], secondary: ["calves", "glutes", "hamstrings", "lower back"] }, equipment: "barbell", images: [".../Barbell_Squat/0.jpg", ".../Barbell_Squat/1.jpg"] },
//  { origin: "custom", id, revision: 1, key: "landmine row", name: "Landmine row", muscle: "middle back", muscles: { primary: ["middle back"], secondary: [] }, equipment: "barbell" },
//  { origin: "logged", key: "squat", name: "Squat" }, ...]   // sorted by name

await createCustomExercise(key, { name: "Landmine row", muscle: "middle back", equipment: "barbell" }); // 201, or 409 if the name is taken
await deleteCustomExercise(exercise, key);                                                            // 204
```

`GET /v1/exercises`, `POST /v1/exercises`, `DELETE /v1/exercises/{id}` with `If-Match`. The MCP server gains `search_exercises`, which returns up to 25 matches with your own exercises first, so an assistant logs "Barbell Squat" and not "squat".

## Shape

```
data/free-exercise-db.json        the catalog snapshot: id, name, primaryMuscles, secondaryMuscles, equipment, images (pinned commit)
scripts/import-exercises.py       regenerates it from yuhonas/free-exercise-db
src/exercises/contract.ts         muscles, equipment, customExerciseInputSchema, libraryExerciseSchema, exerciseLibrarySchema
src/exercises/exercises.ts        catalog load, getExerciseLibrary(db, userId), mutateCustomExercise(db, userId, key, command)
db/migrations/0003-custom-exercises.sql
src/app.ts                        the three routes
src/mcp/tools.ts                  search_exercises
frontend/src/lib/exercise-library.ts   query options, labels, pickerGroups(library, history, date, filter), useCreateExercise, useDeleteExercise
frontend/src/components/ui/command.tsx shadcn Command (cmdk); replaces the Autocomplete and Combobox the name field used
frontend/src/exercise-picker.tsx       the picker dialog with its create form
frontend/src/exercise-image.tsx        an exercise's muscle figure
frontend/src/overview-dialogs.tsx      cards use the picker
```

```ts
type LibraryExercise =
  | { origin: "catalog"; key: string; name: string; muscle: Muscle; muscles: MuscleMap; equipment: Equipment | null; images: string[] }
  | { origin: "custom"; id: string; revision: number; key: string; name: string; muscle: Muscle; muscles: MuscleMap; equipment: Equipment | null }
  | { origin: "logged"; key: string; name: string };   // a name from your workouts that is in neither list

getExerciseLibrary(db, userId): Promise<{ exercises: LibraryExercise[]; attribution: { label: string; url: string } }>;

type CustomExerciseCommand = { kind: "create"; input: CustomExerciseInput } | { kind: "delete"; id: string; revision: number };
mutateCustomExercise(db, userId, key, command): Promise<
  { outcome: "created"; entry: CustomExercise } | { outcome: "deleted" | "missing" | "stale" | "key-reuse" } | { outcome: "duplicate"; message: string }>;
```

**The name stays the identity.** A picked exercise writes its name into the workout row, as typing did. History, Progress, Overview, MCP, and the workout schema stay as they are, and no stored workout is rewritten. The library only decides which names are offered and what metadata goes with each one. Per subtract-before-you-add, the library sits beside the workout model and does not replace it.

**Keys are unique across the library.** Creating a custom exercise whose `exerciseKey` matches a catalog exercise or another custom exercise answers 409. A partial unique index on `(user_id, key)` enforces this for custom exercises, so two concurrent creates cannot both succeed. A custom exercise *may* reuse a name that is only in your history. That is how you give "Squat" a muscle and equipment after the fact.

**The server merges the library.** It folds the catalog, your custom exercises, and the names in your workouts, in that order of precedence, into one list keyed by `exerciseKey`. The page and MCP both get the merged list, so the precedence rule lives in one place. Recency is not part of the library. The picker reads it from the `exercise-history` query it already loads for *Last time*, filtered to the dialog's date.

**The catalog is a checked-in snapshot**, like Ciqual. The snapshot is [free-exercise-db](https://github.com/yuhonas/free-exercise-db), which is public domain (Unlicense). It keeps the strength, powerlifting, olympic weightlifting, strongman, and plyometrics exercises, about 740 of them. Stretching and cardio are left out because they do not fit sets × reps × weight. Each exercise keeps upstream's primary and secondary muscles as `muscles`, with secondaries that repeat a primary dropped, and its `muscle` is its first primary muscle. A custom exercise's `muscles` is its one muscle as primary. The API turns the snapshot's image paths into jsDelivr URLs at the same pinned commit, since the photos run to about 100 MB, and the CSP allows `img-src https://cdn.jsdelivr.net`. Animated GIFs like Hevy's come from Gym Visual and are licensed commercially. The page no longer shows the photos; each exercise is pictured by the muscles it works. Being public domain, the catalog needs no credit in the picker.

The public surface is three routes and one MCP tool. Behind it sit the snapshot parsing, the three-way merge and its precedence, key collision rules, idempotent creation, and revisioned deletion. The receipt and soft-delete code is reused (`withReceipt`, `softDelete`), as saved meals reuse it.

## Synthesis decision

The design was sketched three ways.

- **A: library beside names (chosen).** This is the design above.
- **B: id identity.** Each workout row stores an `exerciseId` (`catalog:Barbell_Squat` or a custom uuid) next to the name, and history groups by id. Renaming a custom exercise keeps its history, and "Squat" and "Back squat" can be merged. The cost is a data migration that turns every distinct historical name into a custom exercise, a changed workout input for the page, MCP, and receipts, and a second identity rule beside `exerciseKey` for imported or old rows. That is a lot of change for renames, which nobody has asked for.
- **C: a client-only catalog.** The page bundles a static list and custom exercises are just names in your history. There is no new table or route. But a custom exercise could not have a muscle or equipment, so filtering would not work for your own exercises, and MCP would not see the catalog.

A is the base. It keeps every existing reader working and adds one table and one read. From B it takes the rule that keys are unique across the library, which keeps a later move to ids possible. From C it takes recency computed on the client from the cached history query, so the library endpoint takes no date parameter.

## Tradeoffs accepted

- We accept that catalog names do not match names logged before. "Squat" stays separate from "Barbell Squat", and the old name still appears in the picker as a logged exercise. In exchange, no stored workout is rewritten. Creating a custom exercise named "Squat" gives the old history a muscle and equipment.
- Custom exercises cannot be renamed, because renaming would cut them off from their history under the name identity. To rename one, you delete it and create it again.
- Deleting a custom exercise leaves the workouts that used it alone. If you have logged it, its name falls back to a logged exercise.
- Every library read sends the whole catalog, about 740 rows and roughly 15 KB compressed. Query caching makes this a once-per-session cost, and it avoids a search endpoint.
- The catalog's names are the dataset's own, such as "Barbell Bench Press - Medium Grip", not Hevy's tidier names.

## Alternatives considered

- **Id identity (B above).** It would hide renames and merges behind the history read. It exposes a migration and a second identity scheme to every writer: the page, MCP, and receipts.
- **A search endpoint (`/v1/exercises?q=&muscle=`)** with the catalog kept on the server. That is one more parameterized call per keystroke for a list small enough to send whole. The picker filters on the client. MCP is the exception: `search_exercises` filters on the server, because an assistant should not read 740 exercises to find one.
- **A creatable combobox in the card** in place of a picker dialog. It cannot hold muscle and equipment filters or a create form without becoming the dialog anyway.

## Open questions and risks

- Should Progress group exercises by muscle once most of them have one?

## Next implementation step

Generate `data/free-exercise-db.json` with `scripts/import-exercises.py`, then write `getExerciseLibrary` against it.
