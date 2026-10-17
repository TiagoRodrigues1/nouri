import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { callbackResults, disconnectConnection, getConnection, importKinds, refreshConnection, startConnection, syncConnection, type WearableProvider } from "./api";
import { callbackMessages, countOf, listCounts, noun, providerDetails } from "./wearables";
import { queryRefresh } from "./query-refresh";

function useConnectionStatus(provider: WearableProvider, enabled: boolean) {
  return useQuery({
    queryKey: ["connection", provider],
    queryFn: () => getConnection(provider),
    enabled,
  });
}

// Keeps imports current without a Sync button. The page shows what is stored at once; this asks the server to
// import in the background when that is stale, on load, on focus, and every five minutes while the page is visible.
// The server decides whether anything is stale, so the calls are cheap. While an import runs it checks every few
// seconds. When the last sync time moves, the imported records are read again; when only the error changes, as when
// a background import fails, only the connection status is, so the Wearables dialog shows it.
function useBackgroundImports(provider: WearableProvider, on: { imported: () => Promise<void>; failed: () => Promise<void> }, enabled: boolean) {
  const freshness = useQuery({
    queryKey: ["sync-state", provider],
    enabled,
    queryFn: () => refreshConnection(provider),
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => query.state.data?.pending ? 3000 : 5 * 60_000,
  });

  // TanStack Query keeps the same object while the answer is unchanged, so this runs only when it changes.
  const state = freshness.data;
  const seen = useRef(state);
  const { imported, failed } = on;

  useEffect(() => {
    const before = seen.current;

    seen.current = state;

    if (!state || !before) return;

    if (before.lastSyncedAt !== state.lastSyncedAt) void imported();
    else if (before.lastError !== state.lastError) void failed();
  }, [state, imported, failed]);

  return freshness.data?.pending ?? false;
}

// Connect, Sync, and Disconnect for one cloud provider. Imports show up through the overview query.
// The page shell mounts it once, so the OAuth callback is handled whichever page it lands on.
// The status is read only while `showing`, since counting imports costs the server queries no page needs.
export function useConnection(provider: WearableProvider, showing: boolean) {
  const client = useQueryClient();
  const { name, revokeHelp } = providerDetails[provider];

  const refresh = useCallback(async () => {
    await Promise.all(["connection", ...new Set([...queryRefresh.sleep, ...queryRefresh.workout])].map((name) => client.invalidateQueries({ queryKey: [name] })));
  }, [client]);

  const status = useConnectionStatus(provider, showing);
  const refreshStatus = useCallback(() => client.invalidateQueries({ queryKey: ["connection", provider] }), [client, provider]);

  const connect = useMutation({
    mutationFn: () => startConnection(provider),
    onSuccess: (url) => window.location.assign(url),
    onError: (error) => toast.error(error.message),
  });

  const sync = useMutation({
    mutationFn: () => syncConnection(provider),
    onSuccess: async (result) => {
      await refresh();

      const changes = importKinds.flatMap((kind) => {
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
    mutationFn: () => disconnectConnection(provider),
    onSuccess: async (result) => {
      await refresh();
      const removed = listCounts(result.removed);

      toast.success(result.revoked ? `${name} disconnected. Removed ${removed} it imported.` : `Disconnected and removed ${removed} it imported. ${revokeHelp}`);
    },
    onError: (error) => toast.error(error.message),
  });

  // The OAuth callback lands on /overview?connect=<provider>&result=<outcome>, read once when the page loads.
  const [callback] = useState(() => {
    const params = new URLSearchParams(window.location.search);

    return params.get("connect") === provider ? callbackResults.find((item) => item === params.get("result")) ?? null : null;
  });

  // Right after signing in, the page runs the first sync itself and reports its counts, so the background check
  // waits for it instead of queueing a second one.
  const importing = useBackgroundImports(provider, { imported: refresh, failed: refreshStatus }, callback !== "connected" || sync.isSuccess || sync.isError);

  // Report the callback once and clean the URL.
  const handled = useRef(false);
  const { mutate: startSync } = sync;

  useEffect(() => {
    if (handled.current || !callback) return;
    handled.current = true;
    const params = new URLSearchParams(window.location.search);

    params.delete("connect");
    params.delete("result");
    window.history.replaceState(null, "", `${window.location.pathname}${params.size ? `?${params}` : ""}`);

    if (callback === "connected") {
      toast.success(callbackMessages.connected);
      startSync();
    } else {
      toast.error(callbackMessages[callback]);
    }
  }, [callback, startSync]);

  return { provider, status, importing, connect, sync, disconnect };
}
