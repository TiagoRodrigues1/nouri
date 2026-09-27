import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function sha256Base64url(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sameSecret(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false;
  const supplied = Buffer.from(actual);
  const configured = Buffer.from(expected);

  return supplied.length === configured.length && timingSafeEqual(supplied, configured);
}
