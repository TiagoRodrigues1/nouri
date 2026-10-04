import assert from "node:assert/strict";
import { test } from "node:test";
import { searchFoods } from "../../src/food/catalog.js";
import { portugueseTerms } from "../../src/food/portuguese.js";

const first = (query: string, locale = "en") => searchFoods(query, locale).items[0]?.name;

void test("every Portuguese term finds a food", () => {
  const empty = Object.keys(portugueseTerms).filter((term) => searchFoods(term, "en").items.length === 0);

  assert.deepEqual(empty, []);
});

void test("Portuguese words find the food under its catalog name", () => {
  assert.equal(first("maçã"), "Apple, flesh and skin, raw");
  assert.equal(first("frango"), "Chicken, meat, raw");
  assert.equal(first("bacalhau"), "Cod, raw");
  assert.equal(first("mel"), "Honey");
  assert.equal(searchFoods("maçã", "pt-PT").items[0]?.language, "en");
});

void test("a translated word matches whole words only", () => {
  const pears = searchFoods("pera", "en").items.map((item) => item.name);

  assert.equal(pears[0], "Pear, flesh and skin, raw");
  assert.ok(!pears.some((name) => name.startsWith("Pearled")));
});

void test("phrases, plurals and Portuguese word order read as one food", () => {
  assert.equal(first("couve-flor"), "Cauliflower, raw");
  assert.equal(first("peito de frango"), "Chicken, breast, without skin, raw");
  assert.equal(first("sumo de laranja"), "Orange juice, fresh");
  assert.equal(first("maçãs assadas"), "Apple, flesh without skin, roasted/baked");
  assert.equal(first("arroz integral cozido"), "Rice, wholegrain, cooked, no added salt");
});

void test("a misspelled Portuguese word still translates", () => {
  assert.equal(first("frnago"), "Chicken, meat, raw");
});

void test("English and French searches are unchanged", () => {
  assert.equal(first("apple"), "Apple, flesh and skin, raw");
  assert.equal(first("pomme de terre", "fr"), "Pomme de terre nouvelle ou primeur, crue");
});
