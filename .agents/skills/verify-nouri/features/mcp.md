# MCP server

`/mcp` is the MCP server that Claude and ChatGPT add as a custom connector (`src/mcp/routes.ts`, tools in `src/mcp/tools.ts`). Every message is a POST answered with JSON; `GET` and `DELETE` return 405.

Without a token, `POST /mcp` with a JSON-RPC body such as `{"jsonrpc":"2.0","id":1,"method":"tools/list"}` returns 401 `{"error":"Unauthorized"}` and `WWW-Authenticate: Bearer resource_metadata="$NOURI_BASE_URL/.well-known/oauth-protected-resource/mcp"`. That metadata document (also served at `/.well-known/oauth-protected-resource`) names `resource` `$NOURI_BASE_URL/mcp`, the Clerk frontend origin as its only `authorization_servers` entry, `scopes_supported` `["profile", "email"]`, and `resource_name` `Nouri`. The web page's session token is not an MCP token: the same POST made from the signed-in page with `Authorization: Bearer <session token>` also returns 401. Check these with `curl` and one `run-code` fetch; keep the Clerk origin out of evidence if it should stay private.

The tools themselves are `verified-unreachable` on a default run. They need a Clerk OAuth access token, which needs an OAuth application with dynamic client registration in the Clerk dashboard and an MCP client that runs Clerk's consent page; this helper mints neither. `tests/integration/mcp.test.ts` and `tests/integration/mcp-journal.test.ts` cover the tools.
