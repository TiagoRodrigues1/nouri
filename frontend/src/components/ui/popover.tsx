import * as React from "react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { colors } from "../../theme.stylex";

export const Popover = PopoverPrimitive.Root;

export const PopoverTrigger = PopoverPrimitive.Trigger;

const styles = stylex.create({
  content: { zIndex: 60, borderRadius: 8, borderWidth: 1, borderStyle: "solid", borderColor: colors.border, backgroundColor: colors.card, color: colors.foreground, padding: 4, boxShadow: "0 10px 20px #0000001a", outline: "none" },
});

export function PopoverContent({ sx, align = "start", sideOffset = 4, ...props }: Omit<React.ComponentProps<typeof PopoverPrimitive.Content>, "className" | "style"> & { sx?: StyleXStyles }) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content align={align} sideOffset={sideOffset} {...props} {...stylex.props(styles.content, sx)} data-slot="time-popover" />
    </PopoverPrimitive.Portal>
  );
}
