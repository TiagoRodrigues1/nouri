import { exerciseKey } from "../../../src/workouts/contract";
import type { ExerciseLibrary, LibraryExercise, Muscle, MuscleMap } from "./api";
import { backRegions, frontRegions, type BodyRegion, type BodySlug } from "./body-regions";

// Nouri speaks the catalog's muscles; the figure is drawn in coarser regions.
const slugs: Record<Muscle, BodySlug[]> = {
  abdominals: ["abs", "obliques"],
  abductors: ["abductors"],
  adductors: ["adductor"],
  biceps: ["biceps"],
  calves: ["calves", "left-soleus", "right-soleus"],
  chest: ["chest"],
  forearms: ["forearm"],
  glutes: ["gluteal"],
  hamstrings: ["hamstring"],
  lats: ["upper-back"],
  "lower back": ["lower-back"],
  "middle back": ["upper-back"],
  neck: ["neck"],
  quadriceps: ["quadriceps"],
  shoulders: ["front-deltoids", "back-deltoids"],
  traps: ["trapezius"],
  triceps: ["triceps"],
};

export type Intensity = "primary" | "secondary";

export type BodySide = { side: "front" | "back"; regions: (BodyRegion & { intensity: Intensity | null })[] };

const sides = [{ side: "front", regions: frontRegions }, { side: "back", regions: backRegions }] as const;

// How hard each region of the figure works, primary winning where a region holds both.
function intensities(muscles: MuscleMap): Map<BodySlug, Intensity> {
  const worked = new Map<BodySlug, Intensity>();

  for (const muscle of muscles.secondary) for (const slug of slugs[muscle]) worked.set(slug, "secondary");

  for (const muscle of muscles.primary) for (const slug of slugs[muscle]) worked.set(slug, "primary");

  return worked;
}

// The sides of the figure that show a primary muscle.
export function bodySides(muscles: MuscleMap): BodySide[] {
  const worked = intensities(muscles);

  return sides.flatMap(({ side, regions }) => {
    const shaded = regions.map((region) => ({ ...region, intensity: worked.get(region.slug) ?? null }));

    return shaded.some((region) => region.intensity === "primary") ? [{ side, regions: shaded }] : [];
  });
}

export function exerciseMuscles(exercise: LibraryExercise | undefined): MuscleMap | null {
  return exercise && exercise.origin !== "logged" ? exercise.muscles : null;
}

export function findExercise(library: ExerciseLibrary | undefined, name: string): LibraryExercise | undefined {
  const key = exerciseKey(name);

  return library?.exercises.find((exercise) => exercise.key === key);
}

// Every muscle a list of exercises works; a muscle that is primary anywhere counts as primary.
export function combinedMuscles(names: string[], library: ExerciseLibrary | undefined): MuscleMap | null {
  const primary = new Set<Muscle>();
  const secondary = new Set<Muscle>();

  for (const name of names) {
    const muscles = exerciseMuscles(findExercise(library, name));

    for (const muscle of muscles?.primary ?? []) primary.add(muscle);

    for (const muscle of muscles?.secondary ?? []) secondary.add(muscle);
  }

  const [first, ...rest] = primary;

  return first ? { primary: [first, ...rest], secondary: [...secondary].filter((muscle) => !primary.has(muscle)) } : null;
}
