# Connected assistants

The `Assistants` button in the sidebar's SETTINGS group, or `Assistants` under the command palette's settings, opens a dialog listing the MCP clients (Claude, ChatGPT) the person let in through Clerk's consent page (`frontend/src/assistants-dialog.tsx`, `src/assistants/assistants.ts`). Its description shows `$NOURI_BASE_URL/mcp`, the connector URL to add in the assistant.

A default run has no OAuth client (see [mcp.md](mcp.md)), so an assistant never connects for real. Entry points:

1. **Empty state.** Open the dialog on a fresh run. It reads `No assistant is connected.`
2. **Listed assistants.** Nouri notes a client on its first `/mcp` call. To stand in for that call, insert rows into the run's own database container, then open the dialog (it reads the list afresh on every opening):

   ```sh
   docker exec "nouri-verify-$RUN_ID" psql -qU nouri -d nouri -c "INSERT INTO assistant_connections (user_id, client_id, name) SELECT id, 'client_claude', 'Claude' FROM users; INSERT INTO assistant_connections (user_id, client_id, name) SELECT id, 'client_gpt', NULL FROM users;"
   ```

   Each assistant is a `region` named after it (`Unnamed assistant` when Clerk had no name), with `Connected` and `Last used` rows and a `Disconnect` button, most recently used first.
3. **Disconnect.** `Disconnect` in a region opens `Disconnect <name>?`; its `Disconnect` button removes the region and toasts `<name> disconnected. It has to ask you again before it can use Nouri.` Read back `GET /v1/assistants`: the assistant is gone. In the database its row keeps a `disconnected_at`, because Clerk's grant ends only on the client's next call; `tests/integration/mcp-settings.test.ts` covers that call being refused and the grant revoked.
