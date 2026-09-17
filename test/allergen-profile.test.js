"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

const I = require("../src/ingredients");
const { RECIPES } = require("../src/recipes");

/**
 * The web app now exposes an allergy profile, having previously hardcoded
 * `allergens: []` while the engine supported the whole feature. These lock in
 * the engine behaviour the UI is built on — recipes must actually disappear,
 * the reason must be reportable, and a swap must never be offered if it would
 * put the allergen back on the plate.
 */

test("an allergen profile hides whole recipes and says why", () => {
  const { matches, excluded } = I.matchRecipesWithExclusions([], RECIPES, { allergens: ["shellfish"] });

  const shrimp = excluded.find(m => m.recipe.id === "lemon-garlic-shrimp");
  assert.ok(shrimp, "the shrimp recipe must be excluded, not merely scored low");
  assert.ok(shrimp.excludedReasons.some(r => r.includes("shellfish")));

  assert.strictEqual(
    matches.find(m => m.recipe.id === "lemon-garlic-shrimp"),
    undefined,
    "an excluded recipe must not also be offered"
  );
});

test("excludedReasons use the 'contains ' prefix the UI counts on", () => {
  const { excluded } = I.matchRecipesWithExclusions([], RECIPES, { allergens: ["gluten", "dairy"] });
  const allergenReasons = excluded
    .flatMap(m => m.excludedReasons)
    .filter(r => r.startsWith("contains "));

  assert.ok(allergenReasons.length > 0, "there must be allergen reasons to report");
  assert.ok(
    allergenReasons.every(r => /^contains [a-z]+$/.test(r)),
    `unexpected reason format: ${allergenReasons.join(", ")}`
  );
});

test("no profile means nothing is hidden", () => {
  assert.deepStrictEqual(I.matchRecipesWithExclusions([], RECIPES, {}).excluded, []);
  assert.deepStrictEqual(I.matchRecipesWithExclusions([], RECIPES).excluded, []);
});

test("a recipe carries its allergens, and the grid filter agrees", () => {
  const pasta = RECIPES.find(r => r.id === "tomato-basil-pasta");
  assert.deepStrictEqual(I.recipeAllergens(pasta), ["gluten"]);
  assert.strictEqual(I.recipeMatchesProfile(pasta, { allergens: ["gluten"] }), false);
  assert.strictEqual(I.recipeMatchesProfile(pasta, { allergens: ["dairy"] }), true);
  assert.strictEqual(I.recipeMatchesProfile(pasta, {}), true);
});

test("an allergy closes the swap that would reintroduce it", () => {
  const risotto = RECIPES.find(r => r.id === "mushroom-risotto");
  const info = I.listSubstitutes(risotto, "cheese", { allergens: ["dairy"] });
  const offered = [info.chosen, ...(info.compatible || [])].filter(Boolean).map(o => o.name);

  assert.ok(offered.length > 0, "the dairy-allergic cook must still get a usable option");
  assert.ok(
    !offered.some(n => /cheese/i.test(n)),
    `dairy was offered despite the allergy: ${offered.join(", ")}`
  );
  // and the reason the better-sounding option was withheld is recorded
  assert.ok((info.rejected || []).some(o => o.name === "cheddar cheese"));
});

test("the same swap is offered normally when there is no allergy", () => {
  const risotto = RECIPES.find(r => r.id === "mushroom-risotto");
  const info = I.listSubstitutes(risotto, "cheese", {});
  assert.ok(
    info.chosen && /cheese/i.test(info.chosen.name),
    "without a profile, cheese should still be the first suggestion"
  );
});

test("an unknown allergen is ignored rather than hiding everything", () => {
  assert.deepStrictEqual(I.normalizeProfile({ allergens: ["dragonfruit"] }).allergens, []);
  assert.deepStrictEqual(
    I.matchRecipesWithExclusions([], RECIPES, { allergens: ["dragonfruit"] }).excluded,
    []
  );
  assert.deepStrictEqual(I.normalizeProfile({ allergens: ["DAIRY "] }).allergens, ["dairy"]);
});

test("every allergen the UI offers is one the engine actually understands", () => {
  const known = new Set(I.COMMON_ALLERGENS);
  ["dairy", "egg", "gluten", "shellfish", "fish", "soy", "nuts", "peanut", "sesame"].forEach(a =>
    assert.ok(known.has(a), `${a} must be in COMMON_ALLERGENS or the chips would do nothing`));
});

test("allergies and diets combine rather than overriding each other", () => {
  const profile = { diets: ["vegan"], allergens: ["gluten"] };
  const { matches } = I.matchRecipesWithExclusions([], RECIPES, profile);
  assert.ok(matches.length > 0);
  matches.forEach(m => {
    assert.ok(m.recipe.diet.includes("vegan"), `${m.recipe.id} is not vegan`);
    assert.ok(!I.recipeAllergens(m.recipe).includes("gluten"), `${m.recipe.id} carries gluten`);
  });
});
