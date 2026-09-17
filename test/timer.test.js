"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

const { parseDuration, Timer } = require("../src/timer");

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
