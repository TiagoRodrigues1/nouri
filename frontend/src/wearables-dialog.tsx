import * as stylex from "@stylexjs/stylex";
import { useState, type ReactNode } from "react";
import { Link2, RefreshCw, Unplug } from "lucide-react";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./components/ui/dialog";
import { importKindNames, importKinds, type ConnectionStatus } from "./lib/api";
import type { useConnection } from "./lib/use-connection";
import { connectionBadges, countOf, lastSync, listCounts, listOr, providerDetails } from "./lib/wearables";
import { styles as formStyles } from "./form-styles";
import { styles as overviewStyles } from "./overview-styles";
import { Stat } from "./overview/shared";
import { colors } from "./theme.stylex";

type Action = "connect" | "reconnect" | "sync" | "disconnect";

type ConnectionView = {
  actions: Action[];
  showStats: boolean;
  note?: (name: string, windowDays: number | null) => ReactNode;
};

const views: Record<ConnectionStatus["connection"], ConnectionView> = {
  "not-configured": {
    actions: [], showStats: false,
    note: (name) => <>This server has no {name} settings. Add them to <code>.env</code> and restart Nouri; the README lists them.</>,
  },
  "not-connected": { actions: ["connect"], showStats: true },
  connected: {
    actions: ["sync", "disconnect"], showStats: true,
    note: (name, windowDays) => <>Each sync rereads the last {windowDays} days, so edits and deletions in {name} reach Nouri.</>,
  },
  reauthorize: { actions: ["reconnect", "disconnect"], showStats: true },
};

const styles = stylex.create({
  provider: { display: "grid", gap: 12, padding: 16, borderWidth: 1, borderStyle: "solid", borderColor: colors.border, borderRadius: 12 },
  providerHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 },
  providerName: { display: "flex", alignItems: "center", gap: 7, margin: 0, fontSize: 14, fontWeight: 600 },
});

type WearablesDialogProps = { open: boolean; onOpenChange: (open: boolean) => void; connection: ReturnType<typeof useConnection> };

// Connect, Sync, and Disconnect for Google Health, with what it imported, the last successful sync, and the last error.
export function WearablesDialog({ open, onOpenChange, connection }: WearablesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle {...stylex.props(formStyles.dialogTitle)}>Wearables</DialogTitle>
        <DialogDescription {...stylex.props(formStyles.dialogDescription)}>
          Imported sleep, workouts, steps, active energy, and heart rate appear on the Overview next to what you log by hand. They change only at their source, so edit or delete them there, then sync.
        </DialogDescription>
        <ProviderPanel connection={connection} />
      </DialogContent>
    </Dialog>
  );
}

function ProviderPanel({ connection }: { connection: ReturnType<typeof useConnection> }) {
  const { provider, status, connect, sync, disconnect } = connection;
  const [confirming, setConfirming] = useState(false);
  const { name, description } = providerDetails[provider];
  const data = status.data;
  const busy = connect.isPending || sync.isPending || disconnect.isPending;
  const view = data && views[data.connection];
  const badge = data && connectionBadges[data.connection];
  // A grant from before a kind existed, or one with a box unticked, imports only some kinds until the person connects again.
  const missing = data?.connection === "connected" ? importKinds.filter((kind) => !data.granted.includes(kind)) : [];
  const actions = view && missing.length > 0 ? ["reconnect" as const, ...view.actions] : view?.actions;

  return (
    <section {...stylex.props(styles.provider)} aria-label={name}>
      <div {...stylex.props(styles.providerHeader)}>
        <h3 {...stylex.props(styles.providerName)}><Link2 size={16} /> {name}</h3>
        {badge && <Badge variant={badge.variant}>{badge.label}</Badge>}
      </div>
      <p {...stylex.props(overviewStyles.note)}>{description}</p>
      {status.isError && <p role="alert" {...stylex.props(overviewStyles.alert)}>{status.error.message}</p>}
      {data && view?.note && <p {...stylex.props(overviewStyles.note)}>{view.note(name, data.windowDays)}</p>}
      {missing.length > 0 && <p {...stylex.props(overviewStyles.note)}>Nouri cannot read {listOr.format(missing.map((kind) => importKindNames[kind]))} with this sign-in. Choose Connect again and allow it to import them too.</p>}
      {data && view?.showStats && (
        <div {...stylex.props(overviewStyles.rows)}>
          <Stat label="Last successful sync" value={lastSync(data.lastSyncedAt)} />
          {importKinds.map((kind) => <Stat key={kind} label={`Imported ${importKindNames[kind]}`} value={countOf(kind, data.imported[kind])} />)}
        </div>
      )}
      {data?.lastError && <p role="alert" {...stylex.props(overviewStyles.alert)}>{data.lastError}</p>}
      <div {...stylex.props(overviewStyles.actions)}>
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
              Nouri revokes its access and removes what it imported: {data ? listCounts(data.imported) : "nothing"}. Your data stays in {name}, and what you logged by hand stays in Nouri.
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
    </section>
  );
}
