import { createPhoto, createRecord, deleteRecord, type RecordCommand, type RecordPath } from "../lib/api";
import { useIdempotentWrite, useIdempotentDelete } from "../lib/use-idempotent";
import { recordQueryRefresh } from "../lib/query-refresh";
import { recordPaths } from "../../../src/journal/paths";

type PendingRecord = (RecordCommand | { path: typeof recordPaths.photo; input: FormData }) & { label: string; signature: string };

type PendingDelete = { path: RecordPath; label: string; id: string; revision: number };

export function useJournal(token: string) {
  const create = useIdempotentWrite<PendingRecord>(token, (record, key) => record.path === recordPaths.photo ? createPhoto(token, key, record.input) : createRecord(token, key, record), {
    refreshFor: (record) => recordQueryRefresh[record.path],
    success: (record) => `${record.label} saved.`,
    signature: (record) => record.signature,
  });

  const remove = useIdempotentDelete<PendingDelete>(token, (record, key) => deleteRecord(token, record.path, record, key), {
    refreshFor: (record) => recordQueryRefresh[record.path],
    success: (record) => `${record.label} removed.`,
  });

  return { create, remove };
}
