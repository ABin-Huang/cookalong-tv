"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

const S = require("../src/servings");
const { RECIPES } = require("../src/recipes");

// ---------------------------------------------------------------------------
// reading numbers
// ---------------------------------------------------------------------------

test("toNumber reads the ways a recipe writes an amount", () => {
  assert.strictEqual(S.toNumber("200"), 200);
  assert.strictEqual(S.toNumber(" 12 "), 12);
  assert.strictEqual(S.toNumber("1.2"), 1.2);
  assert.strictEqual(S.toNumber("1,2"), 1.2, "a European decimal comma still reads");
  assert.strictEqual(S.toNumber("1/2"), 0.5);
  assert.strictEqual(S.toNumber("1 1/2"), 1.5);
  assert.strictEqual(S.toNumber("2 / 3"), 2 / 3);
  assert.ok(Number.isNaN(S.toNumber("a handful")));
  assert.ok(Number.isNaN(S.toNumber("")));
});

// ---------------------------------------------------------------------------
// writing numbers back
// ---------------------------------------------------------------------------

test("weights round to a kitchen instruction, not to a decimal", () => {
  assert.strictEqual(S.formatAmount(200, "g"), "200");
  assert.strictEqual(S.formatAmount(266.66667, "g"), "265", "no 266.66667g");
  assert.strictEqual(S.formatAmount(14, "g"), "14");
  assert.strictEqual(S.formatAmount(6.5, "ml"), "6.5");
});

test("small volumes keep a tenth of a unit instead of jumping half a litre", () => {
  // 1.2 L doubled is 2.4 L. Rounding that to 2.5 L would over-pour 100ml.
  assert.strictEqual(S.formatAmount(2.4, "l"), "2.4");
  assert.strictEqual(S.formatAmount(0.6, "l"), "0.6");
  assert.strictEqual(S.formatAmount(1.5, "g"), "1.5");
});

test("fractions survive the arithmetic that a cook actually does", () => {
  // Doubling and halving must land on real measures, not on "0.67 cup".
  assert.strictEqual(S.formatAmount(2 / 3, "cup"), "2/3");
  assert.strictEqual(S.formatAmount(1 / 3, "cup"), "1/3");
  assert.strictEqual(S.formatAmount(0.125, "tsp"), "1/8");
  assert.strictEqual(S.formatAmount(1.5, "cup"), "1 1/2");
  assert.strictEqual(S.formatAmount(2.5, "tbsp"), "2 1/2");
});

test("an amount too small to measure is refused, so the caller keeps the original", () => {
  // A sixteenth of a teaspoon is not something to print; better to scale nothing
  // than to tell someone to add "0 tsp".
  assert.strictEqual(S.formatAmount(0.0625, "tsp"), "");
  assert.strictEqual(S.formatAmount(0, "cup"), "");
  assert.strictEqual(S.formatAmount(-3, "g"), "");
  assert.strictEqual(S.formatAmount(NaN, "g"), "");
});

// ---------------------------------------------------------------------------
// agreement
// ---------------------------------------------------------------------------

test("agree is idempotent, so an already-plural word is not double-pluralised", () => {
  assert.strictEqual(S.agree("clove", 2), "cloves");
  assert.strictEqual(S.agree("cloves", 2), "cloves", "not cloveses");
  assert.strictEqual(S.agree("cup", 1), "cup");
  assert.strictEqual(S.agree("cups", 1), "cup");
  assert.strictEqual(S.agree("leaf", 2), "leaves");
  assert.strictEqual(S.agree("leaves", 1), "leaf");
  assert.strictEqual(S.agree("tomato", 2), "tomatoes");
  assert.strictEqual(S.agree("potato", 2), "potatoes");
  assert.strictEqual(S.agree("half", 2), "halves");
});

test("singularize does not eat the s of a word that ends in ss", () => {
  assert.strictEqual(S.singularize("glass"), "glass");
  assert.strictEqual(S.singularize("watercress"), "watercress");
  assert.strictEqual(S.singularize("eggs"), "egg");
});

test("only more than one takes a plural, so half a cup stays singular", () => {
  assert.strictEqual(S.agreementForm(2), 2);
  assert.strictEqual(S.agreementForm(1.5), 2);
  assert.strictEqual(S.agreementForm(1), 1);
  assert.strictEqual(S.agreementForm(0.5), 1, "1/2 cup, not 1/2 cups");
});

