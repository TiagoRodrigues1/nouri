import { createHash } from "node:crypto";
import type { AppDatabase } from "../db/database.js";
import { userFor, type Identity } from "./identity.js";

const agentTokenLifetimeMs = 60_000;

// Who is calling, as cheaply as it can be known. Session tokens verify locally; MCP tokens are opaque and need
// Clerk's API, so a verified one is remembered briefly and repeat messages from an agent are identified locally too.
export function accountAccess(db: AppDatabase, identity: Identity, now = Date.now) {
  const agents = new Map<string, { clerkUserId: string; expiresAt: number }>();
  // A Clerk user's Nouri id never changes, so each is looked up once rather than on every request.
  const userIds = new Map<string, string>();

  const tokenHash = (request: Request) => createHash("sha256").update(request.headers.get("Authorization") ?? "").digest("base64url");

  function rememberedAgent(request: Request): string | null {
    const key = tokenHash(request);
    const found = agents.get(key);

    if (!found) return null;

    if (found.expiresAt > now()) return found.clerkUserId;
    agents.delete(key);

    return null;
  }

  return {
    // Never reaches Clerk's API: a null here may still be a valid MCP token, which verifyAgent settles.
    async identify(request: Request): Promise<string | null> {
      const { pathname } = new URL(request.url);

      if (pathname.startsWith("/v1/")) return identity.authenticate(request);

      if (pathname === "/mcp" && request.headers.has("Authorization")) return rememberedAgent(request);

      return null;
    },

    // A revoked token keeps working until its minute is up, in exchange for one Clerk check a minute per agent.
    async verifyAgent(request: Request): Promise<string | null> {
      const clerkUserId = await identity.authenticateAgent(request);

      if (!clerkUserId) return null;

      // Bounds memory; clearing only costs each agent one more Clerk check.
      if (agents.size >= 1000) agents.clear();
      agents.set(tokenHash(request), { clerkUserId, expiresAt: now() + agentTokenLifetimeMs });

      return clerkUserId;
    },

    // Null for a Clerk user whose account was erased.
    async userId(clerkUserId: string): Promise<string | null> {
      const cached = userIds.get(clerkUserId);

      if (cached) return cached;
      const found = await userFor(db, clerkUserId);

      if (!found) return null;

      // Bounds memory; clearing only costs the next request of each person one lookup.
      if (userIds.size >= 10_000) userIds.clear();
      userIds.set(clerkUserId, found);

      return found;
    },

    forget(clerkUserId: string) {
      userIds.delete(clerkUserId);

      for (const [key, agent] of agents) if (agent.clerkUserId === clerkUserId) agents.delete(key);
    },
  };
}

export type AccountAccess = ReturnType<typeof accountAccess>;
