import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";

export type Theme = "light" | "dark";

// index.html reads the same key before first paint, so a dark page never flashes light.
const storageKey = "nouri.theme";

const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

const listeners = new Set<() => void>();

let latest: ViewTransition | undefined;

function stored(): Theme | null {
  const value = localStorage.getItem(storageKey);

  return value === "light" || value === "dark" ? value : null;
}

function current(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function apply(theme: Theme) {
  const root = document.documentElement;

  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", getComputedStyle(root).getPropertyValue("--background"));
  listeners.forEach((listener) => listener());
}

// Until someone picks a theme, the page follows the system's.
systemDark.addEventListener("change", (event) => {
  if (!stored()) apply(event.matches ? "dark" : "light");
});

export function useTheme(): Theme {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);

    return () => listeners.delete(listener);
  }, current);
}

// The new theme spreads out from the control that chose it, as a circle that covers the farthest corner.
export function setTheme(theme: Theme, origin: HTMLElement) {
  localStorage.setItem(storageKey, theme);

  if (!document.startViewTransition) {
    apply(theme);

    return;
  }

  const box = origin.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  const root = document.documentElement;

  root.style.setProperty("--theme-x", `${x}px`);
  root.style.setProperty("--theme-y", `${y}px`);
  root.style.setProperty("--theme-from", `${Math.min(box.width, box.height) / 2}px`);
  root.style.setProperty("--theme-to", `${Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))}px`);
  root.dataset.themeChanging = "";

  // A second toggle skips the first transition, which must not clear the marker the second one needs.
  const transition = document.startViewTransition(() => flushSync(() => apply(theme)));

  latest = transition;
  void transition.finished.finally(() => {
    if (latest === transition) delete root.dataset.themeChanging;
  });
}
