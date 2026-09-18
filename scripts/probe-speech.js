"use strict";

/**
 * What `speechSynthesis` actually does on this machine.
 *
 * Hands-free mode hands the microphone back when the app has stopped talking,
 * and the obvious signal for that is the utterance's `onend`. It is not a
 * reliable one, and this is the measurement that says so rather than the
 * assumption that it is. Run it against the dev server:
 *
 *   npm start                  # in one terminal
 *   NODE_PATH=<playwright>/node_modules node scripts/probe-speech.js
 *
 * Measured in a headless Chromium with three voices installed:
 *
 *   onstart          fires
 *   onend            NEVER fires for the first utterance on a page
 *   speaking         stays true for as long as anyone keeps asking
 *   after cancel()   speaking clears, and `onend` still does not arrive
 *   second utterance ends normally
 *
 * So a mode wired only to `onend` stops listening after the first answer and
 * never says why. That is why `scheduleHandsFreeRearm` takes `onend` as a fast
 * path and also bounds the wait by what the sentence costs to read — see
 * `speakBudgetMs` in public/app.js, and the two hands-free checks in
 * scripts/verify-browser.js that hold it to it.
 *
 * Kept in the repo because the claim it supports is otherwise invisible: it is
 * a property of the platform, not of our code, and it can change.
 */

const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto("http://localhost:8080/index.html", { waitUntil: "load" });
  await page.waitForTimeout(800);

  const facts = await page.evaluate(async () => {
    const synth = window.speechSynthesis;
    const out = { voices: synth.getVoices().length, hasUtterance: typeof SpeechSynthesisUtterance === "function" };
    const u = new SpeechSynthesisUtterance("Hands-free is on. After every answer I will open the microphone again.");
    let started = false, ended = false, errored = false;
    u.onstart = () => { started = true; };
    u.onend = () => { ended = true; };
    u.onerror = (e) => { errored = e && e.error; };
    synth.speak(u);

    const at = async (ms) => {
      await new Promise(r => setTimeout(r, ms));
      return { speaking: synth.speaking, pending: synth.pending, paused: synth.paused };
    };
    out.t0 = await at(500);
    out.t1 = await at(1500);
    out.t2 = await at(3000);
    out.onstartFired = started;
    out.onendFired = ended;
    out.onerrorFired = errored;

    // Does an explicit cancel free the flag?
    synth.cancel();
    await new Promise(r => setTimeout(r, 300));
    out.afterCancel = { speaking: synth.speaking, pending: synth.pending, onendFiredNow: ended };

    // And a fresh utterance after a cancel?
    const v = new SpeechSynthesisUtterance("second");
    let ended2 = false;
    v.onend = () => { ended2 = true; };
    synth.speak(v);
    await new Promise(r => setTimeout(r, 2000));
    out.second = { speaking: synth.speaking, ended: ended2 };
    return out;
  });
  console.log(JSON.stringify(facts, null, 1));
  await browser.close();
})();
