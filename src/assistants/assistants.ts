import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { AppDatabase } from "../db/database.js";
import { assistantConnections } from "../db/schema.js";
import type { Agents } from "../identity/identity.js";
import type { AssistantList } from "./contract.js";

const connection = (userId: string, clientId: string) => and(eq(assistantConnections.userId, userId), eq(assistantConnections.clientId, clientId));

// Notes an assistant's call, and whether to answer it. Clerk cannot list a person's grants, so a disconnect waits
// for the client's next call: its token ends the grant at Clerk, and the row goes, so letting it in again starts
// afresh. Until Clerk confirms, every call is refused.
export async function admitAssistant(db: AppDatabase, agents: Pick<Agents, "agentName" | "revokeAgent">, userId: string, clientId: string, token: string): Promise<boolean> {
  const [row] = await db.select({ disconnectedAt: assistantConnections.disconnectedAt }).from(assistantConnections).where(connection(userId, clientId));

  if (row?.disconnectedAt) {
    const revoked = await agents.revokeAgent(clientId, token).then(() => true, () => false);

    if (revoked) await db.delete(assistantConnections).where(and(connection(userId, clientId), isNotNull(assistantConnections.disconnectedAt)));

    return false;
  }

  if (row) {
    await db.update(assistantConnections).set({ lastUsedAt: new Date() }).where(and(connection(userId, clientId), isNull(assistantConnections.disconnectedAt)));
  } else {
    await db.insert(assistantConnections).values({ userId, clientId, name: await agents.agentName(clientId) }).onConflictDoNothing();
  }

  return true;
}

// The assistants still let in, most recently used first.
export async function listAssistants(db: AppDatabase, userId: string): Promise<AssistantList> {
  const rows = await db.select().from(assistantConnections)
    .where(and(eq(assistantConnections.userId, userId), isNull(assistantConnections.disconnectedAt)))
    .orderBy(desc(assistantConnections.lastUsedAt), assistantConnections.clientId);

  return {
    assistants: rows.map((row) => ({ clientId: row.clientId, name: row.name, connectedAt: row.connectedAt.toISOString(), lastUsedAt: row.lastUsedAt.toISOString() })),
  };
}

// Refuses the assistant from now on. False when it is not let in, so repeating it is safe.
export async function disconnectAssistant(db: AppDatabase, userId: string, clientId: string): Promise<boolean> {
  const rows = await db.update(assistantConnections).set({ disconnectedAt: new Date() })
    .where(and(connection(userId, clientId), isNull(assistantConnections.disconnectedAt)))
    .returning({ clientId: assistantConnections.clientId });

  return rows.length > 0;
}
