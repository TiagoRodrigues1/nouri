import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import { clerkAuthenticator } from "../../src/identity/identity.js";
import { signingKeys } from "../../src/identity/signing-keys.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

const encode = (value: Record<string, string | number>) => Buffer.from(JSON.stringify(value)).toString("base64url");

// Signs a session token shaped like Clerk's, so the real verifyToken runs without the network.
function sessionToken(claims: Record<string, string | number>): string {
  const now = Math.floor(Date.now() / 1000);
  const body = `${encode({ alg: "RS256", typ: "JWT", kid: "test" })}.${encode({ iss: "https://example.clerk.accounts.dev", sid: "sess_1", iat: now, nbf: now - 5, exp: now + 60, ...claims })}`;

  return `${body}.${sign("RSA-SHA256", Buffer.from(body), privateKey).toString("base64url")}`;
}

const authenticate = clerkAuthenticator({
  keyFor: () => publicKey.export({ type: "spki", format: "pem" }).toString(),
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

void test("unknown signing key ids cannot amplify Clerk requests, and real signatures still work", async () => {
  let calls = 0;

  const verify = clerkAuthenticator({
    authorizedParties: ["http://127.0.0.1:5173"],
    keyFor: signingKeys("https://keys.example/.well-known/jwks.json", async () => { calls++;

 return Response.json({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "test", alg: "RS256", use: "sig" }] }); }),
  });

  const valid = sessionToken({ sub: "user_abc", azp: "http://127.0.0.1:5173" });

  const requests = Array.from({ length: 30 }, (_, index) => {
    const parts = valid.split(".");
    parts[0] = encode({ alg: "RS256", typ: "JWT", kid: `attacker-${index}` });

    return verify(new Request("https://app.example/v1/dashboard", { headers: { Authorization: `Bearer ${parts.join(".")}` } }));
  });

  assert.deepEqual(await Promise.all(requests), Array(30).fill(null));
  assert.equal(calls, 1);
  assert.equal(await verify(new Request("https://app.example/v1/dashboard", { headers: { Authorization: `Bearer ${valid}` } })), "user_abc");
  assert.equal(calls, 1);
});

void test("signing key refresh uses a cooldown after failure and handles rotation on expiry", async () => {
  let time = 0;
  let calls = 0;
  let fail = true;
  let kid = "old";

  const keyFor = signingKeys("https://keys.example", async () => {
    calls++;

    if (fail) throw new Error("offline");

    return Response.json({ keys: [{ ...publicKey.export({ format: "jwk" }), kid }] });
  }, () => time);

  assert.equal(await keyFor("old"), undefined);
  assert.equal(await keyFor("another"), undefined);
  assert.equal(calls, 1);
  time = 60_001; fail = false;
  assert.ok(await keyFor("old"));
  kid = "new";
  assert.equal(await keyFor("new"), undefined);
  assert.equal(calls, 2);
  time += 5 * 60_000;
  assert.ok(await keyFor("new"));
  assert.equal(await keyFor("old"), undefined);
  assert.equal(calls, 3);
});
