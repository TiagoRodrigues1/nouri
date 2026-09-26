import * as React from "react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import * as ProgressPrimitive from "@radix-ui/react-progress";
import { colors } from "../../theme.stylex";

const styles = stylex.create({
  root: { position: "relative", width: "100%", height: 8, overflow: "hidden", borderRadius: 999, backgroundColor: colors.muted },
  // Width rather than a transform, so an empty bar shows no antialiased sliver at the rounded edge.
  indicator: (color: string, share: number) => ({
    width: `${share}%`,
    height: "100%",
    borderRadius: 999,
    backgroundColor: color,
    transition: { default: "width 400ms ease", "@media (prefers-reduced-motion: reduce)": "none" },
  }),
});

type ProgressProps = Omit<React.ComponentProps<typeof ProgressPrimitive.Root>, "className" | "style" | "value" | "max"> & {
  value: number;
  max: number;
  color?: string;
  sx?: StyleXStyles;
};

// Values past the target stay in the accessible value but the bar stops at full.
export function Progress({ value, max, color = colors.primary, sx, ...props }: ProgressProps) {
  const share = Math.min(Math.max(value / max, 0), 1) * 100;

  return (
    <ProgressPrimitive.Root data-slot="progress" value={Math.min(value, max)} max={max} {...props} {...stylex.props(styles.root, sx)}>
      <ProgressPrimitive.Indicator {...stylex.props(styles.indicator(color, share))} />
    </ProgressPrimitive.Root>
  );
}
