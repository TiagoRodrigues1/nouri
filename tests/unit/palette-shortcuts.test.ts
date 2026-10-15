import assert from "node:assert/strict";
import { test } from "node:test";
import { nameMatches, parseShortcut } from "../../frontend/src/lib/palette-shortcuts.js";

void test("a measurement typed with its value saves in one step", () => {
  assert.deepEqual(parseShortcut("weight 82.4"), { kind: "measurement", measurement: "weight", value: 82.4 });
  assert.deepEqual(parseShortcut("82,4 kg weight"), { kind: "measurement", measurement: "weight", value: 82.4 });
  assert.deepEqual(parseShortcut("  W  82 "), { kind: "measurement", measurement: "weight", value: 82 });
  assert.deepEqual(parseShortcut("body fat 18.5%"), { kind: "measurement", measurement: "body-fat", value: 18.5 });
  assert.deepEqual(parseShortcut("waist 84 cm"), { kind: "measurement", measurement: "waist", value: 84 });
});

void test("water is typed in millilitres either side of the word", () => {
  assert.deepEqual(parseShortcut("500 water"), { kind: "water", volumeMl: 500 });
  assert.deepEqual(parseShortcut("water 330ml"), { kind: "water", volumeMl: 330 });
});

void test("values outside the record's limits, and other text, are not shortcuts", () => {
  assert.equal(parseShortcut("weight 5"), null);
  assert.equal(parseShortcut("water 9000"), null);
  assert.equal(parseShortcut("water 2.5"), null);
  assert.equal(parseShortcut("weight 82.4 lb"), null);
  assert.equal(parseShortcut("chicken"), null);
  assert.equal(parseShortcut("weight"), null);
});

void test("names match every typed word, ignoring case and accents", () => {
  assert.ok(nameMatches("Maçã, crua", "maca"));
  assert.ok(nameMatches("Chicken breast, grilled", "grilled chick"));
  assert.ok(nameMatches("Oats", ""));
  assert.ok(!nameMatches("Chicken breast", "thigh"));
});
