import * as React from "react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import * as LabelPrimitive from "@radix-ui/react-label";

const styles = stylex.create({
  label: { display: "block", fontSize: 12, fontWeight: 700, marginBottom: 7, userSelect: "none" },
});

export function Label({ sx, ...props }: Omit<React.ComponentProps<typeof LabelPrimitive.Root>, "className" | "style"> & { sx?: StyleXStyles }) {
  return <LabelPrimitive.Root data-slot="label" {...props} {...stylex.props(styles.label, sx)} />;
}
