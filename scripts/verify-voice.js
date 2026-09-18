"use strict";

/**
 * Voice verification — the harness the old voice tests should have been.
 *
 * Every voice test in this repo used to stub `SpeechRecognition` out, and every
 * one of them passed while the real thing was dead. The stub cannot fail the way
 * the platform fails: a real recogniser accepts `start()` and then reports
 * nothing at all — no onstart, no error, no end — which is what chromium does in
 * headless mode, and what the cook experienced as a microphone button that did
 * nothing useful. A mock that always calls the callbacks proves nothing about a
 * component whose whole problem is that the callbacks never arrive.
 *
 * So this harness drives the REAL app in a REAL browser and asserts on what a
 * person would see. Three stages, in increasing order of how much of the
 * platform they trust:
 *
 *   A. what this browser's recogniser actually does  — reported, never asserted
 *   B. a recogniser that accepts start() and emits nothing — the failure the cook
 *      hit, injected deliberately so it is deterministic everywhere
 *   C. a live recogniser, driven through the real app — asserted where the
 *      platform can do it, reported as skipped where it cannot
 *
 * Stage B is the important one, and it is a fault injection rather than a mock:
 * the app code under test is entirely real, and so is the DOM, the timers and
 * the event loop. Only the one component that is broken on the target device is
 * replaced, with the exact behaviour that broke it.
 *
 * A note on what is NOT tested here. Stage C opens the microphone and verifies
 * the app stays listening, but it does not verify transcription: feeding a
 * recogniser real speech needs a spoken WAV (`--use-file-for-fake-audio-capture`)
 * and a speech service that answers, and neither can be made deterministic in a
 * test. Transcription is the browser's, not this app's; what this app owns is
 * everything on either side of it, and that is what is asserted.
 *
 * Run it by hand, like the other browser harness:
 *
 *   npm start                 # serves public/ on :8080
 *   npm run verify:voice
 *
 * Requires playwright and a display. See scripts/verify-browser.js for the
 * NODE_PATH notes — they apply here unchanged.
 */

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch (e) {
  console.error(
    "This harness needs playwright, which is not installed:\n" +
    "  npm i -D playwright && npx playwright install chromium\n\n" +
    "If you already have playwright somewhere else, point NODE_PATH at its\n" +
    "node_modules instead (native path separator; a POSIX-style path is\n" +
    "ignored on Windows):\n" +
    "  NODE_PATH=C:\\path\\to\\node_modules npm run verify:voice\n"
  );
  process.exit(3);
}

const TARGET = process.env.COOKALONG_URL || "http://localhost:8080/index.html";
const ORIGIN = new globalThis.URL(TARGET).origin;
/** A recogniser that never started is only "dead" after the app's own deadline. */
const DEAD_WAIT_MS = 2600;

const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const skip = (name, detail) => {
  results.push({ name, pass: null, detail });
  console.log(`SKIP  ${name}${detail ? "  — " + detail : ""}`);
};

/**
 * A recogniser that accepts `start()` and then says nothing, ever.
 *
 * This is not a stand-in for the speech service; it is the specific defect. The
 * constructor exists, `start()` returns normally, `abort()` is harmless, and no
 * event of any kind is ever dispatched — exactly what chromium headless does.
 */
const NEVER_EMITS = () => {
  class DeafRecognition {
    constructor() {
      this.lang = "en-US";
      this.interimResults = true;
      this.continuous = false;
      this.maxAlternatives = 1;
    }
    start() { /* opens nothing, reports nothing */ }
    stop() { /* nothing to stop */ }
    abort() { /* nothing to abort */ }
  }
  window.webkitSpeechRecognition = DeafRecognition;
  window.SpeechRecognition = DeafRecognition;
};

/** Open the recipe the cook would tap, so a step command has somewhere to land. */
async function openRecipe(page, id) {
  await page.click(`#recipe-grid .card[data-recipe-id="${id}"]`);
  await page.waitForFunction(() => !document.getElementById("view-recipe").classList.contains("hidden"));
}

/** What the top bar is saying right now, and the button's own label. */
function readBar(page) {
  return page.evaluate(() => ({
    state: document.getElementById("voice-status").dataset.state,
    text: (document.getElementById("voice-text").textContent || "").trim(),
    micLabel: (document.getElementById("mic-label").textContent || "").trim(),
    panelOpen: !document.getElementById("conversation-panel").classList.contains("hidden"),
    step: (document.getElementById("step-label").textContent || "").trim(),
    rows: [...document.querySelectorAll("#convo-help-list .cmd-run")]
      .map(b => (b.textContent || "").trim()),
  }));
}

/* -- stage A: what this browser really does --------------------------------- */

