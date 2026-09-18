"use strict";

/**
 * What the skill remembers after the cook stops talking.
 *
 * An Alexa session ends the moment the conversation pauses, so the interesting
 * behaviour is not "does it save" but what it saves, what it refuses to save,
 * and what comes back. Every test here is written against a fake attributes
 * manager rather than a real DynamoDB table, because the decision being tested
 * is in persistence.js — the table is just where the answer is put.
 */

const { test } = require("node:test");
const assert = require("node:assert");

const P = require("../skill/persistence");
const R = require("../skill/responses");
const { handler } = require("../skill/index");
const MODEL = require("../skill/models/en-US.json");
const { getRecipe } = require("../src/recipes");

/**
 * Stands in for the SDK's AttributesManager: session attributes in, persistent
 * attributes out, with `stored` playing the part of the table.
 */
function fakeAttributes(sessionAttrs, stored) {
  return {
    stored: stored || null,
    written: null,
    getSessionAttributes() { return sessionAttrs; },
    async getPersistentAttributes() { return this.stored || {}; },
    setPersistentAttributes(attrs) { this.written = attrs; },
    async savePersistentAttributes() { this.stored = this.written; }
  };
}

function storeFor(holder, tableName = "cookalong-profiles") {
  return P.createPersistence({ tableName, sessionOf: () => holder.session });
}

/* ------------------------------- the shape ------------------------------- */

test("a snapshot keeps the kitchen, the profile and the dish — and drops the tail of the last exchange", () => {
  const snap = P.snapshot({
    diets: ["vegan"],
    allergens: ["dairy"],
    lastHaves: ["pasta", "tomato"],
    recipeId: "tomato-basil-pasta",
    step: 2,
    swaps: { basil: { name: "dried basil" } },
    // The tail of one spoken exchange. Reviving this tomorrow would make
    // "cook it" start a dish nobody just discussed.
    matchIds: ["garlic-chicken-rice"],
    matchIndex: 1,
    awaitingCook: true,
    timer: { seconds: 300 }
  });
  assert.deepEqual(Object.keys(snap).sort(),
    ["allergens", "diets", "lastHaves", "recipeId", "step", "swaps"]);
  assert.equal("matchIds" in snap, false);
  assert.equal("awaitingCook" in snap, false);
  assert.equal("timer" in snap, false);
});

test("restore applies what was remembered and ignores everything else", () => {
  const session = { diets: ["vegan"] };
  const applied = P.restore(session, {
    allergens: ["dairy"],
    recipeId: "tomato-basil-pasta",
    matchIds: ["nope"],
    somethingElse: 1
  });
  assert.deepEqual(applied.sort(), ["allergens", "recipeId"]);
  assert.deepEqual(session.diets, ["vegan"], "an unmentioned value is left alone");
  assert.equal(session.matchIds, undefined);
  assert.equal(session.somethingElse, undefined);
});

/* ------------------------------ on and off ------------------------------- */

test("with no table configured nothing is read and nothing is written", async () => {
  const holder = { session: { diets: ["vegan"] } };
  const store = storeFor(holder, "");
  const attrs = fakeAttributes({ cookalong: holder.session }, { state: { allergens: ["dairy"] } });
  assert.equal(store.enabled, false);
  await store.save.process({ attributesManager: attrs });
  await store.load.process({ attributesManager: attrs });
  assert.equal(attrs.written, null);
  assert.equal(holder.session.allergens, undefined, "an unconfigured skill stays session-only");
});

test("an empty session writes nothing, so it cannot erase the profile the last one saved", async () => {
  const attrs = fakeAttributes({ cookalong: {} }, { state: { allergens: ["dairy"], diets: ["vegan"] } });
  const store = storeFor({ session: {} });
  await store.save.process({ attributesManager: attrs });
  assert.equal(attrs.written, null, "an empty session must not overwrite the table");
  assert.deepEqual(attrs.stored, { state: { allergens: ["dairy"], diets: ["vegan"] } });
});

test("a table that is missing, or a role that lost its permission, does not take the skill down", async () => {
  const holder = { session: { diets: ["vegan"] } };
  const store = storeFor(holder);
  const attrs = fakeAttributes({ cookalong: holder.session }, null);
  attrs.getPersistentAttributes = async () => { throw new Error("ResourceNotFoundException"); };
  await store.load.process({ attributesManager: attrs });   // must not throw
  attrs.savePersistentAttributes = async () => { throw new Error("AccessDenied"); };
  await store.save.process({ attributesManager: attrs });   // must not throw
});

/* ------------------------------- round trip ------------------------------ */

test("a profile and a dish survive the gap between two sessions", async () => {
  const first = {
    session: {
      diets: ["vegan"],
      allergens: ["dairy"],
      lastHaves: ["pasta", "tomato"],
      recipeId: "tomato-basil-pasta",
      step: 3,
      swaps: { basil: { name: "dried basil" } },
      matchIds: ["garlic-chicken-rice"]
    }
  };
  const attrs = fakeAttributes({}, null);
  await storeFor(first).save.process({ attributesManager: attrs });
  assert.ok(attrs.stored && attrs.stored.state, "the write reached the table");

  // A brand-new session, hours later.
  const second = { session: {} };
  await storeFor(second).load.process({ attributesManager: attrs });
  assert.deepEqual(second.session.diets, ["vegan"]);
  assert.deepEqual(second.session.allergens, ["dairy"], "the allergy is the one that must not be forgotten");
  assert.deepEqual(second.session.lastHaves, ["pasta", "tomato"]);
  assert.equal(second.session.recipeId, "tomato-basil-pasta");
  assert.equal(second.session.step, 3);
  assert.deepEqual(second.session.swaps, { basil: { name: "dried basil" } });
  assert.equal(second.session.matchIds, undefined, "the stale match list is not revived");
});

