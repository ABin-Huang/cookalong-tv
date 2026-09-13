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
