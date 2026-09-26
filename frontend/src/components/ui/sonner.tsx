import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { colors } from "../../theme.stylex";

declare module "react" {
  interface CSSProperties {
    "--normal-bg"?: string;
    "--normal-text"?: string;
    "--normal-border"?: string;
  }
}

const themeVars: CSSProperties = {
  "--normal-bg": String(colors.card),
  "--normal-text": String(colors.foreground),
  "--normal-border": String(colors.border),
};

export function Toaster(props: ToasterProps) {
  return <Sonner position="top-center" style={themeVars} {...props} />;
}
