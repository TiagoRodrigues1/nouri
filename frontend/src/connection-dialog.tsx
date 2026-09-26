import * as stylex from "@stylexjs/stylex";
import { styles } from "./form-styles";
import { useState, type FormEvent } from "react";
import { LogOut } from "lucide-react";
import { Button } from "./components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./components/ui/dialog";
import { Input } from "./components/ui/input";

type ConnectionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string;
  onConnect: (token: string) => Promise<void>;
  onDisconnect: () => void;
};

export function ConnectionDialog({ open, onOpenChange, token, onConnect, onDisconnect }: ConnectionDialogProps) {
  const [tokenDraft, setTokenDraft] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [connecting, setConnecting] = useState(false);

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = tokenDraft.trim();

    if (!next) return;

    setConnecting(true);
    setConnectionError("");

    try {
      await onConnect(next);
      setTokenDraft("");
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : "Could not connect.");
    } finally {
      setConnecting(false);
    }
  }

  return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle {...stylex.props(styles.dialogTitle)}>Connect your food log</DialogTitle>
          <DialogDescription {...stylex.props(styles.dialogDescription)}>
            Use the API token configured for this Nouri server. The token stays
            in this browser tab.
          </DialogDescription>
          <form onSubmit={connect} {...stylex.props(styles.formStack)}>
            <label {...stylex.props(styles.formLabel)} htmlFor="api-token">API token</label>
            <Input
              id="api-token"
              type="password"
              autoComplete="off"
              value={tokenDraft}
              onChange={(event) => setTokenDraft(event.target.value)}
              required
              placeholder="Paste your API token"
            />
            {connectionError && (
              <p {...stylex.props(styles.connectionError)} role="alert">
                {connectionError}
              </p>
            )}
            <div {...stylex.props(styles.dialogActions)}>
              {token && (
                <Button type="button" variant="ghost" onClick={onDisconnect}>
                  <LogOut size={16} /> Disconnect
                </Button>
              )}
              <Button type="submit" disabled={connecting}>
                {connecting
                  ? "Connecting…"
                  : token
                    ? "Update token"
                    : "Connect"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
  );
}