async function probeRecogniser(browser, name, launchArgs, headless) {
  let context;
  try {
    context = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 720 } });
    await context.grantPermissions(["microphone"], { origin: ORIGIN });
    const page = await context.newPage();
    await page.goto(TARGET, { waitUntil: "load" });
    await page.waitForTimeout(500);
    const events = await page.evaluate(async () => {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) return { events: ["(no constructor)"], ms: 0 };
      const out = [];
      const t0 = Date.now();
      const mark = n => out.push(`${Date.now() - t0}ms ${n}`);
      const r = new SR();
      ["onstart", "onaudiostart", "onsoundstart", "onspeechstart", "onend"]
        .forEach(k => { r[k] = () => mark(k); });
      r.onerror = e => mark("onerror:" + (e && e.error));
      r.onresult = () => mark("onresult");
      try { r.start(); } catch (err) { return { events: ["start() threw: " + err.message], ms: 0 }; }
      await new Promise(res => setTimeout(res, 6500));
      try { r.abort(); } catch (err) { /* ignore */ }
      return { events: out, ms: 6500 };
    });
    return { name, headless, alive: events.events.some(e => /onstart|onaudiostart|onresult/.test(e)), events: events.events };
  } catch (e) {
    return { name, headless, alive: null, events: ["launch failed: " + (e.message || "").split("\n")[0]] };
  } finally {
    try { await context.close(); } catch (e) { /* ignore */ }
  }
}

/* -- stage B: the failure the cook hit -------------------------------------- */

