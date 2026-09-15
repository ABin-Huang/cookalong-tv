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
