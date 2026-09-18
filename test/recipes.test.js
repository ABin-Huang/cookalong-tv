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

test("every dish has a Chinese name, so it stays reachable by voice in Chinese", () => {
  // The Chinese names live in one list so they can be read together. The cost of
  // that is a dish arriving without one and becoming silently unreachable to a
  // Chinese speaker — so the omission has to fail here instead.
  RECIPES.forEach(recipe => {
    assert.ok(recipe.nameCn, `${recipe.id} has no Chinese name`);
    assert.ok(/[\u4e00-\u9fff]/.test(recipe.nameCn),
      `${recipe.id} has a Chinese name with no Chinese in it: "${recipe.nameCn}"`);
  });
  const names = RECIPES.map(r => r.nameCn);
  assert.strictEqual(new Set(names).size, names.length, "two dishes share a Chinese name");
});
