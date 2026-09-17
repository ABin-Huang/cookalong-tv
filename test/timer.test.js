"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

const { parseDuration, stepDurationSeconds, Timer } = require("../src/timer");

/* ------------------- stepDurationSeconds (recipe step text) ------------------ */

test("stepDurationSeconds: finds the cooking time inside a step", () => {
  assert.strictEqual(stepDurationSeconds("Boil salted water and cook 200g of spaghetti for 9 minutes."), 540);
  assert.strictEqual(stepDurationSeconds("Return the chicken, cover and cook on low for 18 minutes."), 1080);
  assert.strictEqual(stepDurationSeconds("Add 4 sliced garlic cloves and cook for 30 seconds until fragrant."), 30);
});

test("stepDurationSeconds: doubles a per-side instruction", () => {
  assert.strictEqual(stepDurationSeconds("brown the chicken for 4 minutes per side."), 480);
  assert.strictEqual(stepDurationSeconds("Dip the bread into the mixture for 10 seconds per side."), 20);
});

test("stepDurationSeconds: a range resolves to its upper bound", () => {
  assert.strictEqual(stepDurationSeconds("Cook the bread for 2 to 3 minutes per side until golden."), 360);
});

test("stepDurationSeconds: several times in one step report the longest", () => {
  const step = "cook the onion for 3 minutes, then add garlic and mushrooms for 4 minutes.";
  assert.strictEqual(stepDurationSeconds(step), 240);
});

test("stepDurationSeconds: returns null when the step names no time", () => {
  assert.strictEqual(stepDurationSeconds("Drain the pasta, reserving a cup of pasta water."), null);
  assert.strictEqual(stepDurationSeconds("Pour in 600ml of chicken stock and bring to a simmer."), null);
  assert.strictEqual(stepDurationSeconds("Slice 350g of beef into thin strips against the grain."), null);
});

test("stepDurationSeconds: quantities and ingredient names are not mistaken for times", () => {
  // 300g of rice, 1 teaspoon of cumin, 2 tbsp of oil, 4 thick slices of bread
  assert.strictEqual(stepDurationSeconds("Add 300g of rice and 1 teaspoon of cumin."), null);
  assert.strictEqual(stepDurationSeconds("Heat 2 tablespoons of olive oil in a wide pan."), null);
  assert.strictEqual(stepDurationSeconds("Dip 4 thick slices of bread into the mixture."), null);
});

test("stepDurationSeconds: spells out small numbers and ignores nonsense", () => {
  assert.strictEqual(stepDurationSeconds("Let the batter rest for a minute."), 60);
  assert.strictEqual(stepDurationSeconds(""), null);
  assert.strictEqual(stepDurationSeconds(null), null);
});

test("stepDurationSeconds: clamps absurd values instead of returning them", () => {
  assert.strictEqual(stepDurationSeconds("Marinate for 48 hours."), null);
});

test("parseDuration: simple minutes", () => {
  assert.strictEqual(parseDuration("5 minutes"), 300);
  assert.strictEqual(parseDuration("1 minute"), 60);
});

test("parseDuration: seconds", () => {
  assert.strictEqual(parseDuration("30 seconds"), 30);
  assert.strictEqual(parseDuration("ninety seconds"), 90);
});

test("parseDuration: compound durations", () => {
  assert.strictEqual(parseDuration("1 hour 30 minutes"), 5400);
  assert.strictEqual(parseDuration("two minutes and fifteen seconds"), 135);
});

test("parseDuration: unparseable returns null", () => {
  assert.strictEqual(parseDuration("as fast as possible"), null);
  assert.strictEqual(parseDuration(""), null);
  assert.strictEqual(parseDuration(null), null);
});

test("Timer formats remaining time", () => {
  const t = new Timer(90);
  assert.strictEqual(t.format(), "01:30");
  assert.strictEqual(t.speak(), "1 minute and 30 seconds");
});

test("Timer rejects invalid duration", () => {
  assert.throws(() => new Timer(0), /positive/);
  assert.throws(() => new Timer(-5), /positive/);
});

test("Timer stop zeroes remaining time", () => {
  const t = new Timer(60);
  t.stop();
  assert.strictEqual(t.remainingSeconds, 0);
  assert.strictEqual(t.state, "done");
});

test("Timer pause keeps remaining time", async () => {
  const t = new Timer(300);
  t.start();
  await new Promise(resolve => setTimeout(resolve, 1200));
  t.pause();
  const remaining = t.remainingSeconds;
  assert.ok(remaining < 300 && remaining >= 298);
  await new Promise(resolve => setTimeout(resolve, 1200));
  assert.strictEqual(t.remainingSeconds, remaining, "timer must stay paused");
  t.stop();
});

test("Timer survives a persist/restore round-trip", () => {
  const t = new Timer(600);
  t.start();
  t.pause();
  const snapshot = JSON.parse(JSON.stringify(t.toJSON()));

  const restored = Timer.fromJSON(snapshot);
  assert.strictEqual(restored.totalSeconds, 600);
  assert.strictEqual(restored.remainingSeconds, t.remainingSeconds);
  assert.strictEqual(restored.state, "paused", "a restored timer waits for the cook");
  assert.strictEqual(restored.format(), t.format());
});

test("Timer.fromJSON rejects junk and clamps out-of-range snapshots", () => {
  assert.strictEqual(Timer.fromJSON(null), null);
  assert.strictEqual(Timer.fromJSON({}), null);
  assert.strictEqual(Timer.fromJSON({ totalSeconds: 0 }), null);
  assert.strictEqual(Timer.fromJSON({ totalSeconds: -30 }), null);

  const over = Timer.fromJSON({ totalSeconds: 60, remainingSeconds: 9999, state: "running" });
  assert.strictEqual(over.remainingSeconds, 60);
  assert.strictEqual(over.state, "paused");

  const spent = Timer.fromJSON({ totalSeconds: 60, remainingSeconds: 0, state: "paused" });
  assert.strictEqual(spent.state, "done");
});

test("restoring a running timer accounts for time spent with the app closed", () => {
  // deadline 40s in the future, but the stale counter still says 55s:
  // the wall clock must win
  const restored = Timer.fromJSON({
    totalSeconds: 60,
    remainingSeconds: 55,
    state: "running",
    deadline: Date.now() + 40 * 1000,
  });
  assert.ok(restored.remainingSeconds <= 41 && restored.remainingSeconds >= 39,
    `expected ~40s left, got ${restored.remainingSeconds}`);
  assert.strictEqual(restored.state, "paused");

  const expired = Timer.fromJSON({
    totalSeconds: 60,
    remainingSeconds: 30,
    state: "running",
    deadline: Date.now() - 5 * 1000,
  });
  assert.strictEqual(expired.remainingSeconds, 0);
  assert.strictEqual(expired.state, "done", "a timer that expired while away is done");
});

test("Timer does not drift when ticks arrive late", async () => {
  // a deadline-based timer derives remaining time from the clock, so a late
  // tick (throttled tab, sleeping TV) must not lose seconds
  const t = new Timer(10);
  t.start();
  await new Promise(resolve => setTimeout(resolve, 1500));
  let ticks = 0;
  t._onTick = () => { ticks += 1; };
  await new Promise(resolve => setTimeout(resolve, 2200));
  t.pause();
  assert.ok(t.remainingSeconds <= 7 && t.remainingSeconds >= 5, `expected ~6s left, got ${t.remainingSeconds}`);
  assert.ok(ticks > 0, "onTick should keep firing");
  t.stop();
});
