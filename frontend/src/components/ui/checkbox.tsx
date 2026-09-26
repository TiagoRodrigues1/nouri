import * as React from "react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { colors } from "../../theme.stylex";

const styles = stylex.create({
  root: { display: "inline-grid", placeItems: "center", flexShrink: 0, width: 16, height: 16, padding: 0, borderWidth: 1, borderStyle: "solid", borderColor: colors.input, borderRadius: 3, backgroundColor: colors.background, color: colors.primaryForeground, cursor: "pointer", ":focus-visible": { outline: `2px solid ${colors.ring}` } },
  checked: { backgroundColor: colors.primary, borderColor: colors.primary },
});

export function Checkbox({ sx, checked, ...props }: Omit<React.ComponentProps<typeof CheckboxPrimitive.Root>, "className" | "style"> & { sx?: StyleXStyles }) {
  return (
    <CheckboxPrimitive.Root data-slot="checkbox" checked={checked} {...props} {...stylex.props(styles.root, checked === true && styles.checked, sx)}>
      <CheckboxPrimitive.Indicator><Check size={13} /></CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
