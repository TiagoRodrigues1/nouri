import * as React from "react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import { Slot } from "@radix-ui/react-slot";
import { colors } from "../../theme.stylex";

type ButtonProps = Omit<React.ComponentProps<"button">, "className" | "style"> & {
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "icon";
  asChild?: boolean;
  sx?: StyleXStyles;
};

const styles = stylex.create({
  base: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    whiteSpace: "nowrap",
    borderRadius: 6,
    fontSize: 14,
    fontWeight: 500,
    transition: "color 150ms, background-color 150ms, border-color 150ms",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${colors.ring}` },
    opacity: { default: 1, ":disabled": 0.5 },
    pointerEvents: { default: "auto", ":disabled": "none" },
  },
  default: {
    backgroundColor: { default: colors.primary, ":hover": colors.primaryHover },
    color: colors.primaryForeground,
    borderWidth: 0,
  },
  outline: {
    borderWidth: 1, borderStyle: "solid", borderColor: colors.input,
    backgroundColor: { default: colors.background, ":hover": colors.accent },
    color: { default: colors.foreground, ":hover": colors.accentForeground },
  },
  ghost: {
    borderWidth: 0,
    backgroundColor: { default: "transparent", ":hover": colors.accent },
    color: { default: colors.foreground, ":hover": colors.accentForeground },
  },
  defaultSize: { height: 40, paddingBlock: 8, paddingInline: 16 },
  smallSize: { height: 36, paddingInline: 12 },
  iconSize: { width: 40, height: 40, padding: 0 },
});

export function Button({ variant = "default", size = "default", asChild = false, sx, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  const sizeStyle = size === "sm" ? styles.smallSize : size === "icon" ? styles.iconSize : styles.defaultSize;

  return <Comp data-slot="button" {...props} {...stylex.props(styles.base, styles[variant], sizeStyle, sx)} />;
}