// ---------------------------------------------------------------------------
// parsing a quantity
// ---------------------------------------------------------------------------

test("parseQty splits an amount from its unit without touching the spacing", () => {
  assert.deepStrictEqual(S.parseQty("200g spaghetti"), {
    amount: 200,
    max: null,
    gap: "",
    rest: "g spaghetti",
    unit: "g",
    hasUnit: true,
    scalable: true,
  });
  const spaced = S.parseQty("2 tbsp olive oil");
  assert.strictEqual(spaced.gap, " ");
  assert.strictEqual(spaced.rest, "tbsp olive oil");
  assert.strictEqual(spaced.unit, "tbsp");
  assert.ok(spaced.hasUnit);
});

test("an amount whose next word is only a descriptor is a bare count", () => {
  // "1 small piece" counts pieces. The word after the number is not a unit.
  const parsed = S.parseQty("1 small piece");
  assert.strictEqual(parsed.amount, 1);
  assert.strictEqual(parsed.hasUnit, false);
  assert.strictEqual(parsed.rest, "small piece");
});

test("time is parsed but flagged unscalable, so nobody doubles 18 minutes", () => {
  assert.strictEqual(S.parseQty("18 minutes").scalable, false);
  assert.strictEqual(S.parseQty("30 seconds").scalable, false);
  assert.strictEqual(S.parseQty("2 hours").scalable, false);
  assert.strictEqual(S.parseQty("18 minutes").hasUnit, false, "a time is not a measured unit");
});

test("vague and article amounts parse to nothing, which is how they stay unchanged", () => {
  ["to taste", "to serve", "to drizzle", "a handful", "a pinch", "a little", "", null].forEach(qty => {
    assert.strictEqual(S.parseQty(qty), null, `${JSON.stringify(qty)} must not be treated as a number`);
  });
});

test("a range keeps both bounds", () => {
  const parsed = S.parseQty("2-3 cloves");
  assert.strictEqual(parsed.amount, 2);
  assert.strictEqual(parsed.max, 3);
});

// ---------------------------------------------------------------------------
// scaling one quantity
// ---------------------------------------------------------------------------

test("scaling preserves the author's spacing, because the list is read as written", () => {
  assert.strictEqual(S.scaleQty("200g", 2), "400g");
  assert.strictEqual(S.scaleQty("2 tbsp", 2), "4 tbsp");
  assert.strictEqual(S.scaleQty("1.2 L", 2), "2.4 L");
});

test("a word unit agrees with its number, a symbol never does", () => {
  assert.strictEqual(S.scaleQty("1 cup rice", 2), "2 cups rice");
  assert.strictEqual(S.scaleQty("2 cups rice", 1), "2 cups rice");
  assert.strictEqual(S.scaleQty("1 litre stock", 2), "2 litres stock");
  assert.strictEqual(S.scaleQty("500 g flour", 2), "1000 g flour", "a symbol stays put");
  assert.strictEqual(S.scaleQty("2 tbsp oil", 2), "4 tbsp oil", "never 4 tbsps");
});

test("a range scales both bounds and keeps the separator the author chose", () => {
  assert.strictEqual(S.scaleQty("2-3 cloves", 2), "4-6 cloves");
  assert.strictEqual(S.scaleQty("1–2 cups", 2), "2–4 cups");
  assert.strictEqual(S.scaleQty("1 to 2 cloves", 2), "2 to 4 cloves");
});

test("time survives scaling untouched", () => {
  assert.strictEqual(S.scaleQty("18 minutes", 2), "18 minutes");
  assert.strictEqual(S.scaleQty("2 to 3 minutes", 2), "2 to 3 minutes");
  assert.strictEqual(S.scaleQty("30 seconds", 4), "30 seconds");
});

test("scaling by one is exactly no work at all", () => {
  ["200g", "1 cup rice", "3 garlic cloves", "to taste", "1.2 L", "a handful"].forEach(qty => {
    assert.strictEqual(S.scaleQty(qty, 1), qty);
  });
});

