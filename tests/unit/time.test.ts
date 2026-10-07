import assert from "node:assert/strict";
import { test } from "node:test";
import { instantAt } from "../../src/time.js";

void test("a wall-clock time becomes the instant in the zone", () => {
  assert.equal(instantAt("2026-10-07", "08:00", "Europe/Lisbon"), "2026-10-07T07:00:00.000Z");
  assert.equal(instantAt("2026-01-07", "08:00", "Europe/Lisbon"), "2026-01-07T08:00:00.000Z");
  assert.equal(instantAt("2026-10-07", "23:30", "America/New_York"), "2026-10-08T03:30:00.000Z");
  assert.equal(instantAt("2026-10-07", "00:15", "Asia/Kolkata"), "2026-10-06T18:45:00.000Z");
});

void test("times beside a daylight saving change settle on the right side", () => {
  // Lisbon falls back at 02:00 on 25 October 2026; 03:00 is after the change.
  assert.equal(instantAt("2026-10-25", "03:00", "Europe/Lisbon"), "2026-10-25T03:00:00.000Z");
  // Lisbon springs forward at 01:00 on 29 March 2026; 00:30 is before and 02:30 after.
  assert.equal(instantAt("2026-03-29", "00:30", "Europe/Lisbon"), "2026-03-29T00:30:00.000Z");
  assert.equal(instantAt("2026-03-29", "02:30", "Europe/Lisbon"), "2026-03-29T01:30:00.000Z");
});
