import * as stylex from "@stylexjs/stylex";
import { useState, type FormEvent, type UIEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { styles as formStyles } from "./form-styles";
import { colors } from "./theme.stylex";
import { ExerciseImage } from "./exercise-image";
import { exerciseHistoryQueryOptions } from "./lib/exercise-history";
import { equipmentLabels, exerciseDetail, exerciseLibraryQueryOptions, muscleLabels, pickerGroups, useCreateExercise, useDeleteExercise, type PickerFilter } from "./lib/exercise-library";
import { selectValue } from "./lib/select-value";
import { equipment, muscles } from "../../src/exercises/contract";
import type { LibraryExercise, Muscle } from "./lib/api";

type ExercisePickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // The workout's date, so Recent shows what was done by then.
  date: string;
  onPick: (name: string) => void;
};

const muscleOptions = ["all", ...muscles] as const;

const equipmentOptions = ["all", ...equipment] as const;

const createEquipmentOptions = ["none", ...equipment] as const;

// Every row draws a body figure of about a hundred polygons, so the whole library at once stalls each keystroke.
// The list shows this many matches, and more as it scrolls near its end.
const rowsPerPage = 50;

// Choose an exercise from the library, or create one. The body mounts only while the picker is open, so each
// opening starts from an empty search. Render it outside other forms: React bubbles the create form's submit
// through the portal to any form around it.
export function ExercisePicker({ open, onOpenChange, date, onPick }: ExercisePickerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent {...stylex.props(styles.dialog)}>
        {open && <PickerBody date={date} onPick={(name) => { onPick(name); onOpenChange(false); }} />}
      </DialogContent>
    </Dialog>
  );
}

function PickerBody({ date, onPick }: Pick<ExercisePickerProps, "date" | "onPick">) {
  const [filter, setFilter] = useState<PickerFilter>({ query: "", muscle: null, equipment: null });
  const [creating, setCreating] = useState(false);

  if (creating) {
    return <CreateExercise initialName={filter.query.trim()} onBack={() => setCreating(false)} onCreated={onPick} />;
  }

  return <ExerciseList date={date} filter={filter} onFilterChange={setFilter} onPick={onPick} onCreate={() => setCreating(true)} />;
}

