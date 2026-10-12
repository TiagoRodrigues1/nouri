import * as stylex from "@stylexjs/stylex";
import { colors } from "../theme.stylex";

const phone = "@media (max-width: 640px)";

export const styles = stylex.create({
  actions: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 },
  spacer: { flexGrow: 1 },
  danger: { color: colors.destructive },
  hint: { margin: 0, color: colors.mutedForeground, fontSize: 12 },
  section: { display: "grid", gap: 10, marginTop: 24 },
  sectionTitle: { margin: 0, color: colors.mutedForeground, fontSize: 11, fontWeight: 700, letterSpacing: ".06em" },

  // Routines
  routineName: {
    margin: 0,
    color: colors.foreground,
    fontSize: 16,
    fontWeight: 600,
    textDecoration: { default: "none", ":hover": "underline" },
  },
  routineTop: { display: "flex", alignItems: "start", justifyContent: "space-between", gap: 12 },
  routineText: { display: "grid", gap: 6, minWidth: 0 },
  routineMuscles: { display: "flex", flexShrink: 0, height: 64 },
  routineExercises: { margin: 0, color: colors.mutedForeground, fontSize: 12, lineHeight: 1.5 },

  // Resume
  resume: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 12px 10px 16px",
    borderRadius: 10,
    backgroundColor: colors.setDone,
    color: colors.foreground,
    fontSize: 13,
  },
  resumeShell: { marginBottom: 14 },
  resumeTitle: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 },
  resumeClock: { color: colors.mutedForeground, fontVariantNumeric: "tabular-nums" },
  pulse: { width: 8, height: 8, flexShrink: 0, borderRadius: 999, backgroundColor: colors.exercise },

  // Editor and session
  page: { display: "grid", gap: 14, maxWidth: 760 },
  exerciseCard: { display: "grid", gap: 10, padding: { default: 16, [phone]: 12 } },
  exerciseHeader: { display: "flex", alignItems: "center", gap: 10, minWidth: 0 },
  exerciseName: { flexGrow: 1, minWidth: 0, margin: 0, fontSize: 15, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" },
  exerciseDetail: { display: "block", color: colors.mutedForeground, fontSize: 12, fontWeight: 400 },
  table: { fontVariantNumeric: "tabular-nums" },
  narrow: { width: 44, paddingInline: 4, textAlign: "center" },
  previousCell: { paddingInline: 4 },
  inputCell: { width: { default: 96, [phone]: 72 }, paddingInline: 4 },
  numberInput: { height: 34, textAlign: "center", paddingInline: 4 },
  doneRow: { backgroundColor: { default: colors.setDone, ":hover": colors.setDone } },
  previous: { height: "auto", paddingInline: 6, color: colors.mutedForeground, fontWeight: 400 },
  setNumber: { fontWeight: 600, textAlign: "center" },

  // Session header
  stats: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 8,
    padding: "12px 16px",
    borderRadius: 10,
    backgroundColor: colors.muted,
  },
  stat: { display: "grid", gap: 2 },
  statLabel: { color: colors.mutedForeground, fontSize: 11 },
  statValue: { fontSize: { default: 18, [phone]: 16 }, fontWeight: 600, fontVariantNumeric: "tabular-nums" },
  statClock: { color: colors.primary },
  finishForm: { marginTop: 12 },
  durationField: { display: "grid", gap: 6 },
});
