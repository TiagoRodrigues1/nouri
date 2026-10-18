import { useState, type TransitionEvent } from "react";

type Known = { scope: string; ids: ReadonlySet<string>; arrived: ReadonlySet<string> };

const none: ReadonlySet<string> = new Set();

// The ids that showed up after a scope's first load, so only what the user just added animates in, not a day
// opening or a refetch of what was already there. Set during render, so a new row mounts already marked.
// A mark clears once its fade has played, so a row that remounts later, like a card shown again, stays still.
export function useArrivals(ids: readonly string[], scope: string, ready: boolean) {
  const [known, setKnown] = useState<Known | null>(null);
  const current = known?.scope === scope ? known : null;

  if (ready && !current) setKnown({ scope, ids: new Set(ids), arrived: none });

  const fresh = ready && current ? ids.filter((id) => !current.ids.has(id)) : [];

  // React discards this render and runs again with the new state before anything reaches the page.
  if (current && fresh.length > 0) setKnown({ scope, ids: new Set([...current.ids, ...fresh]), arrived: new Set([...current.arrived, ...fresh]) });

  const arrived = current?.arrived ?? none;

  function settle(id: string, event: TransitionEvent<HTMLElement>) {
    if (event.target !== event.currentTarget || event.propertyName !== "opacity") return;

    setKnown((state) => {
      if (!state?.arrived.has(id)) return state;

      const next = new Set(state.arrived);

      next.delete(id);

      return { ...state, arrived: next };
    });
  }

  const onTransitionEnd = (id: string) => (event: TransitionEvent<HTMLElement>) => settle(id, event);

  return {
    // Rows that fade and rise in, from motion.css.
    rowProps: (id: string) => ({ "data-form-enter": arrived.has(id) ? "" : undefined, onTransitionEnd: onTransitionEnd(id) }),
    // Controls that settle into a new state, from motion.css.
    stateProps: (id: string) => ({ "data-state-enter": arrived.has(id) ? "" : undefined, onTransitionEnd: onTransitionEnd(id) }),
  };
}

export type Arrivals = ReturnType<typeof useArrivals>;
