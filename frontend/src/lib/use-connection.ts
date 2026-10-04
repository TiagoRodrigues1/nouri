import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { callbackResults, disconnectConnection, getConnection, importKinds, startConnection, syncConnection, type WearableProvider } from "./api";
import { callbackMessages, countOf, listCounts, noun, providerDetails } from "./wearables";
import { queryRefresh } from "./query-refresh";

function useConnectionStatus(provider: WearableProvider, enabled: boolean) {
  return useQuery({
    queryKey: ["connection", provider],
    queryFn: () => getConnection(provider),
    enabled,
  });
}

// Connect, Sync, and Disconnect for one cloud provider. Imports show up through the overview query.
// The page shell mounts it once, so the OAuth callback is handled whichever page it lands on.
// The status is read only while `showing`, since counting imports costs the server queries no page needs.
export function useConnection(provider: WearableProvider, showing: boolean) {
  const client = useQueryClient();
  const { name, revokeHelp } = providerDetails[provider];

  const refresh = () => Promise.all(["connection", ...new Set([...queryRefresh.sleep, ...queryRefresh.workout])]
    .map((name) => client.invalidateQueries({ queryKey: [name] })));

  const status = useConnectionStatus(provider, showing);

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

  // The OAuth callback lands on /overview?connect=<provider>&result=<outcome>. Report it once and clean the URL.
  const handled = useRef(false);
  const { mutate: startSync } = sync;

  useEffect(() => {
    if (handled.current) return;
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
  }, [provider, startSync]);

  return { provider, status, connect, sync, disconnect };
}
