import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { EllipsisVertical } from "lucide-react";
import { Button } from "../components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../components/ui/dropdown-menu";
import { ExerciseImage } from "../exercise-image";
import { findExercise } from "../lib/body-map";
import { exerciseDetail, exerciseLibraryQueryOptions } from "../lib/exercise-library";
import { styles } from "./workouts-styles";

type ExerciseHeadingProps = { name: string; onReplace: () => void; onRemove: () => void };

// An exercise's muscle figure, name, muscle and equipment, and its menu.
export function ExerciseHeading({ name, onReplace, onRemove }: ExerciseHeadingProps) {
  const library = useQuery(exerciseLibraryQueryOptions());
  const known = findExercise(library.data, name);
  const detail = known ? exerciseDetail(known) : null;

  return (
    <div {...stylex.props(styles.exerciseHeader)}>
      <ExerciseImage exercise={known} size="card" />
      <h2 {...stylex.props(styles.exerciseName)}>
        {name}
        {detail && <span {...stylex.props(styles.exerciseDetail)}>{detail}</span>}
      </h2>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`${name} options`}>
            <EllipsisVertical size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onReplace}>Replace exercise</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={onRemove}>Remove exercise</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
