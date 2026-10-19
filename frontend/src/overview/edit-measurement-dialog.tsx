import * as stylex from "@stylexjs/stylex";
import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { styles } from "../form-styles";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { TimePicker } from "../components/ui/time-picker";
import { measurementLabels } from "../overview-dialogs";
import { overviewQueryOptions } from "../lib/day-query";
import { currentTime, dateLabel, entryTime, occurredAt, timeZone } from "../lib/time";
import type { Measurement } from "../lib/api";
import { measurementLimits, type MeasurementInput } from "../../../src/measurements/contract";

// Reads the entry from the day's overview, so a refresh after a failed save shows what is saved now,
// and an entry deleted meanwhile closes the dialog.
export function EditMeasurementDialog({ date, entryId, pending, onSave, onClose }: {
  date: string;
  entryId: string | null;
  pending: boolean;
  onSave: (entry: Measurement, input: MeasurementInput) => void;
  onClose: () => void;
}) {
  const overview = useQuery({ ...overviewQueryOptions(date), enabled: entryId !== null });
  const entry = overview.data?.measurements.entries.find((candidate) => candidate.id === entryId) ?? null;

  return (
    <Dialog open={entry !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogTitle {...stylex.props(styles.dialogTitle)}>Edit {entry ? measurementLabels[entry.kind].name.toLowerCase() : "measurement"}</DialogTitle>
        <DialogDescription {...stylex.props(styles.dialogDescription)}>
          {entry ? `Changes apply to this entry on ${dateLabel(entry.localDate)}.` : null}
        </DialogDescription>
        {/* Keyed by revision, so an entry changed elsewhere restarts from what is saved now. */}
        {entry && <EditMeasurementForm key={`${entry.id}:${entry.revision}`} entry={entry} pending={pending} onSave={(input) => onSave(entry, input)} onCancel={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function EditMeasurementForm({ entry, pending, onSave, onCancel }: { entry: Measurement; pending: boolean; onSave: (input: MeasurementInput) => void; onCancel: () => void }) {
  const [time, setTime] = useState(() => entryTime(entry));
  const [value, setValue] = useState(() => String(entry.value));
  const { name, unit } = measurementLabels[entry.kind];
  const limits = measurementLimits[entry.kind];

  // An unchanged time keeps the recorded instant and zone. A new time is read on the entry's own day, in this browser's zone.
  // The browser checks the range before this runs.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const when = time === entryTime(entry)
      ? { occurredAt: entry.occurredAt, timeZone: entry.timeZone }
      : { occurredAt: occurredAt(entry.localDate, time), timeZone };

    onSave({ ...when, kind: entry.kind, value: Number(value) });
  }

  return (
    <form {...stylex.props(styles.formStack)} onSubmit={submit}>
      <div {...stylex.props(styles.timeField)}>
        <Label {...stylex.props(styles.formLabel, styles.timeLabel)} htmlFor="edit-measurement-time">Time measured</Label>
        <TimePicker id="edit-measurement-time" value={time} onChange={setTime} onNow={() => setTime(currentTime())} />
      </div>
      <div>
        <Label {...stylex.props(styles.formLabel)} htmlFor="edit-measurement-value">{name} in {unit}</Label>
        {/* Any step, so a value logged more precisely elsewhere can be saved unchanged. */}
        <Input
          id="edit-measurement-value"
          type="number"
          inputMode="decimal"
          min={limits.min}
          max={limits.max}
          step="any"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          autoFocus
          required
        />
      </div>
      <div {...stylex.props(styles.dialogActions)}>
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={pending}>Save changes</Button>
      </div>
    </form>
  );
}
