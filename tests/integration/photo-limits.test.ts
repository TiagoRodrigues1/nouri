import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createHarness } from "../harness.js";
import { maxAccountPhotoBytes, maxAccountPhotos, maxPhotoBytes, maxTotalPhotoBytes } from "../../src/photos/contract.js";

const { app, otherApp, client, token, userId, otherUserId, setup, cleanup } = createHarness();

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

const auth = { Authorization: `Bearer ${token}` };

function upload(key = randomUUID(), target = app) {
  const body = new FormData();
  body.set("file", new File([new Uint8Array(png)], "progress.png"));
  body.set("occurredAt", "2026-10-11T08:00:00Z");
  body.set("timeZone", "Europe/Lisbon");

  return target.request("/v1/progress-photos", { method: "POST", headers: { ...auth, "Idempotency-Key": key }, body });
}

// Seed metadata representing an already-full account without allocating hundreds of MiB in the test runner.
async function seed(owner: string, count: number, bytes: number) {
  for (let index = 0; index < count; index++) {
    await client`INSERT INTO progress_photos (id, user_id, occurred_at, time_zone, local_date, content_type, byte_size, image)
      VALUES (${randomUUID()}, ${owner}, now(), 'Europe/Lisbon', '2026-10-11', 'image/png', ${bytes}, ${png})`;
  }
}

void test("photo count and byte quotas survive concurrent uploads, retries, and deletions", async () => {
  await setup();

  try {
    await seed(userId, maxAccountPhotos - 1, png.length);
    const key = randomUUID();
    const created = await upload(key);
    assert.equal(created.status, 201);
    const photo = await created.json();
    assert.deepEqual(await (await upload(key)).json(), photo);
    assert.equal((await upload()).status, 413);
    assert.equal((await upload(randomUUID(), otherApp)).status, 201);
    const removed = await app.request(`/v1/progress-photos/${photo.id}`, { method: "DELETE", headers: { ...auth, "Idempotency-Key": randomUUID(), "If-Match": '"1"' } });
    assert.equal(removed.status, 204);
    assert.equal((await upload()).status, 201);

    await client`DELETE FROM progress_photos`;
    await seed(userId, maxAccountPhotoBytes / maxPhotoBytes, maxPhotoBytes);
    await client`UPDATE progress_photos SET byte_size = byte_size - ${png.length} WHERE id = (SELECT id FROM progress_photos LIMIT 1)`;
    const raced = await Promise.all([upload(), upload()]);
    assert.deepEqual(raced.map((response) => response.status).sort((left, right) => left - right), [201, 413]);
    const [usage] = await client`SELECT sum(byte_size) AS bytes FROM progress_photos WHERE user_id = ${userId}`;
    assert.equal(Number(usage?.bytes), maxAccountPhotoBytes);

    await client`DELETE FROM progress_photos`;
    await seed(otherUserId, maxTotalPhotoBytes / maxPhotoBytes, maxPhotoBytes);
    const full = await upload();
    assert.equal(full.status, 413);
    assert.match((await full.json()).error, /app's photo storage is full/);
    const [receipts] = await client`SELECT count(*) AS count FROM mutation_receipts WHERE outcome IS NULL`;
    assert.equal(Number(receipts?.count), 0);
  } finally {
    await cleanup();
  }
});
