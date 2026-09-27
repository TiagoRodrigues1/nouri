import { useRef, useState, type TransitionEvent } from "react";

// Longer than the exit fade in motion.css, so a row still leaves if its transition never runs.
const exitFallbackMs = 250;

function without(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set);

  next.delete(id);

  return next;
}

// Rows added fade in, and rows removed fade out before they leave the list.
export function useExitingRows() {
  const [exiting, setExiting] = useState<ReadonlySet<string>>(() => new Set());
  const [entering, setEntering] = useState<ReadonlySet<string>>(() => new Set());
  const onRemoved = useRef(new Map<string, () => void>());

  function add(id: string) {
    setEntering((current) => new Set(current).add(id));
  }

  function finish(id: string) {
    const callback = onRemoved.current.get(id);

    if (!callback) return;

    onRemoved.current.delete(id);
    callback();
    setExiting((current) => without(current, id));
  }

  function remove(id: string, removed: () => void) {
    if (onRemoved.current.has(id)) return;

    onRemoved.current.set(id, removed);
    setEntering((current) => without(current, id));
    setExiting((current) => new Set(current).add(id));
    window.setTimeout(() => finish(id), exitFallbackMs);
  }

  function transitionEnd(id: string, event: TransitionEvent<HTMLElement>) {
    if (event.target !== event.currentTarget || event.propertyName !== "opacity") return;

    if (onRemoved.current.has(id)) finish(id);
    else setEntering((current) => without(current, id));
  }

  function rowProps(id: string) {
    return {
      "data-form-enter": entering.has(id) ? "" : undefined,
      "data-exiting": exiting.has(id) ? "true" : undefined,
      onTransitionEnd: (event: TransitionEvent<HTMLElement>) => transitionEnd(id, event),
    };
  }

  return { add, remove, rowProps, busy: exiting.size > 0 };
}
