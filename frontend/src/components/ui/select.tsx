import * as React from "react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { colors } from "../../theme.stylex";

export const Select = SelectPrimitive.Root;

export const SelectValue = SelectPrimitive.Value;

const styles = stylex.create({
  trigger: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    width: "100%",
    height: 40,
    borderRadius: 6,
    borderWidth: 1, borderStyle: "solid", borderColor: colors.input,
    backgroundColor: colors.background,
    paddingInline: 12,
    fontSize: 14,
    color: colors.foreground,
    boxShadow: "0 1px 2px #25343d08",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${colors.ring}` },
    opacity: { default: 1, ":disabled": 0.5 },
  },
  icon: { color: colors.mutedForeground, flexShrink: 0 },
  // Above the dialog overlay, since selects open inside dialogs.
  content: {
    zIndex: 60,
    minWidth: "var(--radix-select-trigger-width)",
    maxHeight: "var(--radix-select-content-available-height)",
    overflow: "hidden",
    borderRadius: 8,
    borderWidth: 1, borderStyle: "solid", borderColor: colors.border,
    backgroundColor: colors.card,
    color: colors.foreground,
    boxShadow: "0 10px 20px #0000001a",
  },
  viewport: { padding: 4 },
  item: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    height: 32,
    paddingLeft: 30,
    paddingRight: 10,
    borderRadius: 4,
    fontSize: 14,
    cursor: "pointer",
    userSelect: "none",
    outline: "none",
    backgroundColor: { default: "transparent", ":is([data-highlighted])": colors.accent },
    color: { default: colors.foreground, ":is([data-highlighted])": colors.accentForeground },
  },
  indicator: { position: "absolute", left: 8, display: "inline-flex", color: colors.primary },
});

export function SelectTrigger({ sx, children, ...props }: Omit<React.ComponentProps<typeof SelectPrimitive.Trigger>, "className" | "style"> & { sx?: StyleXStyles }) {
  return (
    <SelectPrimitive.Trigger data-slot="select-trigger" {...props} {...stylex.props(styles.trigger, sx)}>
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown size={16} {...stylex.props(styles.icon)} />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({ sx, children, position = "popper", sideOffset = 4, ...props }: Omit<React.ComponentProps<typeof SelectPrimitive.Content>, "className" | "style"> & { sx?: StyleXStyles }) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content data-slot="select-content" position={position} sideOffset={sideOffset} {...props} {...stylex.props(styles.content, sx)}>
        <SelectPrimitive.Viewport {...stylex.props(styles.viewport)}>{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({ sx, children, ...props }: Omit<React.ComponentProps<typeof SelectPrimitive.Item>, "className" | "style"> & { sx?: StyleXStyles }) {
  return (
    <SelectPrimitive.Item data-slot="select-item" {...props} {...stylex.props(styles.item, sx)}>
      <span {...stylex.props(styles.indicator)}>
        <SelectPrimitive.ItemIndicator>
          <Check size={14} />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}