test("a nonsense factor leaves the quantity alone rather than corrupting it", () => {
  assert.strictEqual(S.scaleQty("200g", 0), "200g");
  assert.strictEqual(S.scaleQty("200g", -2), "200g");
  assert.strictEqual(S.scaleQty("200g", NaN), "200g");
  assert.strictEqual(S.scaleQty(null, 2), "");
});

// ---------------------------------------------------------------------------
// scaling the ingredient list
// ---------------------------------------------------------------------------

test("a countable ingredient agrees in its name", () => {
  const out = S.scaleIngredients([{ name: "bell pepper", qty: "1" }], 2);
  assert.strictEqual(out[0].qty, "2");
  assert.strictEqual(out[0].name, "bell peppers");
});

test("a countable ingredient agrees in its quantity when the quantity names it", () => {
  const out = S.scaleIngredients([{ name: "ginger", qty: "1 small piece" }], 2);
  assert.strictEqual(out[0].qty, "2 small pieces");
  assert.strictEqual(out[0].name, "ginger", "the ginger itself is uncountable");
});

test("an uncountable never takes a plural, however big the pot gets", () => {
  [
    { qty: "300g", name: "rice" },
    { qty: "2 tbsp", name: "olive oil" },
    { qty: "2 handfuls", name: "spinach" },
    { qty: "150g", name: "rolled oats" },
  ].forEach(ing => {
    const out = S.scaleIngredients([ing], 4)[0];
    assert.strictEqual(out.name, ing.name, `${ing.name} must not pluralise`);
  });
});

test("scaling an ingredient list leaves the original untouched", () => {
  const original = [{ name: "bell pepper", qty: "1", role: "main", pantry: false }];
  const copy = JSON.parse(JSON.stringify(original));
  const out = S.scaleIngredients(original, 2);
  assert.deepStrictEqual(original, copy, "the recipe is shared state and must not be edited");
  assert.notStrictEqual(out[0], original[0]);
});

test("every other field of an ingredient rides along unchanged", () => {
  const out = S.scaleIngredients(
    [{ name: "garlic cloves", canonical: "garlic", qty: "3", role: "seasoning", pantry: true, note: "minced" }],
    2
  )[0];
  assert.deepStrictEqual(out, {
    name: "garlic cloves", canonical: "garlic", qty: "6", role: "seasoning", pantry: true, note: "minced",
  });
});

test("an empty or missing list scales to an empty list instead of throwing", () => {
  assert.deepStrictEqual(S.scaleIngredients([], 2), []);
  assert.deepStrictEqual(S.scaleIngredients(null, 2), []);
});

// ---------------------------------------------------------------------------
// scaling step prose
// ---------------------------------------------------------------------------

test("ingredientHeads offers the full name and the last word, never the qualifier alone", () => {
  const heads = S.ingredientHeads([{ name: "garlic cloves" }, { name: "rice" }]);
  assert.ok(heads.has("garlic cloves"), "the full name lets multi-word phrases match");
  assert.ok(heads.has("clove") && heads.has("cloves"));
  assert.ok(!heads.has("garlic"), "matching garlic alone would agree the wrong word");
});

test("a head is scaled as a bare count, and agrees in prose", () => {
  const heads = S.ingredientHeads([{ name: "bell pepper" }]);
  assert.strictEqual(
    S.scaleStepText("Slice 1 bell pepper into strips.", 2, heads),
    "Slice 2 bell peppers into strips."
  );
});

test("a descriptor between the number and the noun does not stop the match", () => {
  const heads = S.ingredientHeads([{ name: "tomato" }]);
  assert.strictEqual(
    S.scaleStepText("Fold in 1 diced tomato; cook.", 2, heads),
    "Fold in 2 diced tomatoes; cook."
  );
});

test("a measured unit in prose agrees, so the step reads like the list", () => {
  assert.strictEqual(
    S.scaleStepText("Heat 1 tablespoon of olive oil.", 2, []),
    "Heat 2 tablespoons of olive oil."
  );
  assert.strictEqual(
    S.scaleStepText("Warm 1.2 litres of stock.", 2, []),
    "Warm 2.4 litres of stock."
  );
});

test("prose scaling still works when no ingredients were named", () => {
  // The head list only widens what can match; measurements must not depend on it.
  assert.strictEqual(S.scaleStepText("Add 2 tbsp of oil.", 2, []), "Add 4 tbsp of oil.");
  assert.strictEqual(S.scaleStepText("Add 2 tbsp of oil.", 2, null), "Add 4 tbsp of oil.");
});

