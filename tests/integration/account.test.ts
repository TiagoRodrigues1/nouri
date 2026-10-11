import assert from "node:assert/strict";
import { test } from "node:test";
import { sweepExpired } from "../../src/account/account.js";
import { googleHealthProvider } from "../../src/google-health/google.js";
import { FakeGoogle, googleConfig } from "../fake-google.js";
import { createHarness } from "../harness.js";

const google = new FakeGoogle();

const now = new Date("2026-10-10T12:00:00Z");

const { app, otherApp, client, db, headers, webhookSignature, userId, otherUserId, signedInAs, setup, cleanup } = createHarness({
  tokenKey: Buffer.alloc(32, 7), now: () => now, providers: [googleHealthProvider({ ...googleConfig, fetch: google.fetch })],
});

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);

const glass = { occurredAt: "2026-10-10T09:00:00Z", timeZone: "Europe/Lisbon", volumeMl: 250 };

const oats = { occurredAt: "2026-10-10T08:00:00Z", timeZone: "Europe/Lisbon", food: { name: "Oats", quantity: { amount: 80, unit: "g" }, nutrients: { kcal: 311, proteinG: 13, carbsG: 53, fatG: 5 } } };

type WebhookEvent = { type: string; data: { id: string; deleted?: boolean } };

function post(target: typeof app, path: string, key: string, body: typeof glass | typeof oats) {
  return target.request(path, { method: "POST", headers: { ...headers, "Idempotency-Key": key }, body: JSON.stringify(body) });
}

function webhook(event: WebhookEvent, signature = webhookSignature) {
  return app.request("/webhooks/clerk", { method: "POST", headers: { "Content-Type": "application/json", "Webhook-Signature": signature }, body: JSON.stringify(event) });
}

// Every table that holds a user_id, with the rows it holds for one person.
async function rowsPerTable(owner: string): Promise<Map<string, number>> {
  const tables = await client<{ table: string }[]>`
    SELECT table_name AS table FROM information_schema.columns WHERE table_schema = current_schema() AND column_name = 'user_id' ORDER BY 1`;

  const counts = new Map<string, number>();

  for (const { table } of tables) {
    const [row] = await client<{ count: number }[]>`SELECT count(*)::int AS count FROM ${client(table)} WHERE user_id = ${owner}`;
    counts.set(table, row?.count ?? 0);
  }

  return counts;
}

// Starts Google sign-in, lets the fake Google approve it, and follows the callback.
async function connectGoogle() {
  const base = "/v1/integrations/google-health";
  const started = await app.request(`${base}/authorizations`, { method: "POST", headers });
  const cookie = /nouri_google-health_state=([^;]+)/.exec(started.headers.get("Set-Cookie") ?? "")?.[1] ?? "";
  const approved = google.approve((await started.json()).authorizationUrl);

  await app.request(`/oauth/google-health/callback?state=${encodeURIComponent(approved.state)}&code=${encodeURIComponent(approved.code)}`, { headers: { Cookie: `nouri_google-health_state=${cookie}` } });
}

