import { useEffect, useState, useSyncExternalStore } from "react";

// The width below which the styles switch to the phone layout.
const phoneQuery = window.matchMedia("(max-width: 680px)");

function subscribe(onChange: () => void) {
  phoneQuery.addEventListener("change", onChange);

  return () => phoneQuery.removeEventListener("change", onChange);
}

export function usePhone(): boolean {
  return useSyncExternalStore(subscribe, () => phoneQuery.matches);
}

// How much of the layout viewport the on-screen keyboard covers, so a sheet fixed to the bottom can sit above it.
// Browsers that resize the page for the keyboard report 0.
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const viewport = window.visualViewport;

    if (!viewport) return;
    const update = () => setInset(Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)));

    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);

    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
}