test("one pass only: a multi-word phrase is not scaled twice", () => {
  const heads = S.ingredientHeads([{ name: "garlic cloves" }]);
  const out = S.scaleStepText("Add 3 crushed garlic cloves.", 2, heads);
  assert.strictEqual(out, "Add 6 crushed garlic cloves.", "not 6 crushed garlics cloves");
});

test("a step with no amounts comes back byte-identical", () => {
  const heads = S.ingredientHeads(RECIPES[0].ingredients);
  const plain = "Drain the pasta, reserving a cup of pasta water.";
  assert.strictEqual(S.scaleStepText(plain, 2, heads), plain);
});

// ---------------------------------------------------------------------------
// the corpus: the invariants that matter across all ten recipes
// ---------------------------------------------------------------------------

const TIME_WORD = /\b\d+(?:[.,]\d+)?\s+(?:second|seconds|sec|secs|minute|minutes|min|mins|hour|hours|hr|hrs)\b/gi;

test("no step in any recipe at any yield changes a time", () => {
  const failures = [];
  RECIPES.forEach(recipe => {
    const heads = S.ingredientHeads(recipe.ingredients);
    [0.5, 2, 3].forEach(factor => {
      recipe.steps.forEach((step, i) => {
        const out = S.scaleStepText(step, factor, heads);
        const before = (step.match(TIME_WORD) || []).join("|");
        const after = (out.match(TIME_WORD) || []).join("|");
        if (before !== after) failures.push(`${recipe.id} step ${i + 1} x${factor}: ${before} -> ${after}`);
      });
    });
  });
  assert.deepStrictEqual(failures, [], "a cooking time is the same time for two people or eight");
});

test("no step in any recipe at any yield is left with an amount that should have scaled", () => {
  // Every number followed by a word must either have scaled, or be a time, or be
  // a range phrased around a time. Anything else is a silent miss.
  const failures = [];
  RECIPES.forEach(recipe => {
    const heads = S.ingredientHeads(recipe.ingredients);
    recipe.steps.forEach((step, i) => {
      const out = S.scaleStepText(step, 2, heads);
      const re = /\b\d+(?:[.,]\d+)?(?:\s*(?:\/\s*\d+|-|–|to)\s*\d+(?:[.,]\d+)?)?\s+[A-Za-z][A-Za-z-]*/g;
      let match;
      while ((match = re.exec(step))) {
        const phrase = match[0];
        const nextWord = (phrase.match(/[A-Za-z][A-Za-z-]*$/) || [""])[0].toLowerCase();
        const isTime = /^(second|seconds|sec|secs|minute|minutes|min|mins|hour|hours|hr|hrs)$/.test(nextWord);
        if (!isTime && out.includes(phrase)) {
          failures.push(`${recipe.id} step ${i + 1}: ${JSON.stringify(phrase)} did not scale`);
        }
      }
    });
  });
  assert.deepStrictEqual(failures, []);
});

test("no scaled step ever emits NaN, undefined or a zero measure", () => {
  const failures = [];
  RECIPES.forEach(recipe => {
    const heads = S.ingredientHeads(recipe.ingredients);
    [0.5, 2, 3].forEach(factor => {
      recipe.steps.forEach((step, i) => {
        const out = S.scaleStepText(step, factor, heads);
        if (/NaN|undefined|null|\b0\s*(g|ml|l|cup|tbsp|tsp|cloves?)\b/.test(out)) {
          failures.push(`${recipe.id} step ${i + 1} x${factor}: ${out}`);
        }
      });
    });
  });
  assert.deepStrictEqual(failures, []);
});

test("scaling every recipe to its own yield is a no-op, ingredient by ingredient", () => {
  const failures = [];
  RECIPES.forEach(recipe => {
    const scaled = S.scaleIngredients(recipe.ingredients, S.factorFor(recipe.serves, recipe.serves));
    recipe.ingredients.forEach((ing, i) => {
      if (scaled[i].qty !== ing.qty || scaled[i].name !== ing.name) {
        failures.push(`${recipe.id}: ${ing.qty} ${ing.name} -> ${scaled[i].qty} ${scaled[i].name}`);
      }
    });
    recipe.steps.forEach((step, i) => {
      if (S.scaleStepText(step, 1, S.ingredientHeads(recipe.ingredients)) !== step) {
        failures.push(`${recipe.id} step ${i + 1} changed at factor 1`);
      }
    });
  });
  assert.deepStrictEqual(failures, []);
});

