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

test("findSubstitute respects the recipe's own diet (vegetarian risotto never swaps to meat stock)", () => {
  const risotto = RECIPES.find(r => r.id === "mushroom-risotto");
  // Recipe-level override now lists a plant-based candidate first and tags
  // chicken stock as non-vegetarian: the vegetarian dish must stay vegetarian.
  assert.strictEqual(I.findSubstitute(risotto, "vegetable-stock").name, "mushroom stock");
  // global fallback for a recipe without override
  const pasta = RECIPES.find(r => r.id === "tomato-basil-pasta");
  assert.strictEqual(I.findSubstitute(pasta, "basil").name, "spinach");
  assert.strictEqual(I.findSubstitute(pasta, "garlic"), null);
});

test("findSubstitute honours a vegan profile: cheese -> nutritional yeast, never dairy", () => {
  const risotto = RECIPES.find(r => r.id === "mushroom-risotto");
  const dairy = I.findSubstitute(risotto, "cheese"); // no profile: default option
  assert.strictEqual(dairy.name, "cheddar cheese");
  const vegan = I.findSubstitute(risotto, "cheese", { diets: ["vegan"] });
  assert.strictEqual(vegan.name, "nutritional yeast");
  assert.ok(vegan.diet.includes("vegan"));
});

test("findSubstitute honours allergen profiles (dairy allergy hides every dairy option)", () => {
  const risotto = RECIPES.find(r => r.id === "mushroom-risotto");
  const opt = I.findSubstitute(risotto, "cheese", { allergens: ["dairy"] });
  assert.strictEqual(opt.name, "nutritional yeast");
  assert.ok(!opt.allergens.includes("dairy"));
});

test("findSubstitute offers meat by default but plants under a vegetarian profile", () => {
  const beef = RECIPES.find(r => r.id === "beef-broccoli");
  assert.strictEqual(I.findSubstitute(beef, "beef").name, "chicken");
  const plant = I.findSubstitute(beef, "beef", { diets: ["vegan"] });
  assert.ok(plant.diet.includes("vegan"));
  assert.notStrictEqual(plant.name, "chicken");
});

test("listSubstitutes reports why non-compatible options were rejected", () => {
  const risotto = RECIPES.find(r => r.id === "mushroom-risotto");
  const { chosen, rejected } = I.listSubstitutes(risotto, "vegetable-stock", { diets: ["vegan"] });
  assert.ok(chosen.diet.includes("vegan"));
  assert.ok(rejected.some(r => /not vegetarian|not vegan/.test(r.reason)));
});

test("recipeMatchesProfile filters by diet tags and ingredient allergens", () => {
  const shrimp = RECIPES.find(r => r.id === "lemon-garlic-shrimp");
  assert.strictEqual(I.recipeMatchesProfile(shrimp, { allergens: ["shellfish"] }), false);
  assert.strictEqual(I.recipeMatchesProfile(shrimp, { allergens: ["dairy"] }), false); // shrimp recipe uses butter
  const beef = RECIPES.find(r => r.id === "beef-broccoli");
  assert.strictEqual(I.recipeMatchesProfile(beef, { allergens: ["dairy"] }), true);
  const chickenRice = RECIPES.find(r => r.id === "garlic-chicken-rice");
  assert.strictEqual(I.recipeMatchesProfile(chickenRice, { diets: ["vegan"] }), false);
  assert.strictEqual(I.recipeMatchesProfile(chickenRice, { diets: ["gluten-free"] }), false); // no GF tag claimed
  const taggedGf = RECIPES.find(r => r.id === "hearty-chicken-soup"); // diet includes gluten-free
  assert.strictEqual(I.recipeMatchesProfile(taggedGf, { diets: ["gluten-free"] }), true);
});

test("matchRecipes excludes profile-incompatible dishes and keeps compatible swaps sub-able", () => {
  // vegan cook: no meat dish may appear, and missing items must only count
  // as "substitutable" when a vegan swap exists.
  const matches = I.matchRecipes(["pasta", "tomato", "garlic"], RECIPES, { diets: ["vegan"] });
  assert.ok(!matches.some(m => m.recipe.id === "garlic-chicken-rice"));
  assert.ok(!matches.some(m => m.recipe.id === "mushroom-risotto")); // vegetarian only (dairy)
  const pasta = matches.find(m => m.recipe.id === "tomato-basil-pasta");
  assert.ok(pasta, "the vegan pasta dish remains a candidate");
  // every substitutable miss must have a vegan-compatible swap
  pasta.missingSubstitutable.forEach(c => {
    assert.ok(I.findSubstitute(pasta.recipe, c, { diets: ["vegan"] }), `no vegan swap for ${c}`);
  });
});

test("matchRecipesWithExclusions explains why dishes were filtered out", () => {
  const { matches, excluded } = I.matchRecipesWithExclusions(
    ["shrimp", "lemon", "garlic"], RECIPES, { allergens: ["shellfish"] }
  );
  assert.ok(!matches.some(m => m.recipe.id === "lemon-garlic-shrimp"));
  const ex = excluded.find(m => m.recipe.id === "lemon-garlic-shrimp");
  assert.ok(ex && /shellfish/.test(ex.excludedReasons.join(" ")));
});

test("normalizeProfile drops unsupported values and de-duplicates", () => {
  assert.deepStrictEqual(
    I.normalizeProfile({ diets: ["Vegan", "vegan", "keto"], allergens: ["Dairy", "magic"] }),
    { diets: ["vegan"], allergens: ["dairy"] }
  );
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

test("every recipe-level swap option is complete and diet-tagged", () => {
  RECIPES.forEach(r => {
    Object.entries(r.substitutions || {}).forEach(([canonical, chain]) => {
      const options = Array.isArray(chain) ? chain : [chain];
      options.forEach(opt => {
        assert.ok(opt.name && opt.note, `${r.id}: ${canonical} option needs name+note`);
        assert.ok(Array.isArray(opt.diet) && opt.diet.length,
          `${r.id}: ${canonical} -> ${opt.name} must declare diet tags (fail-closed)`);
        assert.ok(Array.isArray(opt.allergens), `${r.id}: ${canonical} needs allergens array`);
      });
      // A recipe claiming a diet must never have ALL its options violate it.
      options.forEach(opt => {
        r.diet.forEach(d => {
          // at least one option per chain must satisfy each claimed diet
        });
      });
      const coversEveryClaimedDiet = r.diet.every(d => options.some(o => o.diet.includes(d)));
      assert.ok(coversEveryClaimedDiet,
        `${r.id}: swap chain for ${canonical} has no option compatible with ${r.diet.join("/")}`);
    });
  });
});

test("every global substitution chain starts with a fully-tagged, valid option", () => {
  Object.entries(I.SUBSTITUTION_CHAINS).forEach(([canonical, chain]) => {
    assert.ok(chain.length >= 1, `${canonical} needs at least one option`);
    chain.forEach(opt => {
      assert.ok(opt.name && opt.note, `${canonical}: option needs name+note`);
      assert.ok(Array.isArray(opt.diet) && opt.diet.length, `${canonical}: ${opt.name} needs diet tags`);
      assert.ok(Array.isArray(opt.allergens), `${canonical}: ${opt.name} needs allergens array`);
    });
  });
});
