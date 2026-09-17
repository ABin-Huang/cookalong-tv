"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

const { TimerRack, Timer } = require("../src/timer");

/** A rack that records what it was told, so change notifications are testable. */
function tracked(maxTimers) {
  const seen = [];
  const rack = new TimerRack((r, finished) => seen.push({ size: r.size, finished }), { maxTimers });
  return { rack, seen };
}

// ---------------------------------------------------------------------------
// the whole point: several timers, side by side
// ---------------------------------------------------------------------------

test("a second timer does not stop the first", () => {
  // This is the bug the rack exists to fix: the rice used to be cancelled the
  // moment you started timing the chicken.
  const { rack } = tracked();
  const rice = rack.add(18 * 60, "Rice");
  const chicken = rack.add(5 * 60, "Chicken rest");

  assert.strictEqual(rack.size, 2);
  assert.strictEqual(rice.timer.totalSeconds, 1080);
  assert.strictEqual(chicken.timer.totalSeconds, 300);
  assert.strictEqual(rice.timer.state, "idle", "the first timer is untouched, not stopped");
  assert.notStrictEqual(rice.timer, chicken.timer);
});

test("each timer counts its own time down", () => {
  const { rack } = tracked();
  const rice = rack.add(1080, "Rice");
  const chicken = rack.add(300, "Chicken rest");
  rice.timer.start();
  chicken.timer.start();

  rice.timer.remainingSeconds = 1000;
  chicken.timer.remainingSeconds = 120;

  const listed = rack.list();
  assert.strictEqual(listed.length, 2);
  assert.strictEqual(listed[0].label, "Rice");
  assert.strictEqual(listed[1].label, "Chicken rest");
  assert.strictEqual(rack.get(rice.id).timer.remainingSeconds, 1000);
  assert.strictEqual(rack.get(chicken.id).timer.remainingSeconds, 120);
});

test("active() puts the most urgent timer first", () => {
  // With room for one line on the home screen, the soonest deadline is the one
  // worth showing.
  const { rack } = tracked();
  const rice = rack.add(1080, "Rice");
  const chicken = rack.add(300, "Chicken rest");
  const oven = rack.add(600, "Oven");

  assert.strictEqual(rack.next().label, "Chicken rest");
  assert.deepStrictEqual(rack.active().map(e => e.label), ["Chicken rest", "Oven", "Rice"]);

  chicken.timer.remainingSeconds = 2000;
  assert.strictEqual(rack.next().label, "Oven", "ordering follows the clock, not insertion");
  assert.strictEqual(rice.timer.remainingSeconds, 1080);
  assert.strictEqual(oven.timer.remainingSeconds, 600);
});

test("a finished timer leaves active() but stays listed until dismissed", () => {
  const { rack } = tracked();
  const rice = rack.add(1080, "Rice");
  rice.timer.state = "done";
  rice.timer.remainingSeconds = 0;

  assert.deepStrictEqual(rack.active(), [], "nothing is counting any more");
  assert.strictEqual(rack.list().length, 1, "but the cook can still see what finished");
  assert.strictEqual(rack.done().length, 1);
  assert.strictEqual(rack.next(), null);

  assert.strictEqual(rack.clearDone(), 1);
  assert.strictEqual(rack.size, 0);
  assert.strictEqual(rack.clearDone(), 0, "dismissing twice is harmless");
});

// ---------------------------------------------------------------------------
// naming
// ---------------------------------------------------------------------------

test("asking twice for the same thing restarts it instead of stacking a duplicate", () => {
  const { rack } = tracked();
  const first = rack.add(1080, "Rice");
  const second = rack.add(300, "Rice");

  assert.strictEqual(rack.size, 1, "one step, one timer");
  assert.strictEqual(second.timer.totalSeconds, 300, "the new duration wins");
  assert.notStrictEqual(second.id, first.id);
  assert.strictEqual(rack.get(first.id), null, "the replaced timer is gone");
});

test("labels are matched case- and space-insensitively", () => {
  const { rack } = tracked();
  rack.add(600, "Oven");
  rack.add(300, "  oven ");
  assert.strictEqual(rack.size, 1);
});

