"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { listRecipes, getRecipe, formatStep, RECIPES } = require("../src/recipes");

test("listRecipes returns all recipes when no diet filter", () => {
  const all = listRecipes();
  assert.strictEqual(all.length, RECIPES.length);
  assert.ok(all.every(r => r.id && r.name && r.stepCount > 0));
});
test("listRecipes filters by vegan", () => {
  const vegan = listRecipes("vegan");
  assert.ok(vegan.length >= 1);
  assert.ok(vegan.every(r => r.diet.includes("vegan")));
});
test("listRecipes with unknown diet returns empty list", () => {
  assert.deepStrictEqual(listRecipes("pescatarian"), []);
});
test("getRecipe returns recipe by id", () => {
  const r = getRecipe("tomato-basil-pasta");
  assert.strictEqual(r.name, "Tomato Basil Pasta");
  assert.ok(r.steps.length >= 5);
});
test("getRecipe returns null for unknown id", () => {
  assert.strictEqual(getRecipe("nope"), null);
});
test("formatStep produces voice-friendly text", () => {
  const r = getRecipe("tomato-basil-pasta");
  const step = formatStep(r, 1);
  assert.match(step, /^Step 1 of \d+: /);
  assert.ok(step.includes(r.steps[0]));
});
test("formatStep out of range returns null", () => {
  const r = getRecipe("tomato-basil-pasta");
  assert.strictEqual(formatStep(r, 0), null);
  assert.strictEqual(formatStep(r, r.steps.length + 1), null);
});
test("findRecipe matches by display name (Alexa slot format)", () => {
  const { findRecipe } = require("../src/recipes");
  assert.strictEqual(findRecipe("tomato basil pasta").id, "tomato-basil-pasta");
  assert.strictEqual(findRecipe("Garlic Chicken Rice").id, "garlic-chicken-rice");
  assert.strictEqual(findRecipe("tomato-basil-pasta").id, "tomato-basil-pasta");
  assert.strictEqual(findRecipe("sushi"), null);
  assert.strictEqual(findRecipe(""), null);
});

/* ---------------- Serving scaling ---------------- */

const { scaleRecipe, parseQty } = require("../src/recipes");

test("parseQty extracts number and unit", () => {
  assert.deepStrictEqual(parseQty("200g"), { num: 200, space: false, rest: "g" });
  assert.deepStrictEqual(parseQty("1.2 L"), { num: 1.2, space: true, rest: "L" });
  assert.deepStrictEqual(parseQty("3"), { num: 3, space: false, rest: "" });
  assert.deepStrictEqual(parseQty("1/2 tsp"), { num: 0.5, space: true, rest: "tsp" });
  assert.deepStrictEqual(parseQty("4 thick slices"), { num: 4, space: true, rest: "thick slices" });
  assert.strictEqual(parseQty("to taste"), null);
  assert.strictEqual(parseQty("a handful"), null);
});

test("scaleRecipe doubles a 2-serving recipe", () => {
  const r = getRecipe("tomato-basil-pasta"); // serves 2
  const s = scaleRecipe(r, 4);
  assert.strictEqual(s.serves, 4);
  const qty = Object.fromEntries(s.ingredients.map(i => [i.canonical, i.qty]));
  assert.strictEqual(qty.pasta, "400g");
  assert.strictEqual(qty.tomato, "800g");
  assert.strictEqual(qty.garlic, "6");
  assert.strictEqual(qty["olive-oil"], "4 tbsp");
  // qualitative quantities stay untouched
  assert.strictEqual(qty.basil, "a handful");
  assert.strictEqual(qty.salt, "to taste");
});

test("scaleRecipe halves a 4-serving recipe", () => {
  const r = getRecipe("hearty-chicken-soup"); // serves 4
  const s = scaleRecipe(r, 2);
  const qty = Object.fromEntries(s.ingredients.map(i => [i.canonical, i.qty]));
  assert.strictEqual(qty.chicken, "250g");
  assert.strictEqual(qty["chicken-stock"], "0.6 L");
  assert.strictEqual(qty.potato, "1");
  assert.strictEqual(qty.carrot, "1");
  assert.strictEqual(qty.onion, "0.5");
});

test("scaleRecipe handles fractional quantities", () => {
  const r = getRecipe("banana-oat-pancakes"); // serves 2, cinnamon 1/2 tsp
  const s = scaleRecipe(r, 3);
  const qty = Object.fromEntries(s.ingredients.map(i => [i.canonical, i.qty]));
  assert.strictEqual(qty.cinnamon, "0.75 tsp");
  assert.strictEqual(qty.banana, "3 ripe");
});

test("scaleRecipe scales nutrition proportionally and rounds", () => {
  const r = getRecipe("tomato-basil-pasta"); // 550 kcal for serves 2
  const s = scaleRecipe(r, 4);
  assert.deepStrictEqual(s.nutrition, { kcal: 1100, protein: 28, carbs: 190, fat: 24 });
  const half = scaleRecipe(r, 1);
  assert.deepStrictEqual(half.nutrition, { kcal: 275, protein: 7, carbs: 48, fat: 6 });
});

test("scaleRecipe keeps canonical ids for the front-end", () => {
  const r = getRecipe("garlic-chicken-rice");
  const s = scaleRecipe(r, 6);
  assert.deepStrictEqual(s.ingredients.map(i => i.canonical), r.ingredients.map(i => i.canonical));
});

test("scaleRecipe rejects invalid servings", () => {
  const r = getRecipe("tomato-basil-pasta");
  assert.strictEqual(scaleRecipe(r, 0), null);
  assert.strictEqual(scaleRecipe(r, -2), null);
  assert.strictEqual(scaleRecipe(r, NaN), null);
  assert.strictEqual(scaleRecipe(null, 2), null);
});
