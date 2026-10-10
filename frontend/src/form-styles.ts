import * as stylex from "@stylexjs/stylex";
import { colors } from "./theme.stylex";

export const styles = stylex.create({
  dialogDescription: {
    color: colors.mutedForeground,
    fontSize: "13px",
    lineHeight: "1.5",
    margin: "9px 0 22px",
  },
  dialogActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "7px",
    marginTop: "9px",
  },
  connectionError: {
    margin: "0",
    color: colors.destructive,
    fontSize: "12px",
  },
  fieldHint: {
    color: colors.mutedForeground,
    fontSize: "11px",
    margin: "9px 0 13px",
  },
  searchMessage: {
    minHeight: "85px",
    display: "grid",
    placeItems: "center",
    textAlign: "center",
    color: colors.mutedForeground,
    fontSize: "12px",
  },
  resultsList: {
    listStyle: "none",
    padding: "0",
    margin: "8px 0",
    maxHeight: "240px",
    overflowY: "auto",
    borderWidth: 1, borderStyle: "solid", borderColor: colors.border,
    borderRadius: "8px",
  },
  selectedForm: {
    display: "grid",
    gap: "8px",
    margin: "14px 0",
    padding: "14px",
    borderRadius: "8px",
    backgroundColor: colors.muted,
  },
  sourceLink: {
    color: colors.primary,
    fontSize: "11px",
    textDecoration: "underline",
  },
  formSubhead: {
    color: colors.mutedForeground,
    fontSize: "10px",
    fontWeight: "800",
    letterSpacing: ".13em",
    margin: "8px 0 0",
  },
  manualGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px",
  },
  dialogTitle: {
    fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 28, fontWeight: 400,
    paddingRight: "28px",
  },
  timeField: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    marginBottom: "16px",
  },
  timeLabel: {
    marginBottom: "0",
  },
  formStack: {
    display: "grid",
    gap: "12px",
  },
  selectTrigger: {
    width: "100%",
  },
  formLabel: {
    display: "block",
    fontSize: "12px",
    fontWeight: "700",
    marginBottom: "7px",
  },
  searchFormRow: {
    display: "flex",
    flexWrap: { default: "nowrap", "@media (max-width: 520px)": "wrap" },
    gap: "8px",
  },
  // On phones the query gets its own line and the buttons share the next one.
  searchFormInput: { flexBasis: { default: "auto", "@media (max-width: 520px)": "100%" } },
  searchFormButton: { flex: { default: "none", "@media (max-width: 520px)": "1" } },
  resultsItemBorder: {
    borderTopWidth: 1, borderTopStyle: "solid", borderTopColor: colors.border,
  },
  resultsButton: {
    width: "100%",
    padding: "11px 13px",
    backgroundColor: { default: "transparent", ":hover": colors.accent },
    borderWidth: 0,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "8px",
    textAlign: "left",
  },
  resultsText: {
    display: "block",
  },
  resultsName: {
    fontSize: "12px",
  },
  resultsMeta: {
    marginTop: "4px",
    color: colors.mutedForeground,
    fontSize: "11px",
  },
  selectedName: {
    fontSize: "13px",
  },
  selectedLabel: {
    margin: "0",
  },
  selectedButton: {
    justifySelf: "end",
  },
  manualSubmit: {
    marginTop: "8px",
  },
  widthFull: { width: "100%" },
  flexOne: { flex: 1 },
  // Four tabs share a phone-width dialog, so they tighten up below 520px.
  compactTab: {
    minWidth: 0,
    paddingInline: { default: null, "@media (max-width: 520px)": 4 },
    fontSize: { default: null, "@media (max-width: 520px)": 12.5 },
  },
  resultsButtonSelected: { backgroundColor: colors.accent },
  mealRows: {
    listStyle: "none",
    padding: "0",
    margin: "0",
    maxHeight: "300px",
    overflowY: "auto",
    borderWidth: 1, borderStyle: "solid", borderColor: colors.border,
    borderRadius: "8px",
  },
  mealRow: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr) auto",
    alignItems: "center",
    gap: "11px",
    padding: "9px 12px",
  },
  mealRowExcluded: { opacity: 0.55 },
  mealRowText: { minWidth: 0, cursor: "pointer" },
  mealAmount: { display: "flex", alignItems: "center", gap: "6px", width: "142px" },
  mealUnit: { width: "52px", color: colors.mutedForeground, fontSize: "11px" },
  mealSummary: {
    display: "flex",
    justifyContent: "space-between",
    margin: "0",
    color: colors.mutedForeground,
    fontSize: "12px",
    fontVariantNumeric: "tabular-nums",
  },
  mealList: {
    listStyle: "none",
    padding: "0",
    margin: "0",
    borderWidth: 1, borderStyle: "solid", borderColor: colors.border,
    borderRadius: "8px",
  },
  manageLink: {
    justifySelf: "center",
    color: colors.primary,
    fontSize: "13px",
    fontWeight: "600",
    textDecoration: { default: "none", ":hover": "underline" },
  },
});
