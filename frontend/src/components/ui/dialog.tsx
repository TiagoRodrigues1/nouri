import * as React from "react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { colors } from "../../theme.stylex";

export const Dialog = DialogPrimitive.Root;

export const DialogTrigger = DialogPrimitive.Trigger;

export const DialogTitle = DialogPrimitive.Title;

export const DialogDescription = DialogPrimitive.Description;

const styles = stylex.create({
  overlay: { position: "fixed", inset: 0, zIndex: 50, backgroundColor: "#00000073" },
  content: { position: "fixed", left: "50%", top: "50%", zIndex: 50, maxHeight: "90vh", width: "min(94vw, 560px)", transform: "translate(-50%, -50%)", overflowY: "auto", borderRadius: 12, borderWidth: 1, borderStyle: "solid", borderColor: colors.border, backgroundColor: colors.card, color: colors.foreground, padding: 24, boxShadow: "0 20px 25px #00000020" },
  close: { position: "absolute", right: 16, top: 16, borderRadius: 6, padding: 4, borderWidth: 0, backgroundColor: { default: "transparent", ":hover": colors.muted }, color: colors.mutedForeground, cursor: "pointer" },
});

export function DialogContent({ sx, children, ...props }: Omit<React.ComponentProps<typeof DialogPrimitive.Content>, "className" | "style"> & { sx?: StyleXStyles }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay data-slot="dialog-overlay" {...stylex.props(styles.overlay)} />
      <DialogPrimitive.Content {...props} {...stylex.props(styles.content, sx)} data-slot="dialog-content">
        {children}
        <DialogPrimitive.Close {...stylex.props(styles.close)} aria-label="Close"><X size={18} /></DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
