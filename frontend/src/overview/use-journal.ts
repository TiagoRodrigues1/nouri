import { createPhoto, createRecord, deleteRecord, type RecordCommand, type RecordPath } from "../lib/api";
import { useIdempotentWrite, useIdempotentDelete } from "../lib/use-idempotent";
import { recordQueryRefresh } from "../lib/query-refresh";
import { recordPaths } from "../../../src/journal/paths";

// `onSaved` runs as soon as the server accepts the record, before the pages that show it are read again.
type PendingRecord = (RecordCommand | { path: typeof recordPaths.photo; input: FormData }) & { label: string; signature: string; onSaved?: () => void };

type PendingDelete = { path: RecordPath; label: string; id: string; revision: number };

export function useJournal() {
  const create = useIdempotentWrite<PendingRecord>((record, key) => record.path === recordPaths.photo ? createPhoto(key, record.input) : createRecord(key, record), {
    refreshFor: (record) => recordQueryRefresh[record.path],
    success: (record) => `${record.label} saved.`,
    signature: (record) => record.signature,
    onSuccess: (record) => record.onSaved?.(),
  });

  const remove = useIdempotentDelete<PendingDelete>((record, key) => deleteRecord(record.path, record, key), {
    refreshFor: (record) => recordQueryRefresh[record.path],
    success: (record) => `${record.label} removed.`,
  });

  return { create, remove };
}