/* --------------------------- what launch offers -------------------------- */

test("a finished dish is not something to resume", () => {
  const recipe = getRecipe("tomato-basil-pasta");
  assert.equal(R.resumableCook({}), null);
  assert.equal(R.resumableCook({ recipeId: "not-a-recipe", step: 1 }), null);
  assert.equal(
    R.resumableCook({ recipeId: "tomato-basil-pasta", step: recipe.steps.length - 1 }),
    null,
    "the last step means the dish is done, not paused"
  );
  const at = R.resumableCook({ recipeId: "tomato-basil-pasta", step: 2 });
  assert.equal(at.step, 2);
  assert.equal(at.total, recipe.steps.length);
  assert.equal(at.recipe.name, "Tomato Basil Pasta");
});

test("launch hands back the interrupted dish instead of wiping it", () => {
  const session = { recipeId: "tomato-basil-pasta", step: 2, diets: ["vegan"] };
  const out = R.buildLaunch(session);
  assert.match(out.speech, /Welcome back/);
  assert.match(out.speech, /step 3 of 7/);
  assert.match(out.speech, /Tomato Basil Pasta/);
  assert.match(out.speech, /keep cooking/);
  assert.match(out.speech, /vegan/, "the profile is still named on the way in");
  assert.equal(session.recipeId, "tomato-basil-pasta", "launch must not clear a cook that came back");
});

test("launch still starts clean when there is nothing to come back to", () => {
  const session = { recipeId: "tomato-basil-pasta", step: 6 };
  const out = R.buildLaunch(session);
  assert.match(out.speech, /Welcome to CookAlong TV/);
  assert.doesNotMatch(out.speech, /Welcome back/);
  assert.equal(session.recipeId, null);
  assert.equal(session.step, 0);
});

test("keep cooking speaks the step the cook was on, with the swaps still applied", () => {
  const swaps = { basil: { name: "dried basil", note: "use a third as much" } };
  const session = { recipeId: "tomato-basil-pasta", step: 2, swaps };
  const out = R.buildContinueCooking(session);
  const expected = R.rewrittenSteps(getRecipe("tomato-basil-pasta"), swaps)[2];
  assert.ok(out.speech.includes(expected), `expected the resumed step text in: ${out.speech}`);
  assert.match(out.speech, /Back to Tomato Basil Pasta, step 3 of 7/);
  assert.match(out.speech, /swaps are still applied/);
  assert.ok(out.document, "the cooking screen comes back up with it");
});

test("keep cooking with nothing in progress says so rather than inventing a dish", () => {
  const out = R.buildContinueCooking({});
  assert.match(out.speech, /no recipe in progress/i);
  assert.equal(out.document, undefined);
});

/* ------------------------- through the real handler ---------------------- */

const BASE_CONTEXT = {
  System: { device: { supportedInterfaces: {} }, apiEndpoint: "https://api.amazonalexa.com" }
};

function intentRequest(sessionAttrs, name, slots = {}) {
  const slotMap = {};
  for (const [key, value] of Object.entries(slots)) slotMap[key] = { name: key, value };
  return {
    version: "1.0",
    session: { new: false, sessionId: "amzn1.echo-api.session.memory", attributes: sessionAttrs || {} },
    context: BASE_CONTEXT,
    request: {
      type: "IntentRequest",
      requestId: `req-${name}`,
      timestamp: "2026-01-01T00:00:00Z",
      locale: "en-US",
      intent: { name, confirmationStatus: "NONE", slots: slotMap }
    }
  };
}

function invoke(event) {
  return new Promise((resolve, reject) => handler(event, {}, (err, res) => (err ? reject(err) : resolve(res))));
}

function speakText(response) {
  const out = response.response && response.response.outputSpeech;
  return ((out && (out.ssml || out.text)) || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

test("a cook who walked away mid-recipe is put back on the same step", async () => {
  // The whole point of the table: three turns before the pause...
  const start = await invoke(intentRequest(null, "StartCookingIntent", { recipe: "tomato basil pasta" }));
  const one = await invoke(intentRequest(start.sessionAttributes, "NextStepIntent"));
  const two = await invoke(intentRequest(one.sessionAttributes, "NextStepIntent"));
  assert.match(speakText(two), /Step 3 of 7/);

  // ...the session ends, and what lands in the table is taken from the handler's
  // own session attributes rather than from a hand-built object.
  const saved = P.snapshot(two.sessionAttributes.cookalong);
  assert.equal(saved.recipeId, "tomato-basil-pasta");
  assert.equal(saved.step, 2);

  // ...and the next session picks it up with no memory of its own.
  const fresh = { cookalong: {} };
  P.restore(fresh.cookalong, saved);
  const out = await invoke(intentRequest(fresh, "ContinueCookingIntent"));
  const text = speakText(out);
  assert.match(text, /Back to Tomato Basil Pasta, step 3 of 7/, `got: ${text}`);
  assert.doesNotMatch(text, /have not started/i);
});

test("the interaction model actually routes the phrase the demo says out loud", () => {
  const intents = MODEL.interactionModel.languageModel.intents;
  const keep = intents.find(i => i.name === "ContinueCookingIntent");
  assert.ok(keep, "ContinueCookingIntent is declared");
  assert.ok(keep.samples.includes("keep cooking"));
});
