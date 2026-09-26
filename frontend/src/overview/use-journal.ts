import { createPhoto, createRecord, deleteRecord, type RecordCommand, type RecordPath } from "../lib/api";
import { useIdempotentCreate, useIdempotentDelete } from "../lib/use-idempotent";
import { recordPaths } from "../../../src/journal/paths";

type PendingRecord = (RecordCommand | { path: typeof recordPaths.photo; input: FormData }) & { label: string; signature: string };

type PendingDelete = { path: RecordPath; label: string; id: string; revision: number };

export function useJournal(token: string) {
  const create = useIdempotentCreate<PendingRecord>(token, (record, key) => record.path === recordPaths.photo ? createPhoto(token, key, record.input) : createRecord(token, key, record), {
    refresh: ["overview", "workout-summary"],
    success: (record) => `${record.label} saved.`,
    signature: (record) => record.signature,
  });

  const remove = useIdempotentDelete<PendingDelete>(token, (record, key) => deleteRecord(token, record.path, record, key), {
    refresh: ["overview", "workout-summary"],
    success: (record) => `${record.label} removed.`,
  });

  return { create, remove };
}
