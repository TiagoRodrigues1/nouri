import type { WearableProvider } from "./contract.js";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// The purpose is authenticated with the ciphertext, so a refresh token cannot be swapped into the access token column.
function seal(key: Buffer, purpose: string, value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  cipher.setAAD(Buffer.from(purpose));
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);

  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

function open(key: Buffer, purpose: string, sealed: string): string {
  const bytes = Buffer.from(sealed, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));

  decipher.setAAD(Buffer.from(purpose));
  decipher.setAuthTag(bytes.subarray(12, 28));

  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
}

// The purpose is authenticated with each ciphertext, so tokens cannot move between users, providers, or columns.
type SecretKind = "access-token" | "refresh-token" | "code-verifier";

const purpose = (kind: SecretKind, provider: WearableProvider, userId: string) => `${provider}:${kind}:${userId}`;

export function vault(key: Buffer, provider: WearableProvider, userId: string) {
  return {
    seal: (kind: SecretKind, value: string) => seal(key, purpose(kind, provider, userId), value),
    open: (kind: SecretKind, value: string) => open(key, purpose(kind, provider, userId), value),
  };
}

export type TokenVault = ReturnType<typeof vault>;