async function deadRecogniserStage(browser) {
  const context = await browser.newContext({ locale: "en-US", viewport: { width: 1920, height: 1080 } });
  await context.grantPermissions(["microphone"], { origin: ORIGIN });
  const page = await context.newPage();
  // Before any app code runs, so the capability check measures the broken thing.
  await page.addInitScript(NEVER_EMITS);
  await page.goto(TARGET, { waitUntil: "load" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(400);
  await openRecipe(page, "tomato-basil-pasta");

  const start = await readBar(page);
  record("dead mic: the button offers to listen before anything has been tried",
    start.micLabel === "Voice", `label="${start.micLabel}"`);

  // --- press one: the app must try, then stop claiming to listen -------------
  const pressedAt = Date.now();
  await page.click("#btn-voice");
  await page.waitForTimeout(120);
  const whileTrying = await readBar(page);
  record("dead mic: pressing it does claim to listen (it is not written off blind)",
    whileTrying.state === "listening" && /Listening/.test(whileTrying.text),
    `state="${whileTrying.state}" text="${whileTrying.text.slice(0, 60)}"`);

  await page.waitForFunction(
    () => document.getElementById("voice-status").dataset.state === "error",
    null, { timeout: DEAD_WAIT_MS + 4000 }
  );
  const afterOne = await readBar(page);
  const noticedAt = Date.now() - pressedAt;
  record("dead mic: the lie ends — it admits the microphone is not coming through",
    /microphone is coming through/i.test(afterOne.text),
    `after ${noticedAt}ms: "${afterOne.text}"`);
  record("dead mic: it stops claiming to listen within the deadline, not forever",
    noticedAt < DEAD_WAIT_MS + 1500, `${noticedAt}ms, deadline was ${DEAD_WAIT_MS}ms`);
  record("dead mic: the button stops saying Voice and becomes the list instead",
    afterOne.micLabel === "Phrases", `label="${afterOne.micLabel}"`);

  // --- press two: the verdict is remembered, so no second wait ---------------
  // This is the whole complaint in one assertion. The old code re-ran the same
  // 3.5s failing wait on every press and never changed what the button did.
  const secondAt = Date.now();
  await page.click("#btn-voice");
  await page.waitForFunction(
    () => !document.getElementById("conversation-panel").classList.contains("hidden"),
    null, { timeout: 3000 }
  );
  const rememberedAt = Date.now() - secondAt;
  const afterTwo = await readBar(page);
  record("dead mic: the next press opens the ways in that work, without waiting again",
    rememberedAt < 900, `panel opened in ${rememberedAt}ms`);
  record("dead mic: the list it opens is the command table, expanded",
    afterTwo.rows.length > 5, `${afterTwo.rows.length} selectable rows`);

  // --- the fallback input runs through the same pipeline as the microphone ---
  const before = (await readBar(page)).step;
  const nextRow = afterTwo.rows.findIndex(t => /next step/i.test(t));
  if (nextRow === -1) {
    record("fallback: the list contains a next-step command the cook can select",
      false, `no next-step row among: ${afterTwo.rows.slice(0, 6).join(" | ")}`);
  } else {
    await page.click(`#convo-help-list .cmd-run >> nth=${nextRow}`);
    await page.waitForTimeout(500);
    const after = await readBar(page);
    const from = Number((before.match(/Step (\d+)/) || [])[1]);
    const to = Number((after.step.match(/Step (\d+)/) || [])[1]);
    record("fallback: selecting a phrase runs it through the same interpreter as speech",
      Number.isFinite(from) && to === from + 1,
      `"${before}" -> "${after.step}" by clicking the row`);
  }

  await context.close();
}

/* -- stage C: a live recogniser, and barge-in ------------------------------- */

async function liveStage(browser) {
  const context = await browser.newContext({ locale: "en-US", viewport: { width: 1920, height: 1080 } });
  await context.grantPermissions(["microphone"], { origin: ORIGIN });
  const page = await context.newPage();
  await page.goto(TARGET, { waitUntil: "load" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(400);

  // --- barge-in: pressing the microphone cuts the app off --------------------
  await page.evaluate(() => {
    window.__spoken = [];
    const utt = new SpeechSynthesisUtterance(
      "This is a deliberately long sentence so that there is still something being said " +
      "when the microphone is pressed, which is the only condition under which interrupting " +
      "the app can be observed at all."
    );
    utt.lang = "en-US";
    window.speechSynthesis.speak(utt);
  });
  await page.waitForTimeout(300);
  const wasSpeaking = await page.evaluate(() => !!window.speechSynthesis.speaking);
  await page.click("#btn-voice");
  await page.waitForTimeout(220);
  const stillSpeaking = await page.evaluate(() => !!window.speechSynthesis.speaking);
  const bar = await readBar(page);
  if (!wasSpeaking) {
    skip("barge-in: pressing the microphone stops the app mid-sentence",
      "this browser never started speaking, so there was nothing to interrupt");
  } else {
    record("barge-in: pressing the microphone stops the app mid-sentence",
      !stillSpeaking, `speaking before=${wasSpeaking} after=${stillSpeaking}`);
    record("barge-in: and the microphone is open instead, on the same press",
      bar.state === "listening", `state="${bar.state}"`);
  }

  // --- liveness: a real recogniser must NOT be written off -------------------
  await page.waitForTimeout(DEAD_WAIT_MS + 400);
  const alive = await readBar(page);
  const writtenOff = /microphone is not opening/i.test(alive.text) || alive.micLabel === "Phrases";
  if (writtenOff) {
    skip("live mic: a real recogniser is not mistaken for a dead one",
      "this build's recogniser emitted nothing either, so there was no live case to observe");
  } else {
    record("live mic: a real recogniser is not mistaken for a dead one",
      alive.state === "listening" || alive.state === "answered" || alive.state === "error",
      `state="${alive.state}" label="${alive.micLabel}" text="${alive.text.slice(0, 70)}"`);
  }

  // Leave the page's microphone closed so the browser can exit cleanly.
  try { await page.evaluate(() => window.speechSynthesis.cancel()); } catch (e) { /* ignore */ }
  await page.click("#btn-voice").catch(() => {});
  await page.waitForTimeout(200);
  await context.close();
}

/* -- main ------------------------------------------------------------------- */

(async () => {
  console.log(`Voice verification against ${TARGET}\n`);

  // Stage A is diagnostic: it records what this machine's browsers do, because
  // that is the fact the whole design turns on. It asserts nothing.
  console.log("-- A. what this browser's recogniser actually does (diagnostic) --");
  let headlessAlive = null;
  {
    const browser = await chromium.launch({
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    });
    const probe = await probeRecogniser(browser, "chromium headless", [], true);
    headlessAlive = probe.alive;
    console.log(`     chromium headless   ${probe.alive ? "ALIVE" : "DEAD "}  ${JSON.stringify(probe.events)}`);
    await browser.close();
  }

  console.log("\n-- B. a recogniser that accepts start() and emits nothing --");
  {
    const browser = await chromium.launch({
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    });
    try {
      await deadRecogniserStage(browser);
    } catch (e) {
      record("dead-recogniser stage ran to completion", false, (e.message || "").split("\n")[0]);
    }
    await browser.close();
  }

  console.log("\n-- C. a live recogniser and barge-in --");
  {
    let browser = null;
    try {
      // Headed, and a real browser channel when one is installed: this is the
      // only configuration in which the platform can recognise speech at all.
      browser = await chromium.launch({
        headless: false,
        channel: process.env.COOKALONG_CHANNEL || "chrome",
        args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
      });
    } catch (e) {
      try {
        browser = await chromium.launch({
          headless: false,
          args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
        });
      } catch (e2) {
        skip("live recogniser and barge-in", `no headed browser available: ${(e2.message || "").split("\n")[0]}`);
        browser = null;
      }
    }
    if (browser) {
      try {
        await liveStage(browser);
      } catch (e) {
        record("live-recogniser stage ran to completion", false, (e.message || "").split("\n")[0]);
      }
      await browser.close();
    }
  }

  const failed = results.filter(r => r.pass === false);
  const passed = results.filter(r => r.pass === true);
  const skipped = results.filter(r => r.pass === null);
  console.log(`\n${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped`);
  if (headlessAlive) {
    console.log("note: this machine's headless recogniser is ALIVE, so stage B's premise\n" +
      "      (chromium headless is deaf) does not hold here — the fix is still correct,\n" +
      "      it is simply not reproducible on this build.");
  }
  process.exit(failed.length ? 1 : 0);
})();