test("timers with no label are never treated as duplicates of each other", () => {
  // An unnamed timer is a deliberate extra, not a re-press of the same button.
  const { rack } = tracked();
  rack.add(600, "");
  rack.add(600, "");
  assert.strictEqual(rack.size, 2);
});

test("a rack is finite: a kitchen has four burners, not forty", () => {
  const { rack } = tracked(3);
  for (let i = 0; i < 3; i += 1) assert.ok(rack.add(60 + i, `timer ${i}`));
  assert.strictEqual(rack.add(60, "one too many"), null, "the fourth is refused");
  assert.strictEqual(rack.size, 3);
});

test("a full rack still accepts a replacement, because it is not growing", () => {
  const { rack } = tracked(2);
  rack.add(60, "A");
  rack.add(120, "B");
  assert.strictEqual(rack.add(60, "zzz"), null);
  const replaced = rack.add(300, "A");
  assert.ok(replaced, "restarting an existing timer frees its slot rather than needing a new one");
  assert.strictEqual(rack.size, 2);
  assert.strictEqual(rack.get(replaced.id).timer.totalSeconds, 300);
});

test("finished timers do not hold a slot against new ones", () => {
  const { rack } = tracked(1);
  const a = rack.add(60, "A");
  a.timer.state = "done";
  assert.ok(rack.add(90, "B"), "a done timer is not still occupying the burner");
});

test("a nonsense duration is refused rather than becoming a timer that never fires", () => {
  const { rack } = tracked();
  [0, -30, NaN, Infinity, "10 minutes", null, undefined].forEach(bad => {
    assert.strictEqual(rack.add(bad, "bad"), null, `${bad} is not a duration`);
  });
  assert.strictEqual(rack.size, 0);
});

// ---------------------------------------------------------------------------
// control
// ---------------------------------------------------------------------------

test("pauseAll stops everything that was counting, and nothing else", () => {
  const { rack } = tracked();
  const a = rack.add(600, "A");
  const b = rack.add(600, "B");
  const c = rack.add(600, "C");
  a.timer.start();
  b.timer.start();

  rack.pauseAll();
  assert.strictEqual(a.timer.state, "paused");
  assert.strictEqual(b.timer.state, "paused");
  assert.strictEqual(c.timer.state, "idle", "a timer that never started is left alone");
  assert.deepStrictEqual(rack.running(), []);
});

test("removing one timer leaves the others counting", () => {
  const { rack } = tracked();
  const a = rack.add(600, "A");
  const b = rack.add(600, "B");
  assert.strictEqual(rack.remove(a.id), true);
  assert.strictEqual(rack.size, 1);
  assert.strictEqual(rack.get(b.id).timer.totalSeconds, 600);
  assert.strictEqual(rack.remove("nope"), false);
});

test("restarting rewinds to the full duration and waits to be started", () => {
  const { rack } = tracked();
  const a = rack.add(600, "A");
  a.timer.start();
  a.timer.remainingSeconds = 12;

  rack.restart(a.id);
  assert.strictEqual(a.timer.remainingSeconds, 600);
  assert.strictEqual(a.timer.state, "paused", "a restart is a reset, not an auto-start");
});

test("clear empties the rack and stops what was running", () => {
  const { rack } = tracked();
  const a = rack.add(600, "A");
  a.timer.start();
  rack.clear();
  assert.strictEqual(rack.size, 0);
  assert.strictEqual(a.timer.state, "done", "nothing keeps ticking in the background");
});

test("the rack reports every change it makes", () => {
  const { rack, seen } = tracked();
  const a = rack.add(600, "A");
  assert.strictEqual(seen.length, 1);
  rack.add(300, "B");
  rack.remove(a.id);
  rack.pauseAll();
  assert.strictEqual(seen.length, 4);
  assert.strictEqual(seen[3].size, 1);
});

// ---------------------------------------------------------------------------
// surviving a reload
// ---------------------------------------------------------------------------

test("a rack round-trips through storage with its labels and order", () => {
  const { rack } = tracked();
  rack.add(1080, "Rice");
  rack.add(300, "Chicken rest");

  const restored = TimerRack.fromJSON(JSON.parse(JSON.stringify(rack.toJSON())));
  assert.strictEqual(restored.size, 2);
  assert.deepStrictEqual(restored.list().map(e => e.label), ["Rice", "Chicken rest"]);
  assert.deepStrictEqual(restored.list().map(e => e.timer.totalSeconds), [1080, 300]);
});

