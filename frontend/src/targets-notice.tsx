import * as stylex from "@stylexjs/stylex";
import { Button } from "./components/ui/button";
import type { TargetsState } from "./lib/use-targets";

// Stands in for the comparisons while targets are unavailable, so the logged values around it stay on screen.
export function TargetsNotice({ state, style }: { state: TargetsState; style: stylex.StyleXStyles }) {
  if (state.status === "ready") return null;

  if (state.status === "loading") return <p {...stylex.props(style)}>Loading your targets…</p>;

  return (
    <p {...stylex.props(style)} role="alert">
      Targets could not load: {state.message}{" "}
      <Button variant="outline" size="sm" onClick={state.retry}>Try again</Button>
    </p>
  );
}
