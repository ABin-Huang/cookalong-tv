"use strict";

/**
 * The contract between the interaction model and the Lambda.
 *
 * Every intent that models/en-US.json declares must be answered by a handler,
 * never by the ErrorHandler. This is the regression guard for a real bug:
 * responses.js implemented the whole "what's in my kitchen" half of the skill,
 * but index.js never required responses.js — so 7 declared intents replied
 * "Sorry, something went wrong" on a real device, while every unit test in this
 * repo stayed green because each side was tested in isolation.
 */

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { handler } = require("../skill/index");
const MODEL = require("../skill/models/en-US.json");

const BASE_CONTEXT = {
  System: { device: { supportedInterfaces: {} }, apiEndpoint: "https://api.amazonalexa.com" }
};
const ERROR_SPEECH = /something went wrong/i;

function envelope(sessionAttrs, request) {
  return {
    version: "1.0",
    session: { new: false, sessionId: "amzn1.echo-api.session.contract", attributes: sessionAttrs || {} },
    context: BASE_CONTEXT,
    request
  };
}

function intentRequest(sessionAttrs, name, slots = {}) {
  const slotMap = {};
  for (const [key, value] of Object.entries(slots)) slotMap[key] = { name: key, value };
  return envelope(sessionAttrs, {
    type: "IntentRequest",
    requestId: `req-${name}`,
    timestamp: "2026-01-01T00:00:00Z",
    locale: "en-US",
    intent: { name, confirmationStatus: "NONE", slots: slotMap }
  });
}

function speakText(response) {
  const out = response.response && response.response.outputSpeech;
  return ((out && (out.ssml || out.text)) || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function invoke(event) {
  return new Promise((resolve, reject) => handler(event, {}, (err, res) => (err ? reject(err) : resolve(res))));
}

/** A plausible value per slot type, so a missing slot is never what fails. */
const SAMPLE_SLOTS = {
  recipe: "tomato basil pasta",
  ingredients: "chicken, garlic and rice",
  ingredient: "parmesan",
  duration: "PT5M",
  diet: "vegan",
  allergen: "dairy"
};

function modelIntents() {
  return MODEL.interactionModel.languageModel.intents;
}

function slotsFor(intentName) {
  const intent = modelIntents().find(i => i.name === intentName);
  const slots = {};
  (intent.slots || []).forEach(s => {
    if (SAMPLE_SLOTS[s.name] !== undefined) slots[s.name] = SAMPLE_SLOTS[s.name];
  });
  return slots;
}

test("every custom intent declared in the interaction model appears in index.js", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "skill", "index.js"), "utf8");
  const missing = modelIntents()
    .map(i => i.name)
    .filter(name => !name.startsWith("AMAZON."))
    .filter(name => !source.includes(`"${name}"`));
  assert.deepEqual(missing, [], `declared in the model but unhandled in index.js: ${missing.join(", ")}`);
});

test("no declared intent falls through to the error handler", async () => {
  const failures = [];
  for (const intent of modelIntents()) {
    // A fresh session per intent: these are independent first turns.
    const res = await invoke(intentRequest(null, intent.name, slotsFor(intent.name)));
    const text = speakText(res);
    if (!text) failures.push(`${intent.name}: no speech`);
    else if (ERROR_SPEECH.test(text)) failures.push(`${intent.name}: ${text}`);
  }
  assert.deepEqual(failures, [], `intents answered with the error handler:\n  ${failures.join("\n  ")}`);
});

test("the kitchen half of the skill is actually reachable", async () => {
  const res = await invoke(intentRequest(null, "WhatDoIHaveIntent", { ingredients: "chicken, garlic and rice" }));
  const text = speakText(res);
  assert.match(text, /match/i, `expected a match answer, got: ${text}`);
  assert.doesNotMatch(text, ERROR_SPEECH);
});

test("ReadyNowIntent is reachable end to end, and remembers the kitchen", async () => {
  // The whole path a real device walks: the model routes the utterance, index.js
  // maps it, responses.js answers — and the second turn still knows the kitchen
  // from the first, because a cook who just said what they have should not be
  // asked again. A handler wired to a builder nobody exported fails here.
  const ask = await invoke(intentRequest(null, "WhatDoIHaveIntent", { ingredients: "pasta, tomato, garlic and basil" }));
  const res = await invoke(intentRequest(ask.sessionAttributes || {}, "ReadyNowIntent"));
  const text = speakText(res);
  assert.doesNotMatch(text, ERROR_SPEECH);
  assert.match(text, /nothing bought/i, `expected the no-shopping answer, got: ${text}`);
  assert.match(text, /Tomato Basil Pasta/, `expected the stocked dish, got: ${text}`);
});

test("SetTimerIntent falls back to the current step's own cooking time", async () => {
  const start = await invoke(intentRequest(null, "StartCookingIntent", { recipe: "garlic chicken rice" }));
  const attrs = start.sessionAttributes || {};
  // Walk to the step that says "cook on low for 18 minutes".
  let session = attrs;
  for (let i = 0; i < 5; i += 1) {
    const next = await invoke(intentRequest(session, "NextStepIntent"));
    session = next.sessionAttributes || session;
  }
  const res = await invoke(intentRequest(session, "SetTimerIntent", {}));
  const text = speakText(res);
  assert.match(text, /This step takes about 18 minutes/i, `got: ${text}`);
  assert.match(text, /Timer set for 18 minutes/i, `got: ${text}`);
});

test("PreviousStepIntent walks back and does not repeat", async () => {
  const start = await invoke(intentRequest(null, "StartCookingIntent", { recipe: "tomato basil pasta" }));
  const next = await invoke(intentRequest(start.sessionAttributes || {}, "NextStepIntent"));
  const back = await invoke(intentRequest(next.sessionAttributes || {}, "PreviousStepIntent"));
  assert.match(speakText(back), /Step 1 of 7/);
});
