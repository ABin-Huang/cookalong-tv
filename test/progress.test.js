"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

const P = require("../src/progress");

test("serialize keeps the recipe, the step and the swaps", () => {
  const snap = P.serialize({
    recipeId: "garlic-chicken-rice",
    step: 3,
    swaps: { cheese: { name: "nutritional yeast", note: "same amount" } },
    at: 1700000000000,
  });
  assert.deepStrictEqual(snap, {
    v: 1,
    recipeId: "garlic-chicken-rice",
    step: 3,
    swaps: { cheese: { name: "nutritional yeast", note: "same amount" } },
    at: 1700000000000,
  });
});

test("serialize refuses a snapshot with no recipe to remember", () => {
  assert.strictEqual(P.serialize({ step: 3 }), null);
  assert.strictEqual(P.serialize({ recipeId: "   " }), null);
  assert.strictEqual(P.serialize(), null);
});

test("a negative or non-numeric step falls back to the first step", () => {
  assert.strictEqual(P.serialize({ recipeId: "a", step: -4 }).step, 0);
  assert.strictEqual(P.serialize({ recipeId: "a", step: "x" }).step, 0);
  assert.strictEqual(P.serialize({ recipeId: "a", step: NaN }).step, 0);
  assert.strictEqual(P.serialize({ recipeId: "a", step: 2.9 }).step, 2);
});

test("a swap with no replacement name is dropped", () => {
  // Carrying it would render "swap applied" beside step text that still names
  // the original ingredient — a claim the UI cannot back up.
  const snap = P.serialize({
    recipeId: "a",
    step: 1,
    swaps: { cheese: { name: "   " }, milk: { name: "oat milk" }, butter: null },
  });
  assert.deepStrictEqual(Object.keys(snap.swaps), ["milk"]);
  assert.deepStrictEqual(snap.swaps.milk, { name: "oat milk" });
});

test("swaps are capped so one bad record cannot bloat storage", () => {
  const swaps = {};
  for (let i = 0; i < 60; i += 1) swaps[`ing-${i}`] = { name: `swap-${i}` };
  assert.strictEqual(Object.keys(P.serialize({ recipeId: "a", step: 1, swaps }).swaps).length, 40);
});

test("a snapshot survives a JSON round-trip", () => {
  const original = P.serialize({
    recipeId: "tofu-scramble", step: 2, swaps: { egg: { name: "tofu" } }, at: 5,
  });
  assert.deepStrictEqual(P.deserialize(JSON.stringify(original)), original);
});

test("deserialize rejects junk instead of throwing", () => {
  assert.strictEqual(P.deserialize(null), null);
  assert.strictEqual(P.deserialize(""), null);
  assert.strictEqual(P.deserialize("{not json"), null);
  assert.strictEqual(P.deserialize("[]"), null);
  assert.strictEqual(P.deserialize('"a string"'), null);
  assert.strictEqual(P.deserialize("42"), null);
  assert.strictEqual(P.deserialize({ step: 3 }), null);
  assert.strictEqual(
    P.deserialize(JSON.stringify({ recipeId: "a", step: 3 })),
    null,
    "a version-less record is not ours to guess at"
  );
});

test("a future version is ignored rather than half-read", () => {
  assert.strictEqual(P.deserialize(JSON.stringify({ v: 99, recipeId: "a", step: 3 })), null);
});

test("deserialize also accepts an already-parsed object", () => {
  const snap = P.deserialize({ v: 1, recipeId: "a", step: 4, swaps: {}, at: 1 });
  assert.strictEqual(snap.step, 4);
  assert.strictEqual(snap.recipeId, "a");
});

test("isResumable treats the first step as nothing to resume", () => {
  assert.strictEqual(P.isResumable(null), false);
  assert.strictEqual(P.isResumable(P.serialize({ recipeId: "a", step: 0 })), false);
  assert.strictEqual(P.isResumable(P.serialize({ recipeId: "a", step: 3 })), true);
});
