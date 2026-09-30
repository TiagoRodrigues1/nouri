import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { callbackResults, disconnectConnection, getConnection, startConnection, syncConnection, type ImportKind, type WearableProvider } from "./api";
import { callbackMessages, countOf, noun, providerDetails } from "./wearables";

const kinds: ImportKind[] = ["sleep", "workouts"];

// "2 sleep sessions and 1 workout", or "nothing" when every count is zero.
function listCounts(counts: Record<ImportKind, number>): string {
  const parts = kinds.flatMap((kind) => counts[kind] > 0 ? [countOf(kind, counts[kind])] : []);

  return parts.length ? parts.join(" and ") : "nothing";
}

function useConnectionStatus(token: string, provider: WearableProvider) {
  return useQuery({
    queryKey: ["connection", token, provider],
    queryFn: () => getConnection(token, provider),
    enabled: Boolean(token),
  });
}

// Connect, Sync, and Disconnect for one cloud provider. Imported sleep and workouts show up through the overview query.
// The page shell mounts it once, so the OAuth callback is handled whichever page it lands on.
export function useConnection(token: string, provider: WearableProvider) {
  const client = useQueryClient();
  const { name, revokeHelp } = providerDetails[provider];
  const refresh = () => Promise.all([client.invalidateQueries({ queryKey: ["connection", token, provider] }), client.invalidateQueries({ queryKey: ["overview", token] })]);
  const status = useConnectionStatus(token, provider);

  const connect = useMutation({
    mutationFn: () => startConnection(token, provider),
    onSuccess: (url) => window.location.assign(url),
    onError: (error) => toast.error(error.message),
  });

  const sync = useMutation({
    mutationFn: () => syncConnection(token, provider),
    onSuccess: async (result) => {
      await refresh();

      const changes = kinds.flatMap((kind) => {
        const { created, updated, removed } = result[kind];

        return [created && `${created} new ${noun(kind, created)}`, updated && `${countOf(kind, updated)} updated`, removed && `${countOf(kind, removed)} removed`].filter(Boolean);
      });

      toast.success(changes.length ? `${name} synced: ${changes.join(", ")}.` : `${name} synced. No changes.`);
    },
    onError: async (error) => {
      await refresh();
      toast.error(error.message);
    },
  });

  const disconnect = useMutation({
    mutationFn: () => disconnectConnection(token, provider),
    onSuccess: async (result) => {
      await refresh();
      const removed = listCounts(result.removed);

      toast.success(result.revoked ? `${name} disconnected. Removed ${removed} it imported.` : `Disconnected and removed ${removed} it imported. ${revokeHelp}`);
    },
    onError: (error) => toast.error(error.message),
  });

  // The OAuth callback lands on /overview?connect=<provider>&result=<outcome>. Report it once and clean the URL.
  const handled = useRef(false);
  const { mutate: startSync } = sync;

  useEffect(() => {
    if (handled.current || !token) return;
    const params = new URLSearchParams(window.location.search);
    const result = callbackResults.find((item) => item === params.get("result"));

    if (params.get("connect") !== provider || !result) return;
    handled.current = true;
    params.delete("connect");
    params.delete("result");
    window.history.replaceState(null, "", `${window.location.pathname}${params.size ? `?${params}` : ""}`);

    if (result === "connected") {
      toast.success(callbackMessages.connected);
      startSync();
    } else {
      toast.error(callbackMessages[result]);
    }
  }, [token, provider, startSync]);

  return { provider, status, connect, sync, disconnect };
}
