import * as React from "react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import { colors } from "../../theme.stylex";

const styles = stylex.create({
  input: {
    display: "flex",
    width: "100%",
    height: 40,
    borderRadius: 6,
    borderWidth: 1, borderStyle: "solid", borderColor: colors.input,
    backgroundColor: colors.background,
    paddingBlock: 8,
    paddingInline: 12,
    fontSize: 14,
    color: colors.foreground,
    boxShadow: "0 1px 2px #25343d08",
    outline: { default: "none", ":focus-visible": `2px solid ${colors.ring}` },
    opacity: { default: 1, ":disabled": 0.5 },
    cursor: { default: "auto", ":disabled": "not-allowed" },
    "::placeholder": { color: colors.mutedForeground },
  },
});

export function Input({ type = "text", sx, ...props }: Omit<React.ComponentProps<"input">, "className" | "style"> & { sx?: StyleXStyles }) {
  return <input data-slot="input" type={type} {...props} {...stylex.props(styles.input, sx)} />;
}
