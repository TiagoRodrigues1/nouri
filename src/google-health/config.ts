import { z } from "zod";
import { googleHealthProvider } from "./google.js";
import { oauthCallbackPath, type WearableRuntime } from "../wearables/provider.js";

const googleSettings = z.object({
  GOOGLE_HEALTH_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_HEALTH_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_HEALTH_REDIRECT_URI: z.url().refine((uri) => new URL(uri).pathname === oauthCallbackPath("google-health"), `Must end in ${oauthCallbackPath("google-health")}`).optional(),
  WEARABLE_TOKEN_KEY: z.string().regex(/^[0-9a-f]{64}$/i, "Must be 64 hex characters; run openssl rand -hex 32").optional(),
  // Optional: without it, imports start when the person opens Nouri and on daily reconciliation.
  GOOGLE_HEALTH_WEBHOOK_SECRET: z.string().regex(/^[A-Za-z0-9._~-]{32,}$/, "Must be at least 32 URL-safe characters; run openssl rand -hex 32").optional(),
}).transform((value, context) => {
  const { GOOGLE_HEALTH_CLIENT_ID: clientId, GOOGLE_HEALTH_CLIENT_SECRET: clientSecret, GOOGLE_HEALTH_REDIRECT_URI: redirectUri, WEARABLE_TOKEN_KEY: tokenKey, GOOGLE_HEALTH_WEBHOOK_SECRET: webhookSecret } = value;

  if (!clientId && !clientSecret && !redirectUri) return null;

  if (!clientId || !clientSecret || !redirectUri) {
    context.addIssue({ code: "custom", message: "Set all Google Health settings, or none of them." });

    return z.NEVER;
  }

  if (!tokenKey) {
    context.addIssue({ code: "custom", message: "Set WEARABLE_TOKEN_KEY to 64 hex characters (openssl rand -hex 32) to store provider tokens." });

    return z.NEVER;
  }

  return { clientId, clientSecret, redirectUri, tokenKey, webhookSecret };
});

export function wearablesFromEnv(env: Record<string, string | undefined>, fetch: typeof globalThis.fetch): WearableRuntime | undefined {
  const settings = googleSettings.parse(env);

  if (!settings) return undefined;

  return { tokenKey: Buffer.from(settings.tokenKey, "hex"), now: () => new Date(), providers: [googleHealthProvider({ ...settings, fetch })] };
}
