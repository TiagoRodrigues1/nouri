import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { Skeleton } from "./components/ui/skeleton";
import { colors } from "./theme.stylex";

const styles = stylex.create({
  size: (width: number | string, height: number | string) => ({ width, height, flexShrink: 0 }),
  round: { borderRadius: 999 },
  hidden: { position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)", whiteSpace: "nowrap" },
  list: { listStyle: "none", margin: 0, padding: 0, borderWidth: 1, borderStyle: "solid", borderColor: colors.border, borderRadius: 8 },
  listRow: { display: "flex", alignItems: "center", gap: 12, padding: "11px 12px" },
  listBorder: { borderTopWidth: 1, borderTopStyle: "solid", borderTopColor: colors.border },
  listText: { display: "grid", gap: 6, flexGrow: 1 },
});

// One placeholder shape. Widths given as a percentage stretch with the layout; numbers are pixels.
export function Bone({ width, height, round = false }: { width: number | string; height: number | string; round?: boolean }) {
  return <Skeleton {...stylex.props(styles.size(width, height), round && styles.round)} />;
}

// Stands in for content while it loads. Screen readers hear the label once; the shapes are hidden from them.
export function Loading({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="status" aria-live="polite">
      <span {...stylex.props(styles.hidden)}>{label}</span>
      <div aria-hidden>{children}</div>
    </div>
  );
}

// Rows of a picker list, a name over a detail line, at varied widths so they read as text.
export function ListSkeleton({ label, rows = 4 }: { label: string; rows?: number }) {
  const widths = ["58%", "42%", "66%", "50%", "38%", "62%"];

  return (
    <Loading label={label}>
      <ul {...stylex.props(styles.list)}>
        {Array.from({ length: rows }, (_, index) => (
          <li key={index} {...stylex.props(styles.listRow, index > 0 && styles.listBorder)}>
            <span {...stylex.props(styles.listText)}>
              <Bone width={widths[index % widths.length] ?? "50%"} height={13} />
              <Bone width="34%" height={10} />
            </span>
            <Bone width={16} height={16} />
          </li>
        ))}
      </ul>
    </Loading>
  );
}
