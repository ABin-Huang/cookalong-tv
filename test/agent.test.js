"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

const A = require("../src/agent");
const I = require("../src/ingredients");
const P = require("../src/plan");
const { RECIPES } = require("../src/recipes");

/**
 * A kitchen with plenty in it. Not every recipe's, just a plausible fridge — the
 * point of most of these tests is what the agent does with a real ranking, not
 * that it is handed a perfect kitchen.
 */
const STOCKED = ["chicken", "garlic", "rice", "onion", "tomato", "eggs", "olive oil", "soy sauce"];

const everyIngredient = recipe => (recipe.ingredients || []).map(i => i.canonical);

/** What the kitchen panel would put on the card, computed the same way. */
function panelDecision(have, profile, avoid) {
  const matches = I.matchRecipes(have, RECIPES, profile);
  return I.suggest(matches, { avoid: avoid || [] });
}

/**
 * A kitchen where nothing at all is cookable with no shopping, but the best dish
 * is exactly one swap from being so.
 *
 * Searched rather than hard-coded, because it is a property of the catalogue
 * rather than of one recipe: an edit to any recipe's ingredients can move it, and
 * a test that hard-codes it would either break for the wrong reason or, worse,
 * quietly stop testing the case it was written for.
 */
function kitchenOneSwapAway() {
  for (const recipe of RECIPES) {
    for (const dropped of recipe.ingredients) {
      const have = everyIngredient(recipe).filter(c => c !== dropped.canonical);
      const matches = I.matchRecipes(have, RECIPES);
      if (I.readyNow(matches).length) continue;          // something IS ready — not this case
      const best = I.suggest(matches, {});
      if (best && best.pick.missingHard.length === 0 && best.pick.missingSubstitutable.length > 0) {
        return { have, expected: best.pick };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// it composes rather than deciding for itself
// ---------------------------------------------------------------------------

test("the dish is the head of the ranking the kitchen panel shows, not a second opinion", () => {
  // The whole point of the conductor is that it does not rank. If it did, the TV
  // could name one dish and the panel another, and nothing would say which was
  // right — the exact drift the single `suggest()` call exists to prevent.
  const myKitchens = [
    STOCKED,
    ["rice", "onion"],
    everyIngredient(RECIPES[0]),
    [],
  ];
  myKitchens.forEach(have => {
    const decided = panelDecision(have, {});
    const composed = A.compose("dinner", { have, recipes: RECIPES, lang: "en-US" });
    if (decided) {
      assert.ok(composed.ok, `the panel decided (${decided.pick.recipe.name}) so the agent cannot refuse`);
      assert.strictEqual(composed.recipe.id, decided.pick.recipe.id,
        "the agent picked a different dish from the panel");
    } else {
      assert.ok(!composed.ok, "the panel refused, so the agent must refuse too");
    }
  });
});

test("the clock it reports is the plan engine's own summary", () => {
  const composed = A.compose("dinner", { have: STOCKED, recipes: RECIPES, lang: "en-US" });
  assert.ok(composed.ok, "a stocked kitchen has to produce a decision");
  const summary = P.summary(composed.recipe.steps);
  assert.strictEqual(composed.clock.timedCount, summary.timedCount);
  assert.strictEqual(composed.clock.totalCount, summary.totalCount);
  assert.strictEqual(composed.clock.namedSeconds, summary.namedSeconds);
  if (summary.longest) {
    assert.strictEqual(composed.clock.longest.seconds, summary.longest.seconds);
    assert.strictEqual(composed.clock.longest.index, summary.longest.index);
  }
});

test("the shopping it plans is the list engine's own count", () => {
  const composed = A.compose("dinner", { have: STOCKED, recipes: RECIPES, lang: "en-US" });
  const own = require("../src/shopping").itemsToBuy(composed.recipe, {
    servings: composed.recipe.serves,
    have: STOCKED,
  });
  assert.strictEqual(composed.shopping.count, own.items.length,
    "the agent counted a different purchase from the one the list would build");
});

test("working out a job changes nothing, and two runs of it agree", () => {
  // `compose` is the half that decides; `steps` is the half that acts, and the
  // app only runs it after the cook says yes. That separation is only real if
  // composing is free of side effects — so the same kitchen has to produce the
  // same plan, twice.
  const ctx = { have: STOCKED.slice(), recipes: RECIPES, lang: "en-US" };
  const before = JSON.stringify(ctx);
  const first = A.compose("dinner", ctx);
  const second = A.compose("dinner", ctx);
  assert.deepStrictEqual(first, second, "two identical kitchens produced two different plans");
  assert.strictEqual(JSON.stringify(ctx), before, "composing mutated the situation it was handed");
});

test("a fully stocked kitchen is always decidable, for every recipe", () => {
  // A sweep rather than a spot check: if any dish in the catalogue cannot be
  // decided when the cook owns everything it asks for, the ranking has a hole
  // and the agent would refuse a kitchen that is objectively perfect.
  RECIPES.forEach(recipe => {
    const composed = A.compose("dinner", { have: everyIngredient(recipe), recipes: RECIPES, lang: "en-US" });
    assert.ok(composed.ok,
      `owning everything ${recipe.name} needs still produced no decision`);
    assert.strictEqual((composed.match.missingHard || []).length, 0,
      `the decision for ${recipe.name} is missing something essential`);
  });
});

// ---------------------------------------------------------------------------
// it never starts a clock
// ---------------------------------------------------------------------------

test("the plan carries no timer, for any kitchen", () => {
  // Starting a clock on the cook's behalf is the one side effect this agent is
  // forbidden. An 18-minute braise armed while the onions are still being
  // chopped expires unattended, and on a Fire TV — which has no installed voice
  // — it expires in silence.
  const kitchens = [STOCKED, [], ["rice"], everyIngredient(RECIPES[3])];
  kitchens.forEach(have => {
    const composed = A.compose("dinner", { have, recipes: RECIPES, lang: "en-US" });
    const kinds = (composed.steps || []).map(s => s.do);
    assert.ok(kinds.every(k => k === "open" || k === "shop"),
      `the plan does something other than open and shop: ${kinds.join(", ")}`);
  });
});

test("and it says out loud that it did not start one", () => {
  const composed = A.compose("dinner", { have: STOCKED, recipes: RECIPES, lang: "en-US" });
  assert.ok(composed.clock.timedCount > 0, "this kitchen's dish should have a timed step to talk about");
  const done = A.done(composed, "en-US").say;
  assert.match(done, /have not started it/,
    "the agent has to say the clock was not started, or a cook waits for a timer that is not running");
  assert.match(done, /step \d+/, "it has to say which step the wait is on");
});

// ---------------------------------------------------------------------------
// "use it up" is a different objective, and refuses rather than downgrading
// ---------------------------------------------------------------------------

test("use-it-up only ever picks a dish that needs nothing bought at all", () => {
  const composed = A.compose("dinner", { have: STOCKED, recipes: RECIPES, lang: "en-US" });
  const matches = I.matchRecipes(STOCKED, RECIPES, undefined);
  const ready = I.readyNow(matches);
  const useUp = A.compose("use-it-up", { have: STOCKED, recipes: RECIPES, lang: "en-US" });
  if (useUp.ok) {
    assert.ok(I.isReadyNow(useUp.match), "use-it-up returned a dish that still needs something");
    assert.ok(ready.some(m => m.recipe.id === useUp.recipe.id),
      "the dish returned is not one of the ready-now dishes");
  }
  // It is allowed to refuse here — most kitchens have nothing that is complete.
  // What it is not allowed to do is answer with the general decision instead.
  if (!useUp.ok) {
    assert.ok(composed.ok, "the general job could decide, so the refusal is specifically about zero shopping");
    assert.ok(useUp.recipe === null, "a refused job must not carry a dish");
  }
});

test("use-it-up refuses rather than quietly answering the easier question", () => {
  const found = kitchenOneSwapAway();
  assert.ok(found, "no kitchen in the catalogue is one swap from complete — this test needs rewriting");
  const composed = A.compose("use-it-up", { have: found.have, recipes: RECIPES, lang: "en-US" });
  assert.strictEqual(composed.ok, false, "one swap away is not nothing to buy");
  assert.strictEqual(composed.reason, "nothing-ready");
  const say = A.propose(composed, "en-US").say;
  assert.match(say, /one swap away/,
    "a refusal that does not say how close it is leaves the cook with nothing to do next");
});

// ---------------------------------------------------------------------------
// a refusal has to be honest about how far off the nearest dish is
// ---------------------------------------------------------------------------

test("a dish three ingredients short is not described as one swap away", () => {
  // "One swap away" is a decision; "still three short" is a shopping trip.
  // Calling the second the first is the over-claim this whole codebase refuses
  // to make, so the wording is asserted rather than trusted.
  const composed = A.compose("dinner", { have: [], recipes: RECIPES, lang: "en-US" });
  assert.strictEqual(composed.ok, false);
  assert.ok(composed.closest, "an empty kitchen still has a nearest dish worth naming");
  const hard = (composed.closest.missingHard || []).length;
  const swappable = (composed.closest.missingSubstitutable || []).length;
  const say = A.propose(composed, "en-US").say;
  assert.ok(hard > 0 || swappable > 0, "the nearest dish in an empty kitchen cannot be complete");
  if (hard > 0) {
    assert.match(say, new RegExp(`still ${hard} short`), "a hard miss must be reported as one");
    assert.ok(!/one swap away/.test(say), "a hard miss must never be called one swap away");
  }
});

test("a refusal still names a dish, so the turn is worth taking", () => {
  const composed = A.compose("dinner", { have: [], recipes: RECIPES, lang: "en-US" });
  const say = A.propose(composed, "en-US").say;
  assert.ok(composed.closest && composed.closest.recipe, "there should be a nearest dish");
  assert.ok(say.includes(composed.closest.recipe.name),
    "the refusal has to name the closest dish rather than only say no");
});

test("a missing catalogue is refused in words, not by throwing", () => {
  ["nope", null].forEach(goal => {
    const c = A.compose(goal, { have: STOCKED, recipes: RECIPES, lang: "en-US" });
    assert.strictEqual(c.ok, false);
    assert.ok(A.propose(c, "en-US").say.length > 10, "every refusal has to be sayable");
  });
  const noRecipes = A.compose("dinner", { have: STOCKED, recipes: [], lang: "en-US" });
  assert.strictEqual(noRecipes.ok, false);
  assert.strictEqual(noRecipes.reason, "no-recipes");
  assert.ok(A.propose(noRecipes, "en-US").say.length > 10);
});

// ---------------------------------------------------------------------------
// the cook's diet and allergies survive the whole chain
// ---------------------------------------------------------------------------

test("no dish the agent proposes can carry an allergen the cook is avoiding", () => {
  // The safest thing the agent could do about an allergy is refuse everything.
  // The second safest is to propose a dish that contains it. This asserts the
  // pick is never the second thing, for every allergen the app knows about.
  I.COMMON_ALLERGENS.forEach(allergen => {
    const composed = A.compose("dinner", {
      have: STOCKED,
      recipes: RECIPES,
      profile: { allergens: [allergen] },
      lang: "en-US",
    });
    if (!composed.ok) return;
    const carried = I.recipeAllergens(composed.recipe);
    assert.ok(!carried.includes(allergen),
      `the agent proposed ${composed.recipe.name}, which carries ${allergen}`);
  });
});

test("a diet filter narrows the decision the same way it narrows the list", () => {
  ["vegan", "vegetarian", "gluten-free"].forEach(diet => {
    const composed = A.compose("dinner", {
      have: STOCKED,
      recipes: RECIPES,
      profile: { diets: [diet] },
      lang: "en-US",
    });
    if (!composed.ok) return;
    assert.ok(I.recipeSatisfiesDiets(composed.recipe, [diet]),
      `${composed.recipe.name} does not satisfy the ${diet} filter the cook set`);
  });
});

// ---------------------------------------------------------------------------
// it says all of this in the cook's own language
// ---------------------------------------------------------------------------

test("both languages say the whole thing, and they are not the same words", () => {
  const composed = A.compose("dinner", { have: STOCKED, recipes: RECIPES, lang: "en-US" });
  const en = A.propose(composed, "en-US");
  const zh = A.propose(composed, "zh-CN");
  [["en", en], ["zh", zh]].forEach(([label, r]) => {
    assert.ok(r.say.length > 40, `${label} proposal is too short to contain a plan`);
    assert.ok(r.status.length > 5, `${label} status is missing`);
  });
  assert.notStrictEqual(en.say, zh.say, "the two languages produced identical wording");

  const enDone = A.done(composed, "en-US").say;
  const zhDone = A.done(composed, "zh-CN").say;
  assert.notStrictEqual(enDone, zhDone);
  assert.match(zhDone, /我没有帮你启动/, "the Chinese answer must also say the clock was not started");
});

test("durations are spoken in the cook's language", () => {
  assert.strictEqual(A.speakDuration(1080, "en-US"), "18 minutes");
  assert.strictEqual(A.speakDuration(1080, "zh-CN"), "18 分钟");
  assert.strictEqual(A.speakDuration(90, "en-US"), "1 minute and 30 seconds");
  assert.strictEqual(A.speakDuration(90, "zh-CN"), "1 分钟30 秒");
});

// ---------------------------------------------------------------------------
// which job a cook is asking for
// ---------------------------------------------------------------------------

test("every goal is reachable by every phrase it teaches", () => {
  A.GOALS.forEach(goal => {
    [goal.say].concat(goal.samples || []).forEach(phrase => {
      const hit = A.findGoal(phrase);
      assert.ok(hit && hit.id === goal.id, `"${phrase}" should be the ${goal.id} job`);
    });
    [goal.cn.say].concat(goal.cn.samples || []).forEach(phrase => {
      const hit = A.findGoal(phrase);
      assert.ok(hit && hit.id === goal.id, `"${phrase}" should be the ${goal.id} job in Chinese`);
    });
  });
});

test("an ordinary kitchen question is not a job", () => {
  // The jobs sit above the kitchen matcher in the command table, so this is the
  // boundary that keeps them from swallowing it.
  ["what can i cook with chicken", "what s in my kitchen", "i have eggs and rice"]
    .forEach(phrase => assert.strictEqual(A.findGoal(phrase), null,
      `"${phrase}" is a question, not a job to be done`));
});
