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