test("doubling every recipe produces a name and a quantity for every ingredient", () => {
  const failures = [];
  RECIPES.forEach(recipe => {
    S.scaleIngredients(recipe.ingredients, 2).forEach((ing, i) => {
      const original = recipe.ingredients[i];
      if (!ing.name || !String(ing.name).trim()) failures.push(`${recipe.id}: ingredient ${i} lost its name`);
      if (ing.qty === undefined || ing.qty === null) failures.push(`${recipe.id}: ingredient ${i} lost its quantity`);
      if (ing.name !== original.name && !/s$|es$/.test(ing.name)) {
        failures.push(`${recipe.id}: ${original.name} -> ${ing.name} is not a plural`);
      }
    });
  });
  assert.deepStrictEqual(failures, []);
});

// ---------------------------------------------------------------------------
// servings arithmetic
// ---------------------------------------------------------------------------

test("factorFor reads the ratio, and refuses to divide by nothing", () => {
  assert.strictEqual(S.factorFor(2, 4), 2);
  assert.strictEqual(S.factorFor(4, 2), 0.5);
  assert.strictEqual(S.factorFor(3, 3), 1);
  assert.strictEqual(S.factorFor(0, 4), 1);
  assert.strictEqual(S.factorFor(2, 0), 1);
  assert.strictEqual(S.factorFor(NaN, 4), 1);
});

test("clampServings keeps a yield inside what the recipes can be cooked at", () => {
  assert.strictEqual(S.clampServings(4), 4);
  assert.strictEqual(S.clampServings("6"), 6);
  assert.strictEqual(S.clampServings(0), S.MIN_SERVINGS);
  assert.strictEqual(S.clampServings(-5), S.MIN_SERVINGS);
  assert.strictEqual(S.clampServings(999), S.MAX_SERVINGS);
  assert.strictEqual(S.clampServings(3.6), 4);
  assert.strictEqual(S.clampServings("lots"), S.MIN_SERVINGS);
});

test("totalNutrition multiplies the per-serving figures out", () => {
  const per = { kcal: 550, protein: 14, carbs: 95, fat: 12 };
  assert.deepStrictEqual(S.totalNutrition(per, 4), { kcal: 2200, protein: 56, carbs: 380, fat: 48 });
  assert.deepStrictEqual(S.totalNutrition(per, 1), per);
  assert.deepStrictEqual(S.totalNutrition(per, 0.5), { kcal: 275, protein: 7, carbs: 48, fat: 6 });
  assert.strictEqual(S.totalNutrition(null, 4), null);
  assert.strictEqual(S.totalNutrition(per, 0), null);
  assert.strictEqual(S.totalNutrition(per, "x"), null);
});

test("every recipe in the set has nutrition that multiplies to whole numbers", () => {
  RECIPES.forEach(recipe => {
    const total = S.totalNutrition(recipe.nutrition, 4);
    assert.ok(total, `${recipe.id} has no nutrition to scale`);
    Object.values(total).forEach(value => {
      assert.ok(Number.isFinite(value) && value > 0, `${recipe.id} produced ${value}`);
    });
  });
});

// ---------------------------------------------------------------------------
// packaging
// ---------------------------------------------------------------------------

test("the engine is exported for both Node and the browser", () => {
  assert.ok(module.exports !== null);
  const source = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "src", "servings.js"),
    "utf8"
  );
  assert.match(source, /module\.exports = factory\(\)/);
  assert.match(source, /root\.CookalongServings = factory\(\)/);
});

test("the units a cook scales are declared, and time is not among them", () => {
  assert.ok(S.SCALABLE_UNITS.includes("g"));
  assert.ok(S.SCALABLE_UNITS.includes("tablespoon"));
  S.TIME_UNITS.forEach(unit => {
    assert.ok(!S.SCALABLE_UNITS.includes(unit), `${unit} must never be a scalable unit`);
  });
  assert.ok(S.MIN_SERVINGS >= 1 && S.MAX_SERVINGS > S.MIN_SERVINGS);
});