test("a timer that was running comes back paused, timed from its deadline", () => {
  // A running timer is restored by subtracting from its recorded deadline, so
  // the minutes the app spent closed are accounted for rather than handed back.
  const rice = { id: "a", label: "Rice", totalSeconds: 1080, remainingSeconds: 1080, state: "running", deadline: Date.now() + 900 * 1000 };
  const restored = TimerRack.fromJSON({ v: 2, timers: [rice] });
  const back = restored.list()[0];

  assert.strictEqual(back.timer.state, "paused", "the cook decides when to resume");
  assert.ok(back.timer.remainingSeconds <= 900 && back.timer.remainingSeconds > 895,
    `expected about 900 seconds left, got ${back.timer.remainingSeconds}`);
  assert.strictEqual(back.label, "Rice");
});

test("a running timer whose deadline passed while away comes back finished", () => {
  const stale = { id: "a", label: "Rice", totalSeconds: 1080, remainingSeconds: 1080, state: "running", deadline: Date.now() - 5000 };
  const rack = TimerRack.fromJSON({ v: 2, timers: [stale] });
  assert.strictEqual(rack.list()[0].timer.state, "done");
  assert.deepStrictEqual(rack.active(), [], "it must not reappear as if it still had time");
});

test("a paused timer keeps exactly the time it was saved with", () => {
  const paused = { id: "a", label: "Oven", totalSeconds: 600, remainingSeconds: 137, state: "paused", deadline: null };
  const rack = TimerRack.fromJSON({ v: 2, timers: [paused] });
  assert.strictEqual(rack.list()[0].timer.remainingSeconds, 137);
});

test("a v1 single-timer snapshot is migrated instead of discarded", () => {
  // Timers already counting when the rack shipped must not be silently lost.
  const legacy = { totalSeconds: 600, remainingSeconds: 420, state: "paused", deadline: null };
  const rack = TimerRack.fromJSON(JSON.stringify(legacy));
  assert.strictEqual(rack.size, 1);
  assert.strictEqual(rack.list()[0].timer.remainingSeconds, 420);
  assert.strictEqual(rack.list()[0].label, "", "an old timer simply has no name yet");
});

test("junk in storage yields nothing rather than a broken rack", () => {
  [null, "", "{not json", "[]", "42", '"a string"', { v: 2, timers: [] },
   { v: 2, timers: [{ totalSeconds: 0 }] }].forEach(raw => {
    assert.strictEqual(TimerRack.fromJSON(raw), null, `${JSON.stringify(raw)} is not a rack`);
  });
});

test("one corrupt entry does not take the healthy timers down with it", () => {
  const rack = TimerRack.fromJSON({
    v: 2,
    timers: [
      { id: "a", label: "Rice", totalSeconds: 1080, remainingSeconds: 1080, state: "paused" },
      { id: "b", label: "Broken", totalSeconds: 0 },
      { id: "c", label: "Oven", totalSeconds: 600, remainingSeconds: 600, state: "paused" },
    ],
  });
  assert.strictEqual(rack.size, 2);
  assert.deepStrictEqual(rack.list().map(e => e.label), ["Rice", "Oven"]);
});

test("restored timers keep ticking down and can still be controlled", () => {
  const rack = TimerRack.fromJSON({
    v: 2,
    timers: [{ id: "a", label: "Rice", totalSeconds: 1080, remainingSeconds: 1080, state: "paused" }],
  });
  const entry = rack.list()[0];
  rack.start(entry.id);
  assert.strictEqual(entry.timer.state, "running");
  rack.pause(entry.id);
  assert.strictEqual(entry.timer.state, "paused");
  rack.remove(entry.id);
  assert.strictEqual(rack.size, 0);
});

test("the rack is built on the same Timer, so it cannot drift from it", () => {
  const { rack } = tracked();
  const entry = rack.add(90, "A");
  assert.ok(entry.timer instanceof Timer);
  assert.strictEqual(entry.timer.format(), "01:30");
  assert.strictEqual(entry.timer.speak(), "1 minute and 30 seconds");
});
