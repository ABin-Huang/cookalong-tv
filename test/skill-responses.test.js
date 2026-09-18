"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

const R = require("../skill/responses");

function freshState(over = {}) {
  return { recipeId: null, step: 0, swaps: {}, diets: [], allergens: [], ...over };
}

/* ------------------------------- launch -------------------------------- */

test("buildLaunch speaks recipe count and wraps SSML", () => {
  const out = R.buildLaunch(freshState());
  assert.ok(out.speech.startsWith("<speak>") && out.speech.endsWith("</speak>"));
  assert.ok(/10 hands-free recipes/.test(out.speech));
  assert.ok(out.reprompt);
});

/* ----------------------------- smart match ----------------------------- */

test("buildWhatDoIHave returns scored matches, APL doc and session ids", () => {
  const s = freshState();
  const out = R.buildWhatDoIHave("mushrooms, rice, onion, garlic", s);
  assert.strictEqual(out.document, R.APL.matchResults);
  assert.ok(Array.isArray(s.matchIds) && s.matchIds.length >= 1);
  assert.strictEqual(s.matchIds[0], "mushroom-risotto");
  const rows = out.datasource.cookalongData.properties.matches;
  assert.ok(rows[0].best === true);
  assert.ok(rows[0].score >= 80);
  for (const row of rows) {
    assert.ok(row.name && typeof row.status === "string" && "ready" in row);
  }
});

test("buildWhatDoIHave honours a vegan profile (no meat/dairy dishes on screen)", () => {
  const s = freshState({ diets: ["vegan"] });
  const out = R.buildWhatDoIHave("pasta, tomato, garlic", s);
  const rows = out.datasource.cookalongData.properties.matches;
  assert.ok(rows.length);
  assert.ok(!rows.some(r => /chicken|shrimp|risotto|french toast|pancake/i.test(r.name)));
});

test("buildWhatDoIHave with no recognized ingredient asks again", () => {
  const out = R.buildWhatDoIHave("dragonfruit", freshState());
  assert.ok(/which ingredients/i.test(out.speech));
  assert.strictEqual(out.document, undefined);
});

/* ----------------------------- start cooking --------------------------- */

test("buildStartCooking resolves 'cook it' to the current best match", () => {
  const s = freshState();
  R.buildWhatDoIHave("mushrooms, rice, onion, garlic", s);
  const out = R.buildStartCooking("it", s);
  assert.strictEqual(s.recipeId, "mushroom-risotto");
  assert.strictEqual(out.document, R.APL.cooking);
  assert.ok(/Step 1 of 7/.test(out.speech));
});

