import * as stylex from "@stylexjs/stylex";
import { useState, type ReactNode } from "react";
import { Link2, RefreshCw, Unplug } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import type { ConnectionStatus, ImportKind, WearableProvider } from "../lib/api";
import { useConnection } from "../lib/use-connection";
import { countOf, importNouns, providerDetails } from "../lib/wearables";
import { styles } from "../overview-styles";
import { Stat, Tile } from "./shared";

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

const kinds: ImportKind[] = ["sleep", "workouts"];

type Action = "connect" | "reconnect" | "sync" | "disconnect";

type ConnectionView = {
  badge: { label: string; variant: "secondary" | "outline" | "destructive" };
  actions: Action[];
  showStats: boolean;
  note?: (name: string, windowDays: number | null) => ReactNode;
};

const views: Record<ConnectionStatus["connection"], ConnectionView> = {
  "not-configured": {
    badge: { label: "Not set up", variant: "outline" }, actions: [], showStats: false,
    note: (name) => <>This server has no {name} settings. Add them to <code>.env</code> and restart Nouri; the README lists them.</>,
  },
  "not-connected": { badge: { label: "Not connected", variant: "outline" }, actions: ["connect"], showStats: true },
  connected: {
    badge: { label: "Connected", variant: "secondary" }, actions: ["sync", "disconnect"], showStats: true,
    note: (name, windowDays) => <>Each sync rereads the last {windowDays} days, so edits and deletions in {name} reach Nouri.</>,
  },
  reauthorize: { badge: { label: "Sign in again", variant: "destructive" }, actions: ["reconnect", "disconnect"], showStats: true },
};

// Connect, Sync, and Disconnect for one cloud provider, with what it imported, the last successful sync, and the last error.
export function ConnectionTile({ token, provider }: { token: string; provider: WearableProvider }) {
  const { status, connect, sync, disconnect } = useConnection(token, provider);
  const [confirming, setConfirming] = useState(false);
  const { name, description } = providerDetails[provider];
  const data = status.data;
  const busy = connect.isPending || sync.isPending || disconnect.isPending;
  const view = data && views[data.connection];
  // A grant from before workouts, or one with a box unticked, imports only some kinds until the person connects again.
  const missing = data?.connection === "connected" ? kinds.filter((kind) => !data.granted.includes(kind)) : [];
  const actions = view && missing.length > 0 ? ["reconnect" as const, ...view.actions] : view?.actions;

  return (
    <Tile title={name} icon={<Link2 size={16} />} aside={view && <Badge variant={view.badge.variant}>{view.badge.label}</Badge>}>
      <p {...stylex.props(styles.note)}>{description}</p>
      {status.isError && <p role="alert" {...stylex.props(styles.alert)}>{status.error.message}</p>}
      {data && view?.note && <p {...stylex.props(styles.note)}>{view.note(name, data.windowDays)}</p>}
      {missing.length > 0 && <p {...stylex.props(styles.note)}>Nouri cannot read {missing.map((kind) => importNouns[kind][1]).join(" or ")} with this sign-in. Choose Connect again and allow it to import them too.</p>}
      {data && view?.showStats && (
        <div {...stylex.props(styles.rows)}>
          <Stat label="Last successful sync" value={data.lastSyncedAt ? when.format(new Date(data.lastSyncedAt)) : "Never"} />
          <Stat label="Imported sleep" value={countOf("sleep", data.imported.sleep)} />
          <Stat label="Imported workouts" value={countOf("workouts", data.imported.workouts)} />
        </div>
      )}
      {data?.lastError && <p role="alert" {...stylex.props(styles.alert)}>{data.lastError}</p>}
      <div {...stylex.props(styles.actions)}>
        {actions?.map((action) => {
          switch (action) {
            case "connect":
            case "reconnect": return (
              <Button key={action} size="sm" disabled={busy} onClick={() => connect.mutate()}>
                <Link2 size={15} /> {action === "connect" ? "Connect" : "Connect again"}
              </Button>
            );
            case "sync": return (
              <Button key={action} size="sm" variant="outline" disabled={busy} onClick={() => sync.mutate()}>
                <RefreshCw size={15} /> {sync.isPending ? "Syncing…" : "Sync now"}
              </Button>
            );
            case "disconnect": return (
              <Button key={action} size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(true)}>
                <Unplug size={15} /> Disconnect
              </Button>
            );
          }
        })}
      </div>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect {name}?</DialogTitle>
            <DialogDescription>
              Nouri revokes its access and removes the {countOf("sleep", data?.imported.sleep ?? 0)} and {countOf("workouts", data?.imported.workouts ?? 0)} it imported. Your data stays in {name}, and sleep and workouts you logged by hand stay in Nouri.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>Cancel</Button>
            <Button variant="destructive" disabled={disconnect.isPending} onClick={() => disconnect.mutate(undefined, { onSettled: () => setConfirming(false) })}>
              {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Tile>
  );
}