function ExerciseList({ date, filter, onFilterChange, onPick, onCreate }: { date: string; filter: PickerFilter; onFilterChange: (filter: PickerFilter) => void; onPick: (name: string) => void; onCreate: () => void }) {
  const library = useQuery(exerciseLibraryQueryOptions());
  const history = useQuery(exerciseHistoryQueryOptions());
  const remove = useDeleteExercise();
  const [shown, setShown] = useState(rowsPerPage);
  const { recent, all } = library.data ? pickerGroups(library.data.exercises, history.data?.exercises ?? [], date, filter) : { recent: [], all: [] };
  const typed = filter.query.trim();

  // A new search starts from the first page again.
  function changeFilter(next: PickerFilter) {
    setShown(rowsPerPage);
    onFilterChange(next);
  }

  function showMoreNearEnd(event: UIEvent<HTMLDivElement>) {
    const list = event.currentTarget;

    if (shown < all.length && list.scrollHeight - list.scrollTop - list.clientHeight < 400) setShown(shown + rowsPerPage);
  }

  function row(exercise: LibraryExercise, group: string) {
    const detail = exerciseDetail(exercise);

    return (
      <div key={`${group}-${exercise.key}`} {...stylex.props(styles.row)}>
        <CommandItem value={`${group}-${exercise.key}`} onSelect={() => onPick(exercise.name)} {...stylex.props(styles.item)}>
          <ExerciseImage exercise={exercise} size="row" />
          <span {...stylex.props(styles.itemText)}>
            <span {...stylex.props(styles.itemName)}>{exercise.name}</span>
            {detail && <span {...stylex.props(styles.itemDetail)}>{detail}</span>}
          </span>
          {exercise.origin === "custom" && <Badge variant="secondary">Custom</Badge>}
        </CommandItem>
        {exercise.origin === "custom" && (
          <Button type="button" variant="ghost" size="sm" disabled={remove.isPending} aria-label={`Delete ${exercise.name}`} onClick={() => remove.mutate(exercise)}>Delete</Button>
        )}
      </div>
    );
  }

  return (
    <>
      <DialogTitle {...stylex.props(formStyles.dialogTitle)}>Choose an exercise</DialogTitle>
      <DialogDescription {...stylex.props(formStyles.dialogDescription)}>Search the library, or create an exercise of your own.</DialogDescription>
      <Command shouldFilter={false} loop>
        <CommandInput placeholder="Search exercises" value={filter.query} onValueChange={(query) => changeFilter({ ...filter, query })} aria-label="Search exercises" />
        <div {...stylex.props(styles.filters)}>
          <Select value={filter.muscle ?? "all"} onValueChange={(next) => { const muscle = selectValue(muscleOptions, next, "all"); changeFilter({ ...filter, muscle: muscle === "all" ? null : muscle }); }}>
            <SelectTrigger aria-label="Muscle" {...stylex.props(formStyles.selectTrigger)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {muscleOptions.map((option) => <SelectItem key={option} value={option}>{option === "all" ? "All muscles" : muscleLabels[option]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filter.equipment ?? "all"} onValueChange={(next) => { const chosen = selectValue(equipmentOptions, next, "all"); changeFilter({ ...filter, equipment: chosen === "all" ? null : chosen }); }}>
            <SelectTrigger aria-label="Equipment" {...stylex.props(formStyles.selectTrigger)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {equipmentOptions.map((option) => <SelectItem key={option} value={option}>{option === "all" ? "All equipment" : equipmentLabels[option]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <CommandList onScroll={showMoreNearEnd} {...stylex.props(styles.list)}>
          {library.isPending && <p {...stylex.props(styles.status)}>Loading exercises…</p>}
          {library.isError && (
            <div {...stylex.props(styles.status)}>
              <p>Exercises could not be loaded.</p>
              <Button type="button" variant="outline" size="sm" disabled={library.isFetching} onClick={() => void library.refetch()}>{library.isFetching ? "Trying…" : "Try again"}</Button>
            </div>
          )}
          {library.data && <CommandEmpty>No exercise matches.</CommandEmpty>}
          {recent.length > 0 && <CommandGroup heading="Recent">{recent.map((exercise) => row(exercise, "recent"))}</CommandGroup>}
          {all.length > 0 && <CommandGroup heading={recent.length > 0 ? "All exercises" : undefined}>{all.slice(0, shown).map((exercise) => row(exercise, "all"))}</CommandGroup>}
        </CommandList>
      </Command>
      <div {...stylex.props(styles.footer)}>
        <Button type="button" variant="outline" size="sm" onClick={onCreate}>{typed ? `Create "${typed}"` : "Create exercise"}</Button>
      </div>
    </>
  );
}

function CreateExercise({ initialName, onBack, onCreated }: { initialName: string; onBack: () => void; onCreated: (name: string) => void }) {
  const [name, setName] = useState(initialName);
  const [muscle, setMuscle] = useState<Muscle | null>(null);
  const [chosenEquipment, setChosenEquipment] = useState<(typeof createEquipmentOptions)[number]>("none");
  const create = useCreateExercise(onCreated);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (muscle) create.mutate({ name, muscle, equipment: chosenEquipment === "none" ? null : chosenEquipment });
  }

  return (
    <>
      <DialogTitle {...stylex.props(formStyles.dialogTitle)}>Create an exercise</DialogTitle>
      <DialogDescription {...stylex.props(formStyles.dialogDescription)}>It joins the library, so you can pick it next time.</DialogDescription>
      <form {...stylex.props(formStyles.formStack)} onSubmit={submit}>
        <div>
          <Label htmlFor="custom-exercise-name" {...stylex.props(formStyles.formLabel)}>Name</Label>
          <Input id="custom-exercise-name" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} required autoFocus />
        </div>
        <div {...stylex.props(formStyles.manualGrid)}>
          <div>
            <Label htmlFor="custom-exercise-muscle" {...stylex.props(formStyles.formLabel)}>Main muscle</Label>
            <Select value={muscle ?? ""} onValueChange={(next) => setMuscle(selectValue(muscles, next, "abdominals"))} required>
              <SelectTrigger id="custom-exercise-muscle" {...stylex.props(formStyles.selectTrigger)}>
                <SelectValue placeholder="Choose a muscle" />
              </SelectTrigger>
              <SelectContent>
                {muscles.map((option) => <SelectItem key={option} value={option}>{muscleLabels[option]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="custom-exercise-equipment" {...stylex.props(formStyles.formLabel)}>Equipment</Label>
            <Select value={chosenEquipment} onValueChange={(next) => setChosenEquipment(selectValue(createEquipmentOptions, next, "none"))}>
              <SelectTrigger id="custom-exercise-equipment" {...stylex.props(formStyles.selectTrigger)}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {createEquipmentOptions.map((option) => <SelectItem key={option} value={option}>{option === "none" ? "None" : equipmentLabels[option]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div {...stylex.props(formStyles.dialogActions, styles.createActions)}>
          <Button type="button" variant="ghost" onClick={onBack}>Back</Button>
          <Button type="submit" disabled={create.isPending || muscle === null}>{create.isPending ? "Creating…" : "Create exercise"}</Button>
        </div>
      </form>
    </>
  );
}

const styles = stylex.create({
  dialog: { display: "grid", gap: 12 },
  filters: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, paddingBlock: 8, paddingInline: 4 },
  list: { maxHeight: "min(420px, 50vh)" },
  row: { display: "flex", alignItems: "center", gap: 4 },
  item: { flex: 1, minWidth: 0 },
  itemText: { display: "grid", minWidth: 0 },
  itemName: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  itemDetail: { fontSize: 12, color: colors.mutedForeground },
  status: { display: "grid", justifyItems: "center", gap: 8, padding: 16, textAlign: "center", fontSize: 13, color: colors.mutedForeground },
  footer: { display: "flex", justifyContent: "flex-end" },
  createActions: { justifyContent: "space-between" },
});
