import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createHarness } from "../harness.js";
import { applyMigrations } from "../../src/db/migrations.js";

const { client, userId, setup, cleanup } = createHarness();

void test("the ledger backfill counts rows from before accounts existed as unowned", async () => {
  await setup();

  try {
    // Undo 0011, then add a row under an API_USER_ID no users row has, as 0002's NOT VALID keys allow.
    await client`DROP FUNCTION track_account_storage() CASCADE`;
    await client`DROP TABLE account_storage, unowned_storage`;
    await client`DELETE FROM schema_migrations WHERE name = 'migrations/0011-account-storage.sql'`;
    const legacyOwner = randomUUID();

    await client.begin(async (sql) => {
      // Replica mode skips foreign key checks, the way rows written before 0002 never had them.
      await sql`SET LOCAL session_replication_role = replica`;
      await sql`INSERT INTO water_entries (id, user_id, occurred_at, time_zone, local_date, volume_ml) VALUES (${randomUUID()}, ${legacyOwner}, now(), 'Europe/Lisbon', '2026-01-01', 250)`;
    });
    await client`INSERT INTO water_entries (id, user_id, occurred_at, time_zone, local_date, volume_ml) VALUES (${randomUUID()}, ${userId}, now(), 'Europe/Lisbon', '2026-01-01', 250)`;

    await applyMigrations(client);

    const [legacy] = await client`SELECT pg_column_size(t) AS bytes FROM water_entries t WHERE user_id = ${legacyOwner}`;
    const [owned] = await client`SELECT pg_column_size(t) AS bytes FROM water_entries t WHERE user_id = ${userId}`;
    const [unowned] = await client`SELECT bytes FROM unowned_storage`;
    const [account] = await client`SELECT bytes FROM account_storage WHERE user_id = ${userId}`;
    const [orphans] = await client`SELECT count(*) AS count FROM account_storage WHERE user_id = ${legacyOwner}`;
    // A row value's size can differ by a few bytes with the query that forms it (short varlena headers), so the
    // backfill and this readback agree to within a few bytes, not exactly.
    const close = (charged: number, row: number) => Math.abs(charged - row) <= 8;
    assert.ok(close(Number(unowned?.bytes), Number(legacy?.bytes)));
    assert.ok(close(Number(account?.bytes), Number(owned?.bytes)));
    assert.equal(Number(orphans?.count), 0);

    // Editing a legacy row keeps it in the unowned total instead of failing on the ledger's foreign key.
    await client`UPDATE water_entries SET volume_ml = 330 WHERE user_id = ${legacyOwner}`;
    const [edited] = await client`SELECT bytes FROM unowned_storage`;
    assert.equal(Number(edited?.bytes), Number(unowned?.bytes));
    const [stillNone] = await client`SELECT count(*) AS count FROM account_storage WHERE user_id = ${legacyOwner}`;
    assert.equal(Number(stillNone?.count), 0);
  } finally {
    await cleanup();
  }
});
