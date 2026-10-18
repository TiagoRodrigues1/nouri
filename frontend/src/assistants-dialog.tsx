import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./components/ui/dialog";
import { disconnectAssistant, getAssistants, type Assistant } from "./lib/api";
import { styles as formStyles } from "./form-styles";
import { styles as overviewStyles } from "./overview-styles";
import { Stat } from "./overview/shared";
import { colors } from "./theme.stylex";

const styles = stylex.create({
  list: { display: "grid", gap: 12 },
  assistant: { display: "grid", gap: 12, padding: 16, borderWidth: 1, borderStyle: "solid", borderColor: colors.border, borderRadius: 12 },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 },
  name: { display: "flex", alignItems: "center", gap: 7, margin: 0, fontSize: 14, fontWeight: 600 },
});

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

const nameOf = (assistant: Assistant) => assistant.name ?? "Unnamed assistant";

type AssistantsDialogProps = { open: boolean; onOpenChange: (open: boolean) => void };

// The assistants, such as Claude or ChatGPT, that the person let in through the MCP connector, with Disconnect.
export function AssistantsDialog({ open, onOpenChange }: AssistantsDialogProps) {
  const client = useQueryClient();
  // An assistant connects from outside the page, so every opening reads the list afresh.
  const assistants = useQuery({ queryKey: ["assistants"], queryFn: getAssistants, enabled: open, staleTime: 0 });
  const [confirming, setConfirming] = useState<Assistant | null>(null);

  const disconnect = useMutation({
    mutationFn: (assistant: Assistant) => disconnectAssistant(assistant.clientId),
    onSuccess: (_result, assistant) => toast.success(`${nameOf(assistant)} disconnected. It has to ask you again before it can use Nouri.`),
    onError: (error) => toast.error(error.message),
    onSettled: async () => {
      setConfirming(null);
      await client.invalidateQueries({ queryKey: ["assistants"] });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle {...stylex.props(formStyles.dialogTitle)}>Assistants</DialogTitle>
        <DialogDescription {...stylex.props(formStyles.dialogDescription)}>
          Assistants you connect read and change your journal for you. Add <code>{window.location.origin}/mcp</code> as a custom connector in Claude or ChatGPT to connect one.
        </DialogDescription>
        {assistants.isError && <p role="alert" {...stylex.props(overviewStyles.alert)}>{assistants.error.message}</p>}
        {assistants.data?.length === 0 && <p {...stylex.props(overviewStyles.note)}>No assistant is connected.</p>}
        <div {...stylex.props(styles.list)}>
          {assistants.data?.map((assistant) => (
            <section key={assistant.clientId} {...stylex.props(styles.assistant)} aria-label={nameOf(assistant)}>
              <div {...stylex.props(styles.header)}>
                <h3 {...stylex.props(styles.name)}><Bot size={16} /> {nameOf(assistant)}</h3>
                <Button size="sm" variant="ghost" disabled={disconnect.isPending} onClick={() => setConfirming(assistant)}>
                  <Unplug size={15} /> Disconnect
                </Button>
              </div>
              <div {...stylex.props(overviewStyles.rows)}>
                <Stat label="Connected" value={when.format(new Date(assistant.connectedAt))} />
                <Stat label="Last used" value={when.format(new Date(assistant.lastUsedAt))} />
              </div>
            </section>
          ))}
        </div>
        <Dialog open={confirming !== null} onOpenChange={(next) => !next && setConfirming(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Disconnect {confirming && nameOf(confirming)}?</DialogTitle>
              <DialogDescription>
                It can no longer read or change your journal. What it already logged stays. To use it again, connect it from the assistant and approve it once more.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirming(null)}>Cancel</Button>
              <Button variant="destructive" disabled={disconnect.isPending} onClick={() => confirming && disconnect.mutate(confirming)}>
                {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
