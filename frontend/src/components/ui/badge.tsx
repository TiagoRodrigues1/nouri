import * as React from "react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import { colors } from "../../theme.stylex";

const styles = stylex.create({
  base: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    height: 22,
    paddingInline: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderStyle: "solid",
    fontSize: 11,
    fontWeight: 600,
    whiteSpace: "nowrap",
  },
  default: { borderColor: "transparent", backgroundColor: colors.primary, color: colors.primaryForeground },
  secondary: { borderColor: "transparent", backgroundColor: colors.muted, color: colors.foreground },
  outline: { borderColor: colors.border, backgroundColor: "transparent", color: colors.mutedForeground },
});

type BadgeProps = Omit<React.ComponentProps<"span">, "className" | "style"> & { variant?: "default" | "secondary" | "outline"; sx?: StyleXStyles };

export function Badge({ variant = "default", sx, ...props }: BadgeProps) {
  return <span data-slot="badge" {...props} {...stylex.props(styles.base, styles[variant], sx)} />;
}