test("buildStartCooking refuses a dish outside the profile", () => {
  const s = freshState({ diets: ["vegan"] });
  const out = R.buildStartCooking("garlic chicken rice", s);
  assert.ok(/doesn't fit/i.test(out.speech));
  assert.strictEqual(s.recipeId, null);
});

/* -------------------------------- swaps -------------------------------- */

test("buildSubstitute keeps a vegetarian dish vegetarian (stock stays plant-based)", () => {
  const s = freshState();
  R.buildStartCooking("creamy mushroom risotto", s);
  const out = R.buildSubstitute("vegetable stock", s);
  assert.strictEqual(out.document, R.APL.swapConfirm);
  assert.notStrictEqual(out.datasource.cookalongData.properties.toName, "chicken stock");
  assert.strictEqual(s.swaps["vegetable-stock"].name, out.datasource.cookalongData.properties.toName);
});

test("buildSubstitute under vegan profile swaps cheese to nutritional yeast", () => {
  // Enter the swap flow directly with a session already on the risotto.
  const s = freshState({ diets: ["vegan"] });
  s.recipeId = "mushroom-risotto";
  const out = R.buildSubstitute("cheese", s);
  assert.strictEqual(out.datasource.cookalongData.properties.toName, "nutritional yeast");
  assert.ok(/vegan/i.test(out.speech));
});

test("buildSubstitute reports an unknown ingredient gracefully", () => {
  const s = freshState();
  R.buildStartCooking("tomato basil pasta", s);
  const out = R.buildSubstitute("chicken", s);
  assert.ok(/doesn't use chicken/i.test(out.speech));
});

/* ------------------------------ step flow ------------------------------ */

test("buildNextStep advances and rewrites step text after a swap", () => {
  const s = freshState();
  R.buildStartCooking("creamy mushroom risotto", s);
  R.buildSubstitute("butter", s); // butter -> olive oil
  const step6 = (() => {
    let out;
    for (let i = 0; i < 5; i++) out = R.buildNextStep(s); // move to step 6
    return out;
  })();
  assert.strictEqual(s.step, 5);
  const text = step6.datasource.cookalongData.properties.stepText;
  assert.ok(/olive oil/i.test(text));
  assert.ok(!/\bbutter\b/i.test(text));
  assert.ok(Math.abs(step6.datasource.cookalongData.properties.progress - 6 / 7) < 1e-9);
});

test("buildNextStep past the end congratulates the cook", () => {
  const s = freshState();
  R.buildStartCooking("tomato basil pasta", s);
  let out;
  for (let i = 0; i < 7; i++) out = R.buildNextStep(s);
  assert.ok(/last step|enjoy/i.test(out.speech));
});

/* ------------------------------ cook plan ------------------------------ */

test("buildCookPlan names the longest wait and what the step times add up to", () => {
  const s = freshState();
  R.buildStartCooking("garlic chicken rice", s);
  const out = R.buildCookPlan(s);
  assert.strictEqual(out.document, R.APL.cooking);
  assert.ok(/5 of 7 steps name a time/.test(out.speech));
  assert.ok(/32 minutes and 30 seconds/.test(out.speech), "the named times, spoken");
  assert.ok(/step 6, 18 minutes/.test(out.speech), "the one long wait, by step number");
  assert.ok(/worth a timer/i.test(out.speech));
  assert.ok(/Longest wait: step 6/.test(out.datasource.cookalongData.properties.hint));
});

test("buildCookPlan never orders the cook to start the long step first", () => {
  // The soup's 25-minute simmer needs the browning before it, so "start that one
  // first" would be wrong on precisely the recipe where the plan matters most.
  // The line names the step and says it is worth a timer; it does not sequence it.
  const s = freshState();
  R.buildStartCooking("hearty chicken soup", s);
  const out = R.buildCookPlan(s);
  assert.ok(/step 6, 25 minutes/.test(out.speech));
  assert.ok(!/start (?:that|it|this|the long)\b[^.]*\bfirst/i.test(out.speech),
    "the plan reports the long wait, it does not prescribe the order");
});

test("buildCookPlan without a recipe explains how to start one", () => {
  const out = R.buildCookPlan(freshState());
  assert.ok(/cook tomato basil pasta/i.test(out.speech));
  assert.ok(out.reprompt);
});

test("buildCookPlan agrees with SetTimerIntent about what a step is asking for", () => {
  // Both read the same parser. If they ever disagree, the plan is the one on
  // screen, so it would be the one that looked right.
  const s = freshState();
  R.buildStartCooking("creamy mushroom risotto", s);   // longest step: 18 minutes
  const plan = R.buildCookPlan(s);
  assert.ok(/step 5, 18 minutes/.test(plan.speech));
  assert.ok(/set a timer for 18 minutes/.test(plan.reprompt),
    "the reprompt should offer the timer the SetTimerIntent would build");
});

/* ---------------------------- shopping list ----------------------------- */

test("an empty shopping list explains how to fill it rather than reading nothing", () => {
  const out = R.buildShoppingList(freshState());
  assert.ok(out.speech.startsWith("<speak>"));
  assert.ok(/empty/i.test(out.speech));
  assert.ok(/add what's missing/i.test(out.speech));
  assert.ok(out.reprompt);
});

test("naming an ingredient adds a want, with no amount invented for it", () => {
  const s = freshState();
  const out = R.buildAddToShoppingList("parmesan", s);
  assert.strictEqual(s.shoppingList.length, 1);
  assert.strictEqual(s.shoppingList[0].canonical, "cheese",
    "resolved against the same alias table the kitchen panel uses");
  assert.strictEqual(s.shoppingList[0].asNeeded, true, "nobody said how much");
  assert.ok(/added parmesan/i.test(out.speech));
  assert.ok(/1 item/i.test(out.speech));
});

test("the skill refuses to guess what is in the kitchen", () => {
  // Building a list from an assumed kitchen is the one thing this skill never
  // does, because the failure mode is sending someone out to buy what they
  // already have. It asks instead.
  const s = freshState({ recipeId: "tomato-basil-pasta" });
  const out = R.buildAddToShoppingList("", s);
  assert.strictEqual(s.shoppingList, undefined, "nothing may be added on a guess");
  assert.ok(/don't know what is in your kitchen/i.test(out.speech));
  assert.ok(/i have chicken and rice/i.test(out.speech), "and it says how to fix that");
  assert.ok(out.reprompt);
});

test("with a kitchen and a recipe, only what is missing is added", () => {
  const s = freshState({ recipeId: "tomato-basil-pasta", lastHaves: ["pasta", "garlic"] });
  const out = R.buildAddToShoppingList("", s);
  assert.deepStrictEqual(s.shoppingList.map(i => i.canonical).sort(), ["basil", "tomato"],
    "the pasta and the garlic are already owned");
  assert.ok(/added 2 items/i.test(out.speech));
  assert.ok(/crushed tomatoes/i.test(out.speech), "and it names what it added");
});

test("the spoken list and the drawn list cannot disagree about an amount", () => {
  // Both surfaces call the same engine with the same inputs. This is the test
  // that would fail if either side ever grew arithmetic of its own.
  const { itemsToBuy } = require("../src/shopping");
  const { getRecipe } = require("../src/recipes");
  const s = freshState({ recipeId: "garlic-chicken-rice", lastHaves: ["chicken"] });
  R.buildAddToShoppingList("", s);

  const expected = itemsToBuy(getRecipe("garlic-chicken-rice"), { servings: 3, have: ["chicken"] }).items;
  const shape = list => list.map(i => `${i.qty} ${i.name}`).sort();
  assert.deepStrictEqual(shape(s.shoppingList), shape(expected));
  // The chicken is owned and the stock is not a pantry staple in this recipe, so
  // the stock is a genuine purchase that belongs on the list.
  assert.deepStrictEqual(shape(s.shoppingList), ["300g rice", "4 garlic cloves", "600ml chicken stock"]);
});

test("asking twice for the same dish is not doubling the shopping", () => {
  const s = freshState({ recipeId: "garlic-chicken-rice", lastHaves: ["chicken"] });
  R.buildAddToShoppingList("", s);
  const once = s.shoppingList.map(i => `${i.key}=${i.qty}`).sort();
  R.buildAddToShoppingList("", s);
  assert.deepStrictEqual(s.shoppingList.map(i => `${i.key}=${i.qty}`).sort(), once);
});

test("clearing says whether there was anything to clear", () => {
  const s = freshState();
  assert.ok(/already empty/i.test(R.buildClearShoppingList(s).speech));

  R.buildAddToShoppingList("garlic", s);
  const out = R.buildClearShoppingList(s);
  assert.deepStrictEqual(s.shoppingList, []);
  assert.ok(/emptied/i.test(out.speech));
  assert.ok(/1 item removed/i.test(out.speech));
});

test("a recipe with nothing missing says so instead of adding an empty list", () => {
  const s = freshState({
    recipeId: "vegetable-stir-fry",
    lastHaves: ["bell-pepper", "carrot", "broccoli", "rice", "garlic"]
  });
  const out = R.buildAddToShoppingList("", s);
  assert.strictEqual(s.shoppingList, undefined, "nothing to add means nothing added");
  assert.ok(/nothing to add/i.test(out.speech));
});

/* ------------------------------- profile ------------------------------- */

test("buildSetProfile stores diets/allergens and de-duplicates", () => {
  const s = freshState();
  const out = R.buildSetProfile("vegan", "", s, false);
  assert.deepStrictEqual(s.diets, ["vegan"]);
  assert.ok(/saved/i.test(out.speech));
  R.buildSetProfile("vegan", "", s, false);
  assert.deepStrictEqual(s.diets, ["vegan"]);
  R.buildSetProfile("", "shellfish", s, false);
  assert.deepStrictEqual(s.allergens, ["shellfish"]);
});

test("buildSetProfile with empty slots gives guidance", () => {
  const out = R.buildSetProfile("", "", freshState(), false);
  assert.ok(/vegan|allergic/i.test(out.speech));
});

/* ------------------------------ next match ----------------------------- */

test("buildNextMatch cycles through options and keeps an APL list", () => {
  const s = freshState();
  R.buildWhatDoIHave("chicken, rice, garlic", s);
  const first = s.matchIndex;
  const out = R.buildNextMatch(s);
  assert.strictEqual(s.matchIndex, (first + 1) % s.matchIds.length);
  assert.strictEqual(out.document, R.APL.matchResults);
  assert.ok(out.datasource.cookalongData.properties.matches.length >= 1);
});

test("buildNextMatch without prior ingredients prompts for them", () => {
  const out = R.buildNextMatch(freshState());
  assert.ok(/ingredients first/i.test(out.speech));
});

/* ----------------------------- no shopping ------------------------------ */

const { readyNow, matchRecipes, suggest } = require("../src/ingredients");
const { RECIPES } = require("../src/recipes");

const FULL_KITCHEN = ["chicken", "beef", "rice", "pasta", "tomato", "onion", "garlic", "carrot", "potato"];
const STOCKED_FOR_PASTA = ["pasta", "tomato", "garlic", "basil"];

test("buildWhatDoIHave answers with the dish, not with a percentage", () => {
  // The spoken answer used to open "Best match: X, 94 percent match", which is a
  // score. Someone standing at a hob with their hands full needs the dish first.
  const out = R.buildWhatDoIHave(FULL_KITCHEN.join(", "), freshState());
  assert.ok(out.speech.startsWith("<speak>Tonight, cook "), `expected the dish first: ${out.speech}`);
  assert.match(out.speech, /Nothing essential is missing|You have everything/);
});

test("buildWhatDoIHave never announces a dish that still needs a shop", () => {
  // The panel is allowed to list a long shot; the sentence is not allowed to
  // recommend one. suggest() only names a dish with no hard miss, so with only
  // salt and pepper there is no decision to announce.
  const out = R.buildWhatDoIHave("salt, pepper", freshState());
  assert.doesNotMatch(out.speech, /Tonight, cook/, `it announced a decision it cannot back: ${out.speech}`);
  assert.match(out.speech, /best match/i, "it should still name the closest dish");
});

test("a dish short of both kinds says both, and a swap never stands in for a miss", () => {
  // Lemon Garlic Shrimp with only salt and pepper has swappable items (shrimp,
  // lemon, butter) AND hard misses (garlic, scallion, rice). The sentence used to
  // report only the first group — "you are missing shrimp, lemon and butter, but
  // each one has a swap" — and a cook who believed it found three more things to
  // buy. Both halves are said now.
  const out = R.buildWhatDoIHave("salt, pepper", freshState());
  assert.match(out.speech, /still need to buy/i, `the hard misses must be said: ${out.speech}`);
  assert.match(out.speech, /garlic/);
  assert.match(out.speech, /rice/);
});

test("buildReadyNow asks for the kitchen rather than guessing it", () => {
  // Same rule as the shopping list: an assumed kitchen is how you send someone
  // out to buy what they already have.
  const out = R.buildReadyNow(freshState());
  assert.match(out.speech, /don't know what is in your kitchen/i);
  assert.ok(out.reprompt);
});

test("buildReadyNow lists exactly the dishes the engine says need nothing bought", () => {
  const s = freshState({ lastHaves: STOCKED_FOR_PASTA });
  const out = R.buildReadyNow(s);
  const expected = readyNow(matchRecipes(STOCKED_FOR_PASTA, RECIPES));
  assert.ok(expected.length >= 1, "this kitchen must be stocked for at least one dish");
  expected.slice(0, 3).forEach(m => assert.ok(out.speech.includes(m.recipe.name),
    `${m.recipe.name} needs nothing bought but was not spoken: ${out.speech}`));
  assert.deepStrictEqual(s.matchIds, expected.slice(0, 3).map(m => m.recipe.id));
  assert.strictEqual(out.document, R.APL.matchResults);
});

test("buildReadyNow does not call a one-swap dish 'nothing bought'", () => {
  // The distinction the feature exists for. A full-ish kitchen still leaves every
  // dish short of something, so the honest answer is "nothing is fully stocked"
  // plus the dish that is one swap away — not a claim that no shopping is needed.
  assert.strictEqual(readyNow(matchRecipes(FULL_KITCHEN, RECIPES)).length, 0,
    "this kitchen must not be strictly stocked, or the test proves nothing");
  const out = R.buildReadyNow(freshState({ lastHaves: FULL_KITCHEN }));
  assert.match(out.speech, /nothing is fully stocked/i);
  assert.doesNotMatch(out.speech, /nothing bought/i,
    "a swap is still a decision and usually a purchase");
  const pick = suggest(matchRecipes(FULL_KITCHEN, RECIPES)).pick.recipe.name;
  assert.ok(out.speech.includes(pick), `expected the one-swap dish ${pick} in: ${out.speech}`);
});

test("buildReadyNow leaves 'cook it' pointing at the dish it just recommended", () => {
  // Otherwise the natural follow-up to a recommendation is a dead end.
  const s = freshState({ lastHaves: FULL_KITCHEN });
  R.buildReadyNow(s);
  const pick = suggest(matchRecipes(FULL_KITCHEN, RECIPES)).pick;
  assert.deepStrictEqual(s.matchIds, [pick.recipe.id]);
  const started = R.buildStartCooking("it", s);
  assert.ok(started.speech.includes(pick.recipe.name), `"cook it" started the wrong dish: ${started.speech}`);
});

test("buildReadyNow says so plainly when nothing can be cooked without a shop", () => {
  const out = R.buildReadyNow(freshState({ lastHaves: ["salt", "black-pepper"] }));
  assert.match(out.speech, /nothing here can be cooked without a shop/i);
  assert.match(out.speech, /the closest is/i, "and it still names what is closest");
  assert.match(out.speech, /what do I need to buy/i, "and offers the useful next move");
});
