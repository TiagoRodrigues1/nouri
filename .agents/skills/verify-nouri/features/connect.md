# Connection state

Open `/`. The server embeds the run token in the page, so the `Personal space` status reads `Connected` and the day's entries load without a dialog. Reload and check that both remain.

The sidebar has no connection control. The connection dialog opens when a log action runs without a token, but the default launch starts with a token and the page has no route to disconnect. Rejected-token and disconnect actions are therefore unreachable through the page in this run. Record the missing disconnected-state prerequisite; do not set browser storage to create it. Never print or save the real token in snapshots or command output.
