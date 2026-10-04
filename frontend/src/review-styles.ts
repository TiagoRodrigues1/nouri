import * as stylex from "@stylexjs/stylex";
import { colors } from "./theme.stylex";

export const styles = stylex.create({
  page: { display: "grid", gap: 14, marginTop: 20 },
  summary: { margin: 0, color: colors.mutedForeground, fontSize: 13 },
  card: { paddingTop: 4, paddingRight: 8, paddingBottom: 4, paddingLeft: 8, gap: 0 },
  dayColumn: { textAlign: "left", fontWeight: 600, color: colors.foreground },
  number: { textAlign: "right", fontVariantNumeric: "tabular-nums" },
  unit: { marginLeft: 4, color: colors.mutedForeground, fontSize: 12 },
  muted: { color: colors.mutedForeground, fontSize: 12 },
  difference: { display: "block", color: colors.mutedForeground, fontSize: 11 },
  comparisons: {
    display: "grid",
    gap: 14,
    gridTemplateColumns: { default: "repeat(2, minmax(0, 1fr))", "@media (max-width: 620px)": "minmax(0, 1fr)" },
  },
  comparisonHeader: { paddingTop: 14, paddingRight: 16, paddingBottom: 8, paddingLeft: 16 },
  comparisonTitle: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600 },
  comparisonContent: { display: "grid", gap: 4, paddingTop: 0, paddingRight: 16, paddingBottom: 14, paddingLeft: 16 },
  comparisonValue: { margin: 0, fontSize: 22, fontWeight: 600, fontVariantNumeric: "tabular-nums" },
  links: { display: "inline-flex", gap: 2 },
  hidden: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
  },
  status: {
    margin: "24px 0 0",
    padding: "28px 20px",
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    color: colors.mutedForeground,
    fontSize: 13,
    textAlign: "center",
  },
});
