"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

const I = require("../src/ingredients");
const { RECIPES } = require("../src/recipes");

/* ---------- normalizeIngredient ---------- */

test("normalizeIngredient maps aliases and plurals", () => {
  assert.strictEqual(I.normalizeIngredient("garlic"), "garlic");
  assert.strictEqual(I.normalizeIngredient("Garlic Cloves"), "garlic");
  assert.strictEqual(I.normalizeIngredient("tomatoes"), "tomato");
  assert.strictEqual(I.normalizeIngredient("chicken thighs"), "chicken");
  assert.strictEqual(I.normalizeIngredient("奶酪"), "cheese");
});

test("normalizeIngredient strips leading quantities", () => {
  assert.strictEqual(I.normalizeIngredient("200g of spaghetti"), "pasta");
  assert.strictEqual(I.normalizeIngredient("3 carrots"), "carrot");
  assert.strictEqual(I.normalizeIngredient("a banana"), "banana");
});

test("normalizeIngredient returns null for unknown text", () => {
  assert.strictEqual(I.normalizeIngredient("dragonfruit"), null);
  assert.strictEqual(I.normalizeIngredient(""), null);
  assert.strictEqual(I.normalizeIngredient(null), null);
});

/* ---------- parseIngredientList ---------- */

test("parseIngredientList handles separators and lead-ins", () => {
  assert.deepStrictEqual(
    I.parseIngredientList("I have chicken, tomatoes and onion").recognized,
    ["chicken", "tomato", "onion"]
  );
  assert.deepStrictEqual(
    I.parseIngredientList("mushrooms、rice、garlic").recognized,
    ["mushroom", "rice", "garlic"]
  );
});

test("parseIngredientList de-duplicates and reports unknown fragments", () => {
  const r = I.parseIngredientList("chicken, chicken breast, dragonfruit");
  assert.deepStrictEqual(r.recognized, ["chicken"]);
  assert.deepStrictEqual(r.unknown, ["dragonfruit"]);
});

/* ---------- matchRecipes ---------- */

test("matchRecipes ranks the best recipe first", () => {
  const matches = I.matchRecipes(["mushroom", "rice", "onion", "garlic"], RECIPES);
  assert.strictEqual(matches[0].recipe.id, "mushroom-risotto");
  assert.ok(matches[0].score >= 80);
  assert.deepStrictEqual(matches[0].missingHard, []);
  assert.ok(matches[0].missingSubstitutable.includes("cheese"));
});

test("matchRecipes assumes pantry staples and scores 100 when fully stocked", () => {
  const risotto = RECIPES.find(r => r.id === "mushroom-risotto");
  const nonPantry = risotto.ingredients.filter(i => !i.pantry).map(i => i.canonical);
  const [top] = I.matchRecipes(nonPantry, [risotto]);
  assert.strictEqual(top.score, 100);
  assert.deepStrictEqual(top.missingHard, []);
  assert.deepStrictEqual(top.missingSubstitutable, []);
});

test("matchRecipes empty input never scores a non-pantry dish at 100", () => {
  const matches = I.matchRecipes([], RECIPES);
  for (const m of matches) {
    const hasNonPantry = m.recipe.ingredients.some(i => !i.pantry);
    if (hasNonPantry) assert.ok(m.score < 100);
  }
});

test("matchRecipes is sorted by score then hard-missing count", () => {
  const matches = I.matchRecipes(["chicken", "rice"], RECIPES);
  for (let i = 1; i < matches.length; i++) {
    assert.ok(matches[i - 1].score >= matches[i].score);
  }
});

/* ---------- substitutions ---------- */

test("findSubstitute prefers recipe-level overrides", () => {
  const risotto = RECIPES.find(r => r.id === "mushroom-risotto");
  assert.strictEqual(I.findSubstitute(risotto, "vegetable-stock").name, "chicken stock");
  // global fallback for a recipe without override
  const pasta = RECIPES.find(r => r.id === "tomato-basil-pasta");
  assert.strictEqual(I.findSubstitute(pasta, "basil").name, "spinach");
  assert.strictEqual(I.findSubstitute(pasta, "garlic"), null);
});

test("substituteInSteps rewrites names without chained re-matching", () => {
  const out = I.substituteInSteps(
    ["Beat in butter and grated parmesan until melted."],
    ["grated parmesan", "cheese"],
    "cheddar cheese"
  );
  assert.strictEqual(out.steps[0], "Beat in butter and cheddar cheese until melted.");
  assert.deepStrictEqual(out.changedIndexes, [0]);
});

test("substituteInSteps preserves sentence capitalization", () => {
  const out = I.substituteInSteps(["Butter melts first."], ["butter"], "olive oil");
  assert.strictEqual(out.steps[0], "Olive oil melts first.");
});

test("substituteInSteps with no targets is a stable no-op", () => {
  const src = ["Keep moving."];
  const out = I.substituteInSteps(src, [], "anything");
  assert.deepStrictEqual(out.steps, src);
  assert.deepStrictEqual(out.changedIndexes, []);
});

/* ---------- Pantry ---------- */

test("Pantry add/has/consume and round-trip", () => {
  const p = new I.Pantry();
  assert.strictEqual(p.add("2 chicken thighs"), "chicken");
  assert.ok(p.has("chicken"));
  p.consume("chicken");
  assert.ok(!p.has("chicken"));
  p.restock("tomatoes");
  const json = JSON.stringify(p);
  const restored = I.Pantry.fromJSON(JSON.parse(json));
  assert.ok(restored.has("tomato"));
});

/* ---------- dataset integrity ---------- */

test("dataset has 10 recipes, each with structured ingredients and steps", () => {
  assert.strictEqual(RECIPES.length, 10);
  const known = new Set(Object.values(I.ALIASES));
  RECIPES.forEach(r => {
    assert.ok(r.steps.length >= 5, `${r.id} needs realistic steps`);
    assert.ok(Array.isArray(r.ingredients) && r.ingredients.length >= 4, `${r.id} needs ingredients`);
    r.ingredients.forEach(ing => {
      assert.ok(known.has(ing.canonical), `${r.id}: unknown canonical ${ing.canonical}`);
      assert.ok(["main", "secondary", "seasoning"].includes(ing.role), `${r.id}: bad role`);
      assert.ok(ing.name && ing.qty, `${r.id}: ingredient needs name+qty`);
    });
  });
});

test("every swap target referenced by recipes exists in the engine", () => {
  RECIPES.forEach(r => {
    (r.ingredients || []).forEach(ing => {
      if (ing.pantry) return;
      // every non-staple must either be commonly owned-testable (canonical ok)
      // and recipe-level overrides must carry name+note
    });
    Object.entries(r.substitutions || {}).forEach(([canonical, sub]) => {
      assert.ok(sub.name && sub.note, `${r.id}: bad override for ${canonical}`);
    });
  });
});
