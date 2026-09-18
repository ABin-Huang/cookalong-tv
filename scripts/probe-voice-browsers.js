"use strict";

/**
 * Which browsers here can actually recognise speech?
 *
 * The app's voice input needs the recogniser to emit events. `webkitSpeechRecognition`
 * existing is not the same as it working: the constructor ships in Chromium builds
 * that have no cloud speech service behind it, and then `start()` silently does
 * nothing at all — no onstart, no onerror, nothing. This compares the builds
 * available on this machine so the fix targets the real constraint.
 *
 *   NODE_PATH=<playwright>/node_modules node scripts/probe-voice-browsers.js
 */

const { chromium } = require("playwright");
const TARGET = process.env.COOKALONG_URL || "http://localhost:8080/index.html";

const CONFIGS = [
  { name: "chromium headless", options: {} },
  { name: "chromium headed", options: { headless: false } },
  { name: "chrome channel", options: { channel: "chrome" } },
  { name: "msedge channel", options: { channel: "msedge" } }
];

async function tryConfig(cfg) {
  let browser;
  try {
    browser = await chromium.launch({
      ...cfg.options,
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        "--autoplay-policy=no-user-gesture-required"
      ]
    });
  } catch (e) {
    return { name: cfg.name, launched: false, why: (e.message || "").split("\n")[0].slice(0, 120) };
  }
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await context.grantPermissions(["microphone"], { origin: new globalThis.URL(TARGET).origin });
    const page = await context.newPage();
    await page.goto(TARGET, { waitUntil: "load" });
    await page.waitForTimeout(600);

    const result = await page.evaluate(async () => {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) return { events: [], note: "no constructor" };
      const events = [];
      const t0 = Date.now();
      const mark = (n, x) => events.push(`${Date.now() - t0}ms ${n}${x ? " " + x : ""}`);
      const r = new SR();
      r.lang = navigator.language || "en-US";
      r.interimResults = true;
      r.continuous = false;
      ["onstart", "onaudiostart", "onsoundstart", "onspeechstart", "onend"]
        .forEach(k => { r[k] = () => mark(k); });
      r.onresult = e => mark("onresult", JSON.stringify((e.results[0] || [{}])[0].transcript || ""));
      r.onerror = e => mark("onerror", String(e.error));
      try { r.start(); } catch (err) { return { events, note: "start() threw: " + err.message }; }
      await new Promise(res => setTimeout(res, 6500));
      try { r.abort(); } catch (e) { /* ignore */ }
      return { events, version: navigator.userAgent.match(/(Chrome|Edg)\/[\d.]+/g) };
    });
    return { name: cfg.name, launched: true, ...result };
  } finally {
    try { await browser.close(); } catch (e) { /* ignore */ }
  }
}

(async () => {
  for (const cfg of CONFIGS) {
    const r = await tryConfig(cfg);
    if (!r.launched) {
      console.log(`${r.name.padEnd(18)} NOT AVAILABLE — ${r.why}`);
      continue;
    }
    const worked = r.events.some(e => /onstart|onresult|onaudiostart/.test(e));
    console.log(`${r.name.padEnd(18)} ${worked ? "WORKS " : "DEAD  "} events=${JSON.stringify(r.events)}${r.note ? " note=" + r.note : ""}`);
  }
})();
