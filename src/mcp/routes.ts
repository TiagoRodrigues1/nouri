import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { admitAssistant } from "../assistants/assistants.js";
import type { AppDatabase } from "../db/database.js";
import { error } from "../http-error.js";
import { clerkFrontendOrigin, userFor, type Identity } from "../identity/identity.js";
import { nouriMcpServer } from "./tools.js";

// Claude and ChatGPT find Clerk through the protected resource metadata (RFC 9728), register with it, and send
// the OAuth access token it issues. publicUrl is the origin they reach, when a proxy hides it from the request.
export function mcpRoutes(db: AppDatabase, identity: Identity, limitUser: (userId: string, method: string, path: string) => Response | null, publicUrl?: string) {
  const app = new Hono();
  const authorizationServer = clerkFrontendOrigin(identity.publishableKey);
  const originOf = (request: Request) => publicUrl ?? new URL(request.url).origin;
  const metadataPath = "/.well-known/oauth-protected-resource/mcp";

  for (const path of [metadataPath, "/.well-known/oauth-protected-resource"]) {
    app.get(path, (context) => context.json({
      resource: `${originOf(context.req.raw)}/mcp`,
      authorization_servers: [authorizationServer],
      scopes_supported: ["profile", "email"],
      bearer_methods_supported: ["header"],
      resource_name: "Nouri",
    }));
  }

  // Stateless: every message is a POST answered with JSON, so there is no event stream to open or session to end.
  app.on(["GET", "DELETE"], "/mcp", () => new Response(null, { status: 405, headers: { Allow: "POST" } }));

  app.post("/mcp", async (context) => {
    const agent = await identity.authenticateAgent(context.req.raw);

    if (agent) {
      const refused = limitUser(agent.clerkUserId, "POST", "/mcp");

      if (refused) return refused;
    }

    const userId = agent && await userFor(db, agent.clerkUserId);
    // A client the person disconnected from Nouri's page is refused like a bad token, so it asks them again.
    const token = context.req.header("Authorization")?.slice("Bearer ".length) ?? "";
    const admitted = agent && userId && await admitAssistant(db, identity, userId, agent.clientId, token);

    if (!userId || !admitted) {
      const response = error(401, "Unauthorized");

      response.headers.set("WWW-Authenticate", `Bearer resource_metadata="${originOf(context.req.raw)}${metadataPath}"`);

      return response;
    }

    const parsedBody: unknown = await context.req.json().catch(() => null);

    // One request allowance must mean one message, not a batch of concurrent tool calls.
    if (Array.isArray(parsedBody)) return error(400, "Send one MCP message per request");

    const server = nouriMcpServer(db, userId);
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });

    await server.connect(transport);

    try {
      return await transport.handleRequest(context.req.raw, { parsedBody });
    } finally {
      await server.close();
    }
  });

  return app;
}
