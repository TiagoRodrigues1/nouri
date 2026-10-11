import { createPublicKey } from "node:crypto";
import { z } from "zod";

const keySchema = z.object({ kty: z.literal("RSA"), kid: z.string().min(1).max(128), n: z.string(), e: z.string(), alg: z.literal("RS256").optional(), use: z.literal("sig").optional() });

const jwksSchema = z.object({ keys: z.array(keySchema).min(1).max(20) });

const lifetimeMs = 5 * 60_000;

// Refresh by time, never by an untrusted kid. Concurrent requests share one fetch; failures also have a cooldown.
export function signingKeys(url: string, fetchKeys: typeof fetch = fetch, now = Date.now) {
  let keys = new Map<string, string>();
  let expiresAt = 0;
  let retryAt = 0;
  let pending: Promise<void> | undefined;

  async function refresh() {
    retryAt = now() + 60_000;

    try {
      const response = await fetchKeys(url, { signal: AbortSignal.timeout(5000), redirect: "error" });

      if (!response.ok) return;
      const body = jwksSchema.parse(await response.json());
      const loaded = new Map(body.keys.map((key) => [key.kid, createPublicKey({ key: { kty: key.kty, n: key.n, e: key.e }, format: "jwk" }).export({ type: "spki", format: "pem" }).toString()]));
      keys = loaded;
      expiresAt = now() + lifetimeMs;
    } catch {
      // Expired keys are not used when refresh fails.
    }
  }

  return async (kid: string): Promise<string | undefined> => {
    if (now() >= expiresAt) {
      if (!pending && now() >= retryAt) pending = refresh().finally(() => { pending = undefined; });
      await pending;
    }

    return now() < expiresAt ? keys.get(kid) : undefined;
  };
}
