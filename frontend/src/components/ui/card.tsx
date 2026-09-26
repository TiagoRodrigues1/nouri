import * as React from "react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import { colors } from "../../theme.stylex";

type DivProps = Omit<React.ComponentProps<"div">, "className" | "style"> & { sx?: StyleXStyles };

type HeadingProps = Omit<React.ComponentProps<"h3">, "className" | "style"> & { sx?: StyleXStyles };

const styles = stylex.create({
  card: { borderRadius: 12, borderWidth: 1, borderStyle: "solid", borderColor: colors.border, backgroundColor: colors.card, color: colors.foreground, boxShadow: "0 1px 2px #25343d08" },
  header: { display: "flex", flexDirection: "column", gap: 6, paddingTop: 24, paddingRight: 24, paddingBottom: 24, paddingLeft: 24 },
  title: { fontWeight: 600, lineHeight: 1, letterSpacing: "-0.025em" },
  content: { paddingTop: 0, paddingRight: 24, paddingBottom: 24, paddingLeft: 24 },
});

export function Card({ sx, ...props }: DivProps) {
  return <div data-slot="card" {...props} {...stylex.props(styles.card, sx)} />;
}

export function CardHeader({ sx, ...props }: DivProps) {
  return <div data-slot="card-header" {...props} {...stylex.props(styles.header, sx)} />;
}

export function CardTitle({ sx, ...props }: HeadingProps) {
  return <h3 data-slot="card-title" {...props} {...stylex.props(styles.title, sx)} />;
}

export function CardContent({ sx, ...props }: DivProps) {
  return <div data-slot="card-content" {...props} {...stylex.props(styles.content, sx)} />;
}