void test("account export, erasure on Clerk's user.deleted, and retention", async () => {
  await setup();

  try {
    // Every table that holds a person's rows is erased with their users row, so no new table can be forgotten.
    const owned = await client<{ table: string; cascades: boolean }[]>`
      SELECT c.table_name AS table, EXISTS (
        SELECT 1 FROM pg_constraint k
        WHERE k.conrelid = c.table_name::regclass AND k.contype = 'f' AND k.confrelid = 'users'::regclass AND k.confdeltype = 'c'
      ) AS cascades
      FROM information_schema.columns c WHERE c.table_schema = current_schema() AND c.column_name = 'user_id'`;

    assert.ok(owned.length >= 16);
    // Community foods are shared, so erasure keeps them and forgets who added them; the community foods tests check that.
    assert.deepEqual(owned.filter((table) => !table.cascades), [{ table: "community_foods", cascades: false }]);

    assert.equal((await post(app, "/v1/food-entries", "oats-1", oats)).status, 201);
    assert.equal((await post(app, "/v1/water-entries", "water-1", glass)).status, 201);
    assert.equal((await post(otherApp, "/v1/water-entries", "water-other", glass)).status, 201);

    const form = new FormData();

    form.set("file", new File([new Uint8Array(jpeg)], "progress.jpg"));
    form.set("occurredAt", "2026-10-10T07:00:00Z");
    form.set("timeZone", "Europe/Lisbon");
    assert.equal((await app.request("/v1/progress-photos", { method: "POST", headers: { Authorization: headers.Authorization, "Idempotency-Key": "photo-1" }, body: form })).status, 201);
    await connectGoogle();

    const exported = await app.request("/v1/account/export", { headers });
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get("Content-Disposition") ?? "", /^attachment; filename="nouri-export-\d{4}-\d{2}-\d{2}\.json"$/);
    assert.equal(exported.headers.get("Cache-Control"), "private, no-store");
    const archive = await exported.json();

    assert.equal(archive.format, "nouri-export/1");
    assert.equal(archive.account.id, userId);
    assert.deepEqual(Object.keys(archive.tables), [...(await rowsPerTable(userId)).keys()].sort());
    assert.equal(archive.tables.food_entries[0].name, "Oats");
    assert.equal(archive.tables.water_entries.length, 1);
    assert.equal(archive.tables.mutation_receipts.length, 3);
    assert.equal(Buffer.from(archive.tables.progress_photos[0].image, "base64").equals(jpeg), true);
    assert.equal(archive.tables.wearable_connections[0].provider, "google-health");
    assert.equal("refresh_token" in archive.tables.wearable_connections[0], false);
    assert.equal("access_token" in archive.tables.wearable_connections[0], false);
    assert.equal(JSON.stringify(archive).includes(otherUserId), false);

    assert.equal((await webhook({ type: "user.deleted", data: { id: "user_test_1" } }, "forged")).status, 401);
    assert.equal((await webhook({ type: "user.updated", data: { id: "user_test_1" } })).status, 204);
    assert.equal((await app.request("/v1/days/2026-10-10", { headers })).status, 200);

    const refreshToken = google.currentRefreshToken;

    assert.ok(refreshToken);

    assert.equal((await webhook({ type: "user.deleted", data: { id: "user_test_1", deleted: true } })).status, 204);
    assert.ok(google.revoked.includes(refreshToken));
    assert.deepEqual([...(await rowsPerTable(userId)).values()].filter((count) => count > 0), []);
    assert.equal((await client`SELECT 1 FROM users WHERE id = ${userId}`).length, 0);
    assert.equal((await rowsPerTable(otherUserId)).get("water_entries"), 1);

    // Clerk retries until it hears success, so a repeat is harmless.
    assert.equal((await webhook({ type: "user.deleted", data: { id: "user_test_1", deleted: true } })).status, 204);

    // A session token issued before the deletion stays valid for a minute; it must not start a new account.
    assert.equal((await app.request("/v1/days/2026-10-10", { headers })).status, 401);
    assert.equal((await signedInAs("user_test_1").request("/v1/days/2026-10-10", { headers })).status, 401);
    assert.equal((await client`SELECT 1 FROM users WHERE clerk_user_id = 'user_test_1'`).length, 0);

    await client`INSERT INTO mutation_receipts (user_id, key, request_hash, created_at) VALUES
      (${otherUserId}, 'old', 'hash', '2026-09-09T12:00:00Z'), (${otherUserId}, 'recent', 'hash', '2026-09-11T12:00:00Z')`;
    await sweepExpired(db, now);
    const kept = await client<{ key: string }[]>`SELECT key FROM mutation_receipts WHERE user_id = ${otherUserId} ORDER BY key`;
    assert.deepEqual(kept.map((receipt) => receipt.key), ["recent", "water-other"]);

    // A day on, every token from before the erasure has expired, and the tombstone goes too.
    await sweepExpired(db, new Date("2026-10-12T12:00:00Z"));
    assert.equal((await client`SELECT 1 FROM erased_users`).length, 0);
  } finally {
    await cleanup();
  }
});
