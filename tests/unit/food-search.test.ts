import assert from "node:assert/strict";
import { test } from "node:test";
import { searchResultSchema, nutrientsSchema } from "../../src/food/contract.js";
import { catalogFood, searchFoods } from "../../src/food/catalog.js";
import { portugueseTerms, readQuery } from "../../src/food/portuguese.js";

const first = (query: string, locale = "en") => searchFoods(query, locale).items[0]?.name;

void test("every Portuguese term finds a food", () => {
  const empty = Object.keys(portugueseTerms).filter((term) => searchFoods(term, "en").items.length === 0);

  assert.deepEqual(empty, []);
});

void test("a query reads plurals, feminine forms and phrases as Portuguese terms", () => {
  assert.deepEqual(readQuery(["batatas", "assadas"]), [
    { kind: "term", typed: ["batatas"], english: ["potato"] },
    { kind: "term", typed: ["assadas"], english: ["roasted", "baked"] },
  ]);
  assert.deepEqual(readQuery(["couve", "flor"]), [{ kind: "term", typed: ["couve", "flor"], english: ["cauliflower"] }]);
  assert.deepEqual(readQuery(["peito", "de", "appl"]), [
    { kind: "term", typed: ["peito"], english: ["breast"] },
    { kind: "word", typed: "appl" },
  ]);
  assert.deepEqual(readQuery(["de"]), [{ kind: "word", typed: "de" }]);
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

void test("literal searches keep English negation and French connecting words", () => {
  for (const words of [["no", "sugar"], ["pomme", "de", "terre"]]) {
    assert.deepEqual(readQuery(words), words.map((typed) => ({ kind: "word", typed })));
  }

  assert.equal(first("no sugar"), "Tea, brewed, no added sugars");
  assert.ok(!searchFoods("tea no sugar", "en").items.some((item) => item.name.includes("with sugar(s)")));
});

void test("irregular feminine and plural forms resolve without typo recovery", () => {
  for (const adjective of ["crua", "cruas"]) {
    assert.deepEqual(readQuery(["macas", adjective]), [
      { kind: "term", typed: ["macas"], english: ["apple"] },
      { kind: "term", typed: [adjective], english: ["raw"] },
    ]);
  }

  assert.deepEqual(readQuery(["couves", "flores"]), [
    { kind: "term", typed: ["couves", "flores"], english: ["cauliflower"] },
  ]);
  assert.deepEqual(searchFoods("maçãs cruas", "en"), searchFoods("maçã cru", "en"));
  assert.ok(searchFoods("maçãs cruas", "en").items.some((item) => item.name === "Apple, flesh and skin, raw"));
  assert.equal(first("couves-flores"), "Cauliflower, raw");
});

void test("food words rank ahead of incidental ingredients with the same rule after typo recovery", () => {
  assert.equal(first("frango cru"), "Chicken, meat, raw");
  assert.deepEqual(searchFoods("frango cru", "en"), searchFoods("frnago cru", "en"));
  assert.equal(first("raw chicken"), "Chicken, meat, raw");
});

void test("every matching translation contributes to ranking", () => {
  // The second reading of abobrinha is courgette; the catalog uses it in the food's leading words.
  assert.equal(first("abobrinha"), first("curgete"));
  assert.equal(first("appl"), "Apple, flesh and skin, raw");
  assert.equal(first("pear"), "Pear, flesh and skin, raw");
});

void test("search responses retain catalog precision without loosening journal inputs", () => {
  const result = searchFoods("no sugar", "en");

  assert.deepEqual(searchResultSchema.parse(result), result);
  assert.ok(result.items.some((item) => !nutrientsSchema.safeParse(item.nutrients).success));
  assert.equal(nutrientsSchema.safeParse({ kcal: 1, proteinG: 0.0015, carbsG: 0, fatG: 0 }).success, false);
});

void test("a nutrient Ciqual lists as traces or below a limit is known, so it does not blank the day's total", () => {
  // Ciqual gives raw banana "< 0,5" g fat; the catalog counts half the limit.
  const banana = catalogFood({ provider: "ciqual", id: "13005", version: "2025" }, 120);

  assert.equal(banana?.nutrients.fatG, 0.3);
});
