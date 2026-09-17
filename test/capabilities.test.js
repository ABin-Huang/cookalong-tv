"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

const C = require("../src/capabilities");

/* ---------- the Fire TV case that motivated this module ---------- */

test("a device with the speech API but no voices is reported as unspeakable", () => {
  // This is what Amazon Silk does: getVoices() resolves empty, so speak()
  // succeeds, reports nothing, and the cook hears silence.
  const caps = C.detect({ speechSynthesis: { getVoices: () => [] } });
  assert.strictEqual(caps.speech.status, "no-voices");
  assert.strictEqual(caps.speech.speakable, false);
  assert.strictEqual(C.summarize(caps).spokenPrimary, false);
});

test("no speech engine at all is distinguished from one that is silent", () => {
  const caps = C.detect({});
  assert.strictEqual(caps.speech.status, "unavailable");
  assert.strictEqual(caps.speech.speakable, false);
});

test("installed voices make spoken guidance available", () => {
  const caps = C.detect({
    speechSynthesis: { getVoices: () => [{ lang: "en-US", name: "Samantha" }] },
  });
  assert.strictEqual(caps.speech.status, "ok");
  assert.strictEqual(caps.speech.voices, 1);
  assert.strictEqual(C.summarize(caps).spokenPrimary, true);
});

test("a throwing getVoices() counts as having no voices", () => {
  const caps = C.detect({ speechSynthesis: { getVoices() { throw new Error("nope"); } } });
  assert.strictEqual(caps.speech.speakable, false);
  assert.strictEqual(caps.speech.voices, 0);
});

test("SpeechRecognition is found under either vendor prefix", () => {
  assert.strictEqual(C.detect({ SpeechRecognition: function () {} }).recognition.supported, true);
  assert.strictEqual(C.detect({ webkitSpeechRecognition: function () {} }).recognition.supported, true);
  assert.strictEqual(C.detect({}).recognition.supported, false);
});

test("storage is proven by writing, not by presence", () => {
  const calls = [];
  const store = {
    setItem: (k, v) => calls.push(["set", k, v]),
    removeItem: k => calls.push(["remove", k]),
  };
  assert.strictEqual(C.detect({ localStorage: store }).storage.writable, true);
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[0][1], calls[1][1], "the probe key must be cleaned up after itself");

  const throwing = { setItem() { throw new Error("quota"); }, removeItem() {} };
  assert.strictEqual(C.detect({ localStorage: throwing }).storage.writable, false);
  assert.strictEqual(C.detect({}).storage.writable, false);
});

test("wake lock support is reported", () => {
  assert.strictEqual(C.detect({ wakeLock: { request() {} } }).wakeLock.supported, true);
  assert.strictEqual(C.detect({ wakeLock: {} }).wakeLock.supported, false);
  assert.strictEqual(C.detect({}).wakeLock.supported, false);
});

/* ---------- summarize: the one decision the UI acts on ---------- */

test("a silent device moves the guidance channel to the screen", () => {
  const s = C.summarize(C.detect({ speechSynthesis: { getVoices: () => [] } }));
  assert.strictEqual(s.mode, "screen");
  assert.strictEqual(s.silenceRisk, true);
  assert.match(s.headline, /no installed voices/i);
  assert.match(s.action, /Alexa/, "the cook must still be told how to hear the steps");
});

test("a speaking device keeps voice as a real channel", () => {
  const s = C.summarize(C.detect({
    speechSynthesis: { getVoices: () => [{ lang: "en-US" }] },
    SpeechRecognition: function () {},
  }));
  assert.strictEqual(s.mode, "voice");
  assert.strictEqual(s.canListen, true);
  assert.strictEqual(s.silenceRisk, false);
});

test("a device that can speak but not listen says so", () => {
  const s = C.summarize(C.detect({ speechSynthesis: { getVoices: () => [{ lang: "en-US" }] } }));
  assert.strictEqual(s.canListen, false);
  assert.match(s.action, /Alexa button/);
});

test("summarize survives a missing or empty probe result", () => {
  const s = C.summarize(undefined);
  assert.strictEqual(s.mode, "screen");
  assert.strictEqual(s.spokenPrimary, false);
});

/* ---------- the TV hint must never decide anything ---------- */

test("looksLikeTv recognises Fire TV user agents", () => {
  assert.strictEqual(C.looksLikeTv("Mozilla/5.0 (Linux; Android 9; AFTMM Build/PS7233) Silk/98.2.3"), true);
  assert.strictEqual(C.looksLikeTv("Mozilla/5.0 (Windows NT 10.0; Win64) Chrome/124"), false);
  assert.strictEqual(C.looksLikeTv(undefined), false);
});

test("the TV hint never overrides a measurement", () => {
  // A TV that does have voices must still count as able to speak: what we
  // measured wins over what we guessed from a string.
  const caps = C.detect({
    userAgent: "Mozilla/5.0 (Linux; Android 9; AFTMM) Silk/98.2.3",
    speechSynthesis: { getVoices: () => [{ lang: "en-US" }] },
  });
  assert.strictEqual(caps.tvLikely, true);
  assert.strictEqual(C.summarize(caps).spokenPrimary, true);
});

/* ---------- report ---------- */

test("the report carries the probes a bug report needs", () => {
  const caps = C.detect({
    userAgent: "Mozilla/5.0 (Linux; Android 9; AFTMM) Silk/98.2.3",
    speechSynthesis: { getVoices: () => [] },
    localStorage: { setItem() {}, removeItem() {} },
  });
  const report = C.formatReport(caps, C.summarize(caps), { at: "2026-09-17T00:00:00.000Z" });
  assert.match(report, /AFTMM\)\s*Silk/);
  assert.match(report, /no-voices/);
  assert.match(report, /installed voices\s+0/);
  assert.match(report, /NOT available/);
  assert.match(report, /2026-09-17T00:00:00\.000Z/);
  assert.match(report, /guidance channel: screen/);
});

test("the report works without metadata", () => {
  const caps = C.detect({});
  const report = C.formatReport(caps, C.summarize(caps));
  assert.match(report, /\(unknown\)/);
  assert.match(report, /guidance channel: screen/);
});
