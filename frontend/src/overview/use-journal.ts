import { createRecord, deleteRecord, type RecordInput, type RecordPath } from "../lib/api";
import { useIdempotentCreate, useIdempotentDelete } from "../lib/use-idempotent";

type PendingRecord = { path: RecordPath; label: string; signature: string; input: RecordInput };

type PendingDelete = { path: RecordPath; label: string; id: string; revision: number };

export function useJournal(token: string) {
  const create = useIdempotentCreate<PendingRecord>(token, (record, key) => createRecord(token, record.path, key, record.input), {
    refresh: ["overview", "day"],
    success: (record) => `${record.label} saved.`,
    signature: (record) => record.signature,
  });

  const remove = useIdempotentDelete<PendingDelete>(token, (record, key) => deleteRecord(token, record.path, record, key), {
    refresh: ["overview", "day"],
    success: (record) => `${record.label} removed.`,
  });

  return { create, remove };
}
