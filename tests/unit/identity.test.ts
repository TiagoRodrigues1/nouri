import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import { clerkAuthenticator } from "../../src/identity/identity.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

const encode = (value: Record<string, string | number>) => Buffer.from(JSON.stringify(value)).toString("base64url");

// Signs a session token shaped like Clerk's, so the real verifyToken runs without the network.
function sessionToken(claims: Record<string, string | number>): string {
  const now = Math.floor(Date.now() / 1000);
  const body = `${encode({ alg: "RS256", typ: "JWT", kid: "test" })}.${encode({ iss: "https://example.clerk.accounts.dev", sid: "sess_1", iat: now, nbf: now - 5, exp: now + 60, ...claims })}`;

  return `${body}.${sign("RSA-SHA256", Buffer.from(body), privateKey).toString("base64url")}`;
}

const authenticate = clerkAuthenticator({
  secretKey: "sk_test_unused",
  jwtKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
  authorizedParties: ["http://127.0.0.1:5173"],
});

const as = (token: string) => authenticate(new Request("http://127.0.0.1:3000/v1/days/2026-10-02", { headers: { Authorization: `Bearer ${token}` } }));

void test("a Clerk session token from an authorized origin names its user", async () => {
  assert.equal(await as(sessionToken({ sub: "user_abc", azp: "http://127.0.0.1:5173" })), "user_abc");
});

void test("tokens from other origins, without an origin, expired, or unsigned are refused without throwing", async () => {
  assert.equal(await as(sessionToken({ sub: "user_abc", azp: "https://evil.example" })), null);
  assert.equal(await as(sessionToken({ sub: "user_abc" })), null);
  assert.equal(await as(sessionToken({ sub: "user_abc", azp: "http://127.0.0.1:5173", exp: 1 })), null);
  assert.equal(await as("x.y.z"), null);
  assert.equal(await authenticate(new Request("http://127.0.0.1:3000/v1/days/2026-10-02")), null);
});
