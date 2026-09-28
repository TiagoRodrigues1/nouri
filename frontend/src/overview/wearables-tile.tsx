import * as stylex from "@stylexjs/stylex";
import { Settings2, Watch } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import type { ImportKind, WearableProvider } from "../lib/api";
import { useConnectionStatus } from "../lib/use-connection";
import { connectionBadges, countOf, importNouns, lastSync, providerDetails } from "../lib/wearables";
import { useDashboardPage } from "../dashboard-page-context";
import { styles } from "../overview-styles";
import { Stat, Tile } from "./shared";

const provider: WearableProvider = "google-health";

// What the connected service imported for this day. Connecting, syncing, and disconnecting live in the Wearables dialog.
export function WearablesTile({ kind, imported }: { kind: ImportKind; imported: number }) {
  const { token, onManageWearables } = useDashboardPage();
  const status = useConnectionStatus(token, provider);
  const data = status.data;
  const badge = data && connectionBadges[data.connection];
  const { name } = providerDetails[provider];
  const linked = data?.connection === "connected" || data?.connection === "reauthorize";

  return (
    <Tile title="Wearables" icon={<Watch size={16} />} aside={badge && <Badge variant={badge.variant}>{badge.label}</Badge>}>
      {status.isError && <p role="alert" {...stylex.props(styles.alert)}>{status.error.message}</p>}
      {linked && (
        <div {...stylex.props(styles.rows)}>
          <Stat label="Imported this day" value={countOf(kind, imported)} />
          <Stat label="Last sync" value={lastSync(data.lastSyncedAt)} />
        </div>
      )}
      {data?.connection === "not-connected" && <p {...stylex.props(styles.note)}>Connect {name} to import {importNouns[kind][1]} from a Fitbit, such as Fitbit Air.</p>}
      {data?.connection === "not-configured" && <p {...stylex.props(styles.note)}>{name} is not set up on this server.</p>}
      {data?.lastError && <p role="alert" {...stylex.props(styles.alert)}>{data.lastError}</p>}
      <div {...stylex.props(styles.actions)}>
        <Button size="sm" variant="outline" onClick={onManageWearables}><Settings2 size={15} /> {linked ? "Manage" : "Set up"}</Button>
      </div>
    </Tile>
  );
}
