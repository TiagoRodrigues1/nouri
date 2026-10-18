import { useState } from "react";

type Known = { scope: string; ids: ReadonlySet<string>; arrived: ReadonlySet<string> };

const none: ReadonlySet<string> = new Set();

// The ids that showed up after a scope's first load, so only what the user just added animates in, not a day
// opening or a refetch of what was already there. Set during render, so a new row mounts already marked.
export function useArrivals(ids: readonly string[], scope: string, ready: boolean): ReadonlySet<string> {
  const [known, setKnown] = useState<Known | null>(null);

  if (!ready) return known?.scope === scope ? known.arrived : none;

  if (known?.scope !== scope) {
    setKnown({ scope, ids: new Set(ids), arrived: none });

    return none;
  }

  const fresh = ids.filter((id) => !known.ids.has(id));

  // React discards this render and runs again with the new state before anything reaches the page.
  if (fresh.length > 0) setKnown({ scope, ids: new Set([...known.ids, ...fresh]), arrived: new Set([...known.arrived, ...fresh]) });

  return known.arrived;
}
