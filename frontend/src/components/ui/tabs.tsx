import * as React from "react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { colors } from "../../theme.stylex";

export const Tabs = TabsPrimitive.Root;

const styles = stylex.create({
  list: { display: "inline-flex", height: 40, alignItems: "center", borderRadius: 8, backgroundColor: colors.muted, padding: 4, color: colors.mutedForeground },
  trigger: {
    display: "inline-flex", height: 32, alignItems: "center", justifyContent: "center", borderRadius: 6, paddingInline: 12, borderWidth: 0, backgroundColor: { default: "transparent", ":is([data-state=active])": colors.background }, color: colors.foreground, fontSize: 14, fontWeight: 500,
  },
  content: { marginTop: 20 },
});

export function TabsList({ sx, ...props }: Omit<React.ComponentProps<typeof TabsPrimitive.List>, "className" | "style"> & { sx?: StyleXStyles }) {
  return <TabsPrimitive.List {...props} {...stylex.props(styles.list, sx)} />;
}

export function TabsTrigger({ sx, ...props }: Omit<React.ComponentProps<typeof TabsPrimitive.Trigger>, "className" | "style"> & { sx?: StyleXStyles }) {
  return <TabsPrimitive.Trigger {...props} {...stylex.props(styles.trigger, sx)} />;
}

export function TabsContent({ sx, ...props }: Omit<React.ComponentProps<typeof TabsPrimitive.Content>, "className" | "style"> & { sx?: StyleXStyles }) {
  return <TabsPrimitive.Content {...props} {...stylex.props(styles.content, sx)} />;
}
