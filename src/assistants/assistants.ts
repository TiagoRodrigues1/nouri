import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { AppDatabase } from "../db/database.js";
import { assistantConnections } from "../db/schema.js";
import type { Agent, Agents } from "../identity/identity.js";
import type { AssistantList } from "./contract.js";

const connection = (userId: string, clientId: string) => and(eq(assistantConnections.userId, userId), eq(assistantConnections.clientId, clientId));

// Notes an assistant's call, and whether to answer it. Clerk cannot list a person's grants, so a disconnect waits
// for the client's next call: its token ends the grant at Clerk, and the row goes, so letting it in again starts
// afresh. Until Clerk confirms, every call is refused. Only a client with revocable tokens can be disconnected.
export async function admitAssistant(db: AppDatabase, agents: Pick<Agents, "agentName" | "revokeAgent">, userId: string, { clientId, revocable }: Pick<Agent, "clientId" | "revocable">, token: string): Promise<boolean> {
  const [row] = await db.select({ disconnectedAt: assistantConnections.disconnectedAt }).from(assistantConnections).where(connection(userId, clientId));

  if (row?.disconnectedAt) {
    const revoked = await agents.revokeAgent(clientId, token).then(() => true, () => false);

    if (revoked) await db.delete(assistantConnections).where(and(connection(userId, clientId), isNotNull(assistantConnections.disconnectedAt)));

    return false;
  }

  if (row) {
    await db.update(assistantConnections).set({ lastUsedAt: new Date(), revocable }).where(and(connection(userId, clientId), isNull(assistantConnections.disconnectedAt)));
  } else {
    await db.insert(assistantConnections).values({ userId, clientId, revocable, name: await agents.agentName(clientId) }).onConflictDoNothing();
  }

  return true;
}

// The assistants still let in, most recently used first.
export async function listAssistants(db: AppDatabase, userId: string): Promise<AssistantList> {
  const rows = await db.select().from(assistantConnections)
    .where(and(eq(assistantConnections.userId, userId), isNull(assistantConnections.disconnectedAt)))
    .orderBy(desc(assistantConnections.lastUsedAt), assistantConnections.clientId);

  return {
    assistants: rows.map((row) => ({ clientId: row.clientId, name: row.name, connectedAt: row.connectedAt.toISOString(), lastUsedAt: row.lastUsedAt.toISOString(), revocable: row.revocable })),
  };
}

// Refuses the assistant from now on. "missing" when it is not let in, so repeating it is safe. A client with JWT
// access tokens is never disconnected: its grant could not be ended, so it would be locked out for good.
export async function disconnectAssistant(db: AppDatabase, userId: string, clientId: string): Promise<"disconnected" | "missing" | "not-revocable"> {
  const [row] = await db.update(assistantConnections).set({ disconnectedAt: sql`CASE WHEN ${assistantConnections.revocable} THEN now() END` })
    .where(and(connection(userId, clientId), isNull(assistantConnections.disconnectedAt)))
    .returning({ revocable: assistantConnections.revocable });

  if (!row) return "missing";

  return row.revocable ? "disconnected" : "not-revocable";
}
