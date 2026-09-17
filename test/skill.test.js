"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { handler } = require("../skill/index");
const BASE_CONTEXT = { System: { device: { supportedInterfaces: {} }, apiEndpoint: "https://api.amazonalexa.com" } };
function envelope(type, sessionAttrs, request) {
  return { version: "1.0", session: { new: false, sessionId: "amzn1.echo-api.session.test", attributes: sessionAttrs || {} }, context: BASE_CONTEXT, request };
}
function launchRequest() {
  return envelope("LaunchRequest", null, { type: "LaunchRequest", requestId: "req-launch", timestamp: "2026-01-01T00:00:00Z", locale: "en-US" });
}
function intentRequest(sessionAttrs, name, slots = {}) {
  const slotMap = {};
  for (const [key, value] of Object.entries(slots)) slotMap[key] = { name: key, value };
  return envelope("IntentRequest", sessionAttrs, { type: "IntentRequest", requestId: `req-${name}`, timestamp: "2026-01-01T00:00:00Z", locale: "en-US", intent: { name, confirmationStatus: "NONE", slots: slotMap } });
}
function speakText(response) {
  const out = response.response && response.response.outputSpeech;
  return (out && (out.ssml || out.text)) || "";
}
function invoke(event) {
  return new Promise((resolve, reject) => { handler(event, {}, (err, res) => (err ? reject(err) : resolve(res))); });
}
test("LaunchRequest welcomes the user and offers the ways in", async () => {
  const res = await invoke(launchRequest());
  const text = speakText(res);
  assert.match(text, /Welcome to CookAlong TV/);
  assert.match(text, /10 hands-free recipes/);
  assert.match(text, /I have chicken and rice/);
});
test("StartCookingIntent starts a known recipe at step 1", async () => {
  const res = await invoke(intentRequest(null, "StartCookingIntent", { recipe: "tomato basil pasta" }));
  const text = speakText(res);
  assert.match(text, /Step 1 of 7/);
  assert.match(text, /Boil salted water/);
});
test("StartCookingIntent handles unknown recipe gracefully", async () => {
  const res = await invoke(intentRequest(null, "StartCookingIntent", { recipe: "sushi" }));
  assert.match(speakText(res), /couldn't find a recipe called sushi/);
});
test("NextStepIntent advances to step 2 using session state", async () => {
  const start = await invoke(intentRequest(null, "StartCookingIntent", { recipe: "tomato basil pasta" }));
  const attrs = start.sessionAttributes || {};
  const next = await invoke(intentRequest(attrs, "NextStepIntent"));
  assert.match(speakText(next), /Step 2 of 7/);
});
test("NextStepIntent without an active recipe asks to start first", async () => {
  const res = await invoke(intentRequest(null, "NextStepIntent"));
  assert.match(speakText(res), /have not started a recipe/);
});
test("SetTimerIntent accepts an ISO-8601 AMAZON.DURATION slot", async () => {
  const res = await invoke(intentRequest(null, "SetTimerIntent", { duration: "PT5M" }));
  assert.match(speakText(res), /Timer set for 5 minutes/);
});
test("SetTimerIntent accepts natural language", async () => {
  const res = await invoke(intentRequest(null, "SetTimerIntent", { duration: "90 seconds" }));
  assert.match(speakText(res), /Timer set for 1 minute and 30 seconds/);
});
test("SetTimerIntent with invalid duration asks again", async () => {
  const res = await invoke(intentRequest(null, "SetTimerIntent", { duration: "sometime" }));
  assert.match(speakText(res), /didn't catch the time/);
});
test("DietFilterIntent lists matching recipes", async () => {
  const res = await invoke(intentRequest(null, "DietFilterIntent", { diet: "vegan" }));
  const text = speakText(res);
  assert.match(text, /vegan recipes/);
  assert.match(text, /Tomato Basil Pasta/);
});
test("HelpIntent explains the capabilities", async () => {
  const res = await invoke(intentRequest(null, "AMAZON.HelpIntent"));
  assert.match(speakText(res), /hands-free/);
});
