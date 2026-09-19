"use strict";

/**
 * Browser verification for the two things that only exist in the browser: the
 * shopping list, and the single kitchen decision the home screen is built
 * around.
 *
 * Every other test in this repo runs the engines in plain Node. The web app is
 * not the engines: it is a DOM, a stylesheet, a remote-control focus model and a
 * 10-foot viewport. `public/app.js` is never loaded by the unit tests, so none of
 * the things that actually break a TV app — a button that pushes the step card
 * off the bottom of a 1080p screen, focus that lands outside the panel so a D-pad
 * cannot reach the list, a badge that stops counting — can be caught there.
 *
 * This harness drives a real Chromium at 1920x1080, presses the real buttons and
 * reads the real DOM, then asserts on what a person would actually see.
 *
 * Why it lives in scripts/ rather than test/: `node --test` treats every .js file
 * under a test/ directory as a test file, so a harness sitting there would be
 * picked up by `npm test` and fail on any machine without a browser. CI runs on a
 * bare Ubuntu runner, and a test that cannot run is worse than no test. Run it
 * by hand instead:
 *
 *   npm start                 # in one terminal — serves public/ on :8080
 *   npm run verify:browser    # in another
 *
 * Requires playwright. Either install it here
 * (npm i -D playwright && npx playwright install chromium), or point NODE_PATH
 * at an install you already have — e.g. a shared one outside the repo:
 *
 *   NODE_PATH=C:\path\to\node_modules npm run verify:browser
 *
 * NODE_PATH must use the native path separator; a POSIX-style path is silently
 * ignored by Node on Windows and this harness will still report playwright
 * missing. Override the target with COOKALONG_URL=http://localhost:3000/index.html
 */

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch (e) {
  console.error(
    "This harness needs playwright, which is not installed:\n" +
    "  npm i -D playwright && npx playwright install chromium\n\n" +
    "If you already have playwright somewhere else, point NODE_PATH at its\n" +
    "node_modules instead of installing a second copy (native path separator;\n" +
    "a POSIX-style path is ignored on Windows):\n" +
    "  NODE_PATH=C:\\path\\to\\node_modules npm run verify:browser\n\n" +
    "It is intentionally not a dependency, so that `npm test` stays runnable\n" +
    "anywhere. See docs/DEV_SETUP.md."
  );
  process.exit(3);
}

const URL = process.env.COOKALONG_URL || "http://localhost:8080/index.html";
// The command table, so a check can ask the engine which language is "the other
// one" instead of hard-coding it. The page loads the same file, which is the
// point: the table is the one place that decides what the app can answer.
const VC = require("../src/voice-commands.js");
const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", e => errors.push("pageerror: " + e.message));

  try {
    await page.goto(URL, { waitUntil: "load" });
  } catch (e) {
    console.error(`\nCould not reach ${URL}. Start the dev server first:\n  npm start\n`);
    await browser.close();
    process.exit(3);
  }
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(400);

  // --- engines -------------------------------------------------------------
  const engines = await page.evaluate(() => ({
    shopping: !!window.CookalongShopping,
    servings: !!window.CookalongServings,
    ingredients: !!window.CookalongIngredients,
    plan: !!window.CookalongPlan,
  }));
  record("shopping engine is loaded in the page", engines.shopping, JSON.stringify(engines));

  const badgeStart = await page.textContent("#shop-badge-text");
  record("badge starts empty", badgeStart === "List", `badge="${badgeStart}"`);

  // --- the viewport stays a 10-foot layout ---------------------------------
  const openRecipe = async id => {
    await page.click(`#recipe-grid .card[data-recipe-id="${id}"]`);
    await page.waitForSelector("#view-recipe:not(.hidden)");
    await page.waitForTimeout(200);
  };

  await openRecipe("tomato-basil-pasta");
  const geom = await page.evaluate(() => {
    const r = s => { const el = document.querySelector(s); const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom) }; };
    return {
      ingredients: r("#ingredients-panel"),
      plan: r("#plan-panel"),
      step: r("#step-card"),
      shopBtn: r("#btn-shop-missing"),
      viewport: window.innerHeight,
    };
  });
  record("the step card is still on screen after adding the button",
    geom.step.top < geom.viewport && geom.step.bottom <= geom.viewport + 1,
    `step top=${geom.step.top} bottom=${geom.step.bottom} viewport=${geom.viewport}`);
  record("the add-what's-missing button sits in the ingredients header, not over the step card",
    geom.shopBtn.top >= geom.ingredients.top && geom.shopBtn.bottom <= geom.ingredients.bottom,
    `button ${geom.shopBtn.top}-${geom.shopBtn.bottom} inside ${geom.ingredients.top}-${geom.ingredients.bottom}`);

  // --- add from a recipe ---------------------------------------------------
  await page.click("#btn-shop-missing");
  await page.waitForTimeout(300);
  const toast = await page.textContent("#toast");
  record("adding from a recipe reports what it added", /Added \d+ items? for Tomato Basil Pasta/.test(toast), `toast="${toast}"`);

  await page.click("#btn-shop-badge");
  await page.waitForTimeout(400);
  const rows = await page.$$eval("#shop-list .shop-row", els => els.map(e => ({
    key: e.dataset.key,
    tick: e.querySelector(".shop-tick").textContent.trim(),
    qty: e.querySelector(".shop-qty").textContent.trim(),
    name: e.querySelector(".shop-name").textContent.trim(),
    asNeeded: e.classList.contains("asneeded"),
  })));
  record("the panel lists exactly what the recipe needs bought", rows.length === 4,
    JSON.stringify(rows.map(r => `${r.qty} ${r.name}`)));
  record("a vague amount is labelled as needed, not given a fake number",
    rows.some(r => r.asNeeded && r.qty === "as needed"),
    JSON.stringify(rows.filter(r => r.asNeeded)));

  const badgeAfter = await page.textContent("#shop-badge-text");
  record("the badge counts what is left to buy", /4 to buy/.test(badgeAfter), `badge="${badgeAfter}"`);

  // --- D-pad focus ---------------------------------------------------------
  // A 10-foot list the remote cannot reach is a list nobody can use.
  const focusInfo = await page.evaluate(() => {
    const active = document.activeElement;
    return { id: active && active.className, inPanel: !!(active && active.closest("#shopping-panel")) };
  });
  record("opening the list lands focus inside it, so a remote can tick items",
    focusInfo.inPanel, JSON.stringify(focusInfo));

  // --- tick one off --------------------------------------------------------
  const firstKey = rows[0].key;
  await page.click(`#shop-list .shop-row[data-key="${firstKey}"] .shop-tick`);
  await page.waitForTimeout(250);
  const afterTick = await page.evaluate(key => {
    const row = document.querySelector(`#shop-list .shop-row[data-key="${key}"]`);
    return { bought: row.classList.contains("bought"), tick: row.querySelector(".shop-tick").textContent.trim() };
  }, firstKey);
  record("ticking an item marks it bought and offers an undo", afterTick.bought && /Undo/.test(afterTick.tick),
    JSON.stringify(afterTick));
  record("the badge drops by one when an item is ticked",
    /3 to buy/.test(await page.textContent("#shop-badge-text")), await page.textContent("#shop-badge-text"));

  // --- merge a second dish -------------------------------------------------
  await page.click("#btn-back");
  await page.waitForSelector("#view-home:not(.hidden)");
  await openRecipe("vegetable-stir-fry");
  await page.click("#btn-shop-missing");
  await page.waitForTimeout(300);

  // Read the engine's own persisted view of the list, which is the same thing
  // the panel draws from.
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("cookalong.shopping.v1") || "[]"));
  const garlic = stored.find(i => i.canonical === "garlic");
  record("a second dish adds to the first rather than replacing it", stored.length > 4,
    `${stored.length} lines`);
  record("two dishes that both want garlic end up as one line with the sum",
    !!garlic && garlic.dishes === 2 && garlic.qty === "5",
    garlic ? `garlic qty=${garlic.qty} dishes=${garlic.dishes}` : "no garlic line");

  // --- re-adding the same recipe is idempotent -----------------------------
  const before = stored.map(i => `${i.key}=${i.qty}`).sort().join("|");
  await page.click("#btn-shop-missing");
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem("cookalong.shopping.v1") || "[]"));
  const afterStr = after.map(i => `${i.key}=${i.qty}`).sort().join("|");
  record("pressing add twice for the same dish does not double the shopping", before === afterStr,
    before === afterStr ? "" : `before=${before} after=${afterStr}`);

  // --- persistence ---------------------------------------------------------
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(500);
  const persisted = await page.evaluate(() => ({
    saved: JSON.parse(localStorage.getItem("cookalong.shopping.v1") || "[]").length,
    badge: document.querySelector("#shop-badge-text").textContent,
  }));
  record("the list survives a reload", persisted.saved === stored.length,
    `saved=${persisted.saved} badge="${persisted.badge}"`);

  // --- kitchen match card --------------------------------------------------
  await page.fill("#kitchen-input", "chicken, garlic, rice");
  await page.click("#btn-kitchen-find");
  await page.waitForTimeout(500);
  const matchBtns = await page.$$eval(".match-card .match-shop", els => els.length);
  record("every kitchen match card offers to add what's missing", matchBtns > 0, `${matchBtns} cards`);

  const firstShopBtn = await page.$(".match-card .match-shop");
  const keyBefore = await page.evaluate(() => JSON.parse(localStorage.getItem("cookalong.shopping.v1") || "[]").length);
  await firstShopBtn.click();
  await page.waitForTimeout(300);
  const afterMatchAdd = await page.evaluate(() => ({
    lines: JSON.parse(localStorage.getItem("cookalong.shopping.v1") || "[]").length,
    stillHome: !document.getElementById("view-home").classList.contains("hidden"),
  }));
  record("pressing it adds to the list and does not navigate away",
    afterMatchAdd.stillHome, JSON.stringify({ before: keyBefore, after: afterMatchAdd }));

  // --- the panel's own controls -------------------------------------------
  await page.click("#btn-shop-badge");
  await page.waitForTimeout(300);
  await page.click("#btn-shop-clear-bought");
  await page.waitForTimeout(250);
  const cleared = await page.evaluate(() => JSON.parse(localStorage.getItem("cookalong.shopping.v1") || "[]"));
  record("clear bought removes only the ticked lines", cleared.every(i => !i.bought), `${cleared.length} left`);

  await page.click("#btn-shop-empty");
  await page.waitForTimeout(250);
  const emptied = await page.evaluate(() => JSON.parse(localStorage.getItem("cookalong.shopping.v1") || "[]"));
  record("empty list empties it", emptied.length === 0, `${emptied.length} left`);
  record("the badge returns to empty", (await page.textContent("#shop-badge-text")) === "List");

  await page.click("#btn-shop-close");
  await page.waitForTimeout(200);
  record("hide closes the panel", await page.evaluate(() => document.getElementById("shopping-panel").classList.contains("hidden")));

  // --- spoken line ---------------------------------------------------------
  const spoken = await page.evaluate(() => {
    const SHOP = window.CookalongShopping;
    return SHOP.speak(SHOP.itemsToBuy(window.COOKALONG_RECIPES.find(r => r.id === "hearty-chicken-soup")).items);
  });
  record("the list has a spoken form with units expanded", /grams|milliliters/.test(spoken), spoken);

  // --- the kitchen decision ------------------------------------------------
  // The home screen's whole promise is one answer, and the answer is only an
  // answer if it is (a) the dish the engine ranked first and (b) on the first
  // screen. Neither is checkable without a browser: the unit tests never load
  // app.js, and no test knows where anything sits on a 1080p panel. The first
  // version of this feature failed both — #kitchen sat below #recipe-grid, so
  // the decision rendered ~1200px down the page, and on a 720p Fire TV viewport
  // the whole card was off-screen.
  const FULL_KITCHEN = "chicken, beef, rice, pasta, tomato, onion, garlic, carrot, potato";
  const askKitchen = async value => {
    await page.fill("#kitchen-input", value);
    await page.click("#btn-kitchen-find");
    await page.waitForTimeout(600);
  };

  await page.evaluate(() => localStorage.removeItem("cookalong.tonight.v1"));
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(400);
  await askKitchen(FULL_KITCHEN);

  const decision = await page.evaluate(() => {
    const eng = window.CookalongIngredients;
    const have = ["chicken", "beef", "rice", "pasta", "tomato", "onion", "garlic", "carrot", "potato"];
    const s = eng.suggest(eng.matchRecipes(have, window.COOKALONG_RECIPES));
    const card = document.querySelector("#kitchen-results .match-card.is-decided");
    const box = el => { const b = el && el.getBoundingClientRect(); return b ? { top: Math.round(b.top), bottom: Math.round(b.bottom) } : null; };
    const shown = sel => {
      const el = document.querySelector(sel);
      return !!el && getComputedStyle(el).display !== "none";
    };
    return {
      enginePick: s ? s.pick.recipe.name : null,
      engineAlts: s ? s.alternatives.map(a => a.recipe.name) : [],
      domName: card ? card.querySelector("h4").textContent.trim() : null,
      card: box(card),
      head: box(card && card.querySelector(".match-head")),
      gridTop: Math.round(document.getElementById("recipe-grid").getBoundingClientRect().top),
      viewport: window.innerHeight,
      folds: [...document.querySelectorAll("#kitchen-results .kitchen-fold-toggle")].map(t => t.textContent.trim()),
      hint: shown(".kitchen-hint"), chips: shown("#kitchen-chips"), pantry: shown(".kitchen-pantry"),
    };
  });

  record("the banner names the dish the engine ranked first, not a second opinion",
    decision.domName !== null && decision.domName === decision.enginePick,
    `dom="${decision.domName}" engine="${decision.enginePick}"`);
  record("the decision is on the first screen, above the catalogue it came from",
    !!decision.card && decision.card.top < decision.gridTop && decision.head.bottom <= decision.viewport,
    `card ${decision.card && decision.card.top}-${decision.card && decision.card.bottom}, headline to ${decision.head && decision.head.bottom}, grid at ${decision.gridTop}, viewport ${decision.viewport}`);

  const alsoFold = decision.folds.find(f => f.startsWith("Also ready right now"));
  record("the rest of the ranking is folded away rather than competing with the answer",
    !!alsoFold && alsoFold.includes(`(${decision.engineAlts.length})`),
    `fold="${alsoFold}" engine alternatives=${decision.engineAlts.length}`);
  record("the aids that asked the question step aside, but the input and the pantry stay",
    !decision.hint && !decision.chips && decision.pantry,
    JSON.stringify({ hint: decision.hint, chips: decision.chips, pantry: decision.pantry }));

  // Changing the kitchen means the cook is composing again, so the aids return.
  await page.fill("#kitchen-input", FULL_KITCHEN + ", lemon");
  await page.waitForTimeout(250);
  const composing = await page.evaluate(() => ({
    hint: getComputedStyle(document.querySelector(".kitchen-hint")).display !== "none",
    chips: getComputedStyle(document.getElementById("kitchen-chips")).display !== "none",
    headBottom: Math.round(document.querySelector("#kitchen-results .match-card.is-decided .match-head").getBoundingClientRect().bottom),
    viewport: window.innerHeight,
  }));
  record("starting to change the kitchen brings the composing aids back",
    composing.hint && composing.chips, JSON.stringify(composing));

  // Re-asking the same kitchen must not push the answer off the screen again.
  await askKitchen(FULL_KITCHEN);
  const reask = await page.evaluate(() => ({
    hint: getComputedStyle(document.querySelector(".kitchen-hint")).display !== "none",
    headBottom: Math.round(document.querySelector("#kitchen-results .match-card.is-decided .match-head").getBoundingClientRect().bottom),
    viewport: window.innerHeight,
  }));
  record("re-asking the same kitchen keeps the answer where it was",
    !reask.hint && reask.headBottom <= reask.viewport,
    `headline to ${reask.headBottom} of ${reask.viewport}, hint shown=${reask.hint}`);

  // "Another one" is the runner-up, not a re-roll, and the cook's choice sticks.
  await page.click("#kitchen-results .match-card.is-decided .match-another");
  await page.waitForTimeout(400);
  const second = await page.evaluate(() =>
    document.querySelector("#kitchen-results .match-card.is-decided h4").textContent.trim());
  record("another one walks down the same ranking instead of re-rolling",
    decision.engineAlts.length > 0 && second === decision.engineAlts[0],
    `expected "${decision.engineAlts[0]}", got "${second}"`);

  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(500);
  await askKitchen(FULL_KITCHEN);
  const resticky = await page.evaluate(() =>
    document.querySelector("#kitchen-results .match-card.is-decided h4").textContent.trim());
  record("the dish the cook moved past does not come back after a reload",
    resticky === second, `reload gave "${resticky}", expected "${second}"`);

  // A fully stocked kitchen is the one case allowed to claim nothing needs buying.
  const stocked = await page.evaluate(() => {
    const eng = window.CookalongIngredients;
    const r = window.COOKALONG_RECIPES.find(x => {
      const s = eng.suggest(eng.matchRecipes(x.ingredients.map(i => i.canonical), window.COOKALONG_RECIPES));
      return s && s.ready;
    });
    return r ? { name: r.name, listed: r.ingredients.map(i => i.name).join(", ") } : null;
  });
  await askKitchen(stocked ? stocked.listed : "");
  const strict = await page.evaluate(() => {
    const c = document.querySelector("#kitchen-results .match-card.is-decided");
    return c ? { need: c.querySelector(".match-need").textContent, why: c.querySelector(".tonight-why").textContent } : null;
  });
  record("a fully stocked kitchen is told nothing needs buying, and nothing less is",
    !!strict && /nothing to buy/i.test(strict.need) && /You have everything/i.test(strict.why),
    JSON.stringify(strict));

  // An empty kitchen must not be handed a decision at all — but it should still
  // be told what the closest dishes are, rather than being left with a blank.
  await page.evaluate(() => localStorage.removeItem("cookalong.tonight.v1"));
  await askKitchen("salt, pepper");
  const bare = await page.evaluate(() => ({
    decided: !!document.querySelector("#kitchen-results .match-card.is-decided"),
    folds: [...document.querySelectorAll("#kitchen-results .kitchen-fold-toggle")].map(t => t.textContent.trim()),
    note: (document.querySelector("#kitchen-results .kitchen-empty") || {}).textContent || "",
  }));
  record("an empty kitchen gets no decision, only the closest dishes",
    !bare.decided && (bare.folds.length > 0 || bare.note.length > 0),
    JSON.stringify(bare));

  // --- the conversation: state, transcript, and the way out of a dead end ----
  //
  // This is the block that covers the complaint the app was rewritten for: a
  // first-time cook pressed the microphone, saw "Listening… speak a command",
  // said something, and got nothing at all — no answer, no error, no end. The
  // probe that found it showed chromium's SpeechRecognition producing zero
  // events in three and a half seconds: not a start, not a result, not an error.
  //
  // None of that can be caught by a unit test, because public/app.js is never
  // loaded there.

  // Stand in for the microphone. The command table is unit-tested in Node, but
  // nothing there loads app.js, so this is the only way to check the wiring
  // between a heard sentence and the thing it does — which is precisely where
  // the advertised-but-unimplemented command lived. This recogniser fires
  // start, a final result and end, which is the happy path a real one takes.
  //
  // The real one is put back afterwards, because the checks that follow are
  // about what this browser's own recogniser does when it says nothing at all.
  const say = async phrase => {
    await page.evaluate(text => {
      if (!window.__realRecognition) {
        window.__realRecognition = window.SpeechRecognition || null;
      }
      window.__lastMicLang = null;
      window.SpeechRecognition = class {
        start() {
          // Recorded, not assumed: the language the app opens the microphone
          // with is the whole of "does it understand me or not".
          window.__lastMicLang = this.lang;
          const results = [[{ transcript: text }]];
          results[0].isFinal = true;
          setTimeout(() => {
            if (this.onstart) this.onstart();
            if (this.onresult) this.onresult({ resultIndex: 0, results });
            if (this.onend) this.onend();
          }, 60);
        }
        stop() { if (this.onend) this.onend(); }
      };
    }, phrase);
    await page.click("#btn-voice");
    await page.waitForTimeout(700);
  };

  const restoreRealMic = () => page.evaluate(() => {
    if (window.__realRecognition) window.SpeechRecognition = window.__realRecognition;
    else delete window.SpeechRecognition;
  });

  /**
   * The language the screen says the microphone is in.
   *
   * Read off the control a cook reads it off, never out of localStorage: these
   * checks are about the bar and the recogniser agreeing, and a value read from
   * the store would agree with itself no matter what the cook can see. Both
   * controls are returned for the same reason — there are two of them now, and
   * a switcher whose two copies can disagree is a switcher that teaches the
   * wrong phrases.
   */
  const shownLang = () => page.evaluate(() => {
    const eng = window.CookalongVoiceCommands;
    const strip = t => (t || "").replace(/[🌐🎙\s]/g, "");
    const byName = t => eng.LANGS.find(l => l.label === t || l.short === t) || {};
    const bar = document.getElementById("btn-lang");
    const panel = document.getElementById("btn-convo-lang");
    // innerText on the bar, so the two-character form that a narrow screen
    // switches to is not counted as a third name for the same language.
    const barName = strip(bar && (bar.innerText || bar.textContent));
    const panelName = strip(panel && panel.textContent);
    const barFound = byName(barName);
    const panelFound = byName(panelName);
    return {
      id: barFound.id || null,
      label: barName,
      panelId: panelFound.id || null,
      panelLabel: panelName,
      agrees: !!barFound.id && barFound.id === panelFound.id,
      inTopbar: !!(bar && bar.closest("#topbar")),
      inPanel: !!(bar && bar.closest("#conversation-panel")),
      nav: navigator.language,
      taught: [...document.querySelectorAll("#cheatsheet-list .cmd-say")]
        .map(e => e.textContent.replace(/[“”]/g, "")),
    };
  });

  // A fresh document, and therefore a fresh verdict about this browser's
  // recogniser. The app remembers that a microphone was caught never opening —
  // that is the fix — so a check that needs the app to still be willing to try
  // has to start from a page where nothing has failed yet. Reloading is the only
  // honest way to say that; reaching into the app to clear the flag would be
  // testing the flag rather than the behaviour.
  const freshPage = async () => {
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(500);
  };

  // Start from a fresh load: the last thing the harness did was ask the kitchen
  // question, and an answer is deliberately allowed to stand for a few seconds.
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(600);

  const resting = await page.evaluate(() => ({
    state: document.getElementById("voice-status").dataset.state,
    text: document.getElementById("voice-text").textContent,
    button: document.getElementById("btn-voice").classList.contains("active"),
    meter: getComputedStyle(document.querySelector(".voice-meter")).display !== "none",
    kept: JSON.parse(localStorage.getItem("cookalong.voice-log.v1") || "[]").length,
  }));
  record("the top bar rests in a named state instead of implying a live microphone",
    resting.state === "idle" && !resting.button && !resting.meter,
    JSON.stringify({ state: resting.state, button: resting.button, meter: resting.meter }));
  record("the resting line tells a new cook how to talk to this screen, and where the list is",
    /🎙/.test(resting.text) && /💬/.test(resting.text),
    `line="${resting.text}"`);
  record("the conversation survives a reload the way the shopping list does",
    resting.kept > 0, `${resting.kept} turns kept`);

  // An answer is transient. Standing there forever is how the old bar ended up
  // saying something stale while offering nothing.
  await say("what timers are running");
  const answeredState = await page.evaluate(() => document.getElementById("voice-status").dataset.state);
  await page.waitForTimeout(9600);
  const reverted = await page.evaluate(() => ({
    state: document.getElementById("voice-status").dataset.state,
    text: document.getElementById("voice-text").textContent,
  }));
  record("an answer gives the line back, so the screen always offers the next move",
    answeredState === "answered" && reverted.state === "idle" && /🎙/.test(reverted.text),
    `${answeredState} -> ${reverted.state} "${reverted.text}"`);

  // Back to this browser's own recogniser: the checks below are about what it
  // does when it opens the microphone and then says nothing whatsoever.
  await restoreRealMic();

  await page.click("#btn-voice");
  await page.waitForTimeout(300);
  const listening = await page.evaluate(() => ({
    state: document.getElementById("voice-status").dataset.state,
    text: document.getElementById("voice-text").textContent,
    button: document.getElementById("btn-voice").classList.contains("active"),
    meter: getComputedStyle(document.querySelector(".voice-meter")).display !== "none",
  }));
  record("tapping the microphone shows a listening state with a moving level meter",
    listening.state === "listening" && listening.button && listening.meter,
    JSON.stringify(listening));

  // Tapping again stops it. Before this there was no way to end a listen that
  // never started, because the control believed it was already finished.
  await page.click("#btn-voice");
  await page.waitForTimeout(600);
  const stopped = await page.evaluate(() => document.getElementById("voice-status").dataset.state);
  record("tapping the microphone again ends the listen", stopped !== "listening", `state="${stopped}"`);

  // And the dead end itself: with a browser that says it can listen and then
  // says nothing, the screen has to give up and say so.
  //
  // The cook picks a language first, because this block is about a device that
  // cannot listen and not about a language. That is the honest way to ask the
  // question: with a language the cook never chose, the app is entitled to spend
  // one press testing the guess first, and the verdict below would not arrive
  // until the second try. A choice is not a guess and is never tested — which is
  // itself a claim, so it is checked here as well.
  await page.evaluate(() => {
    localStorage.setItem("cookalong.voice-lang.v1",
      /^zh/i.test(navigator.language || "") ? "zh-CN" : "en-US");
    localStorage.setItem("cookalong.voice-lang-chosen.v1", "1");
  });
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(500);

  await page.click("#btn-voice");
  await page.waitForTimeout(4600);
  const afterSilence = await page.evaluate(() => ({
    state: document.getElementById("voice-status").dataset.state,
    text: document.getElementById("voice-text").textContent,
    button: document.getElementById("btn-voice").classList.contains("active"),
    log: JSON.parse(localStorage.getItem("cookalong.voice-log.v1") || "[]"),
  }));
  record("a microphone that never opens ends in words, not in a stuck listening state",
    afterSilence.state !== "listening" && !afterSilence.button &&
      afterSilence.log.some(t => t.who === "cookalong" && /microphone/i.test(t.text)),
    `state="${afterSilence.state}" text="${afterSilence.text}"`);
  record("a language the cook chose is never second-guessed, however empty the microphone is",
    !/Trying .* instead/.test(afterSilence.text),
    `line="${afterSilence.text}"`);

  // The half that was missing. Saying "no microphone" is honest but useless on
  // its own: the cook is left holding a control that has just told them it does
  // not work. Every voice system that survives real hardware has a second input
  // for this, and here it is the command table — whose rows run their own phrase
  // through the same interpreter the microphone feeds.
  const deadButton = await page.evaluate(() =>
    ({ label: (document.getElementById("mic-label").textContent || "").trim() }));
  record("a device that cannot listen stops offering to, and offers the list instead",
    /phrase/i.test(deadButton.label), `button now reads "${deadButton.label}"`);

  await page.click("#btn-voice");
  await page.waitForTimeout(300);
  const fallback = await page.evaluate(() => ({
    open: !document.getElementById("conversation-panel").classList.contains("hidden"),
    rows: document.querySelectorAll("#convo-help-list .cmd-run").length,
    // A real control, not a styled <li>: a Fire TV remote can only land on one.
    buttons: document.querySelectorAll("#convo-help-list button.cmd-run").length,
  }));
  record("and pressing it opens the ways in that work, without waiting to fail again",
    fallback.open && fallback.rows > 5 && fallback.buttons === fallback.rows,
    `open=${fallback.open} ${fallback.rows} rows, ${fallback.buttons} of them real buttons`);

  // The two ways that help could become a trap, both checked. A dialog covers the
  // page, so the microphone underneath it cannot be pressed again — the escape
  // has to be the panel's own Close, and the press after that must retry the
  // microphone rather than reopen the dialog forever.
  await page.click("#btn-convo-close", { timeout: 3000 });
  await page.waitForTimeout(250);
  const escaped = await page.evaluate(() =>
    document.getElementById("conversation-panel").classList.contains("hidden"));
  record("the list it opens can be left with the Close every other dialog here has",
    escaped === true, `panel hidden=${escaped}`);

  await page.click("#btn-voice");
  await page.waitForTimeout(300);
  const retried = await page.evaluate(() => ({
    open: !document.getElementById("conversation-panel").classList.contains("hidden"),
    state: document.getElementById("voice-status").dataset.state,
  }));
  record("and the press after that tries the microphone again instead of reopening the list",
    !retried.open && retried.state === "listening",
    `panel reopened=${retried.open} state="${retried.state}"`);

  // --- a recogniser that opens and then goes quiet ---------------------------

  // The other half of the same trap: if the timeout left the control thinking a
  // session was still running, the next tap would be a request to stop it, and
  // the button would be dead for the rest of the cook. A fresh page so that the
  // microphone is still on offer — see `freshPage`. The language choice made
  // above is put back to a guess here, so the checks that read the default
  // language later are reading the default and not a leftover.
  await page.evaluate(() => {
    localStorage.removeItem("cookalong.voice-lang.v1");
    localStorage.removeItem("cookalong.voice-lang-chosen.v1");
  });
  await freshPage();
  await page.evaluate(() => {
    window.SpeechRecognition = class {
      start() { if (this.onstart) setTimeout(() => this.onstart(), 40); }
      stop() { /* never reports an end — that is the point */ }
    };
  });
  await page.click("#btn-voice");
  await page.waitForTimeout(10600);   // just past LISTEN_LIMIT_MS
  const afterLimit = await page.evaluate(() => ({
    state: document.getElementById("voice-status").dataset.state,
    text: document.getElementById("voice-text").textContent,
  }));
  await page.click("#btn-voice");
  await page.waitForTimeout(400);
  const restarted = await page.evaluate(() =>
    document.getElementById("voice-status").dataset.state);
  record("a listen ended by the timeout says so, and leaves the microphone usable",
    /stopped listening/i.test(afterLimit.text) && restarted === "listening",
    `after="${afterLimit.text}" then="${restarted}"`);
  // ...and the listen this check started has to be closable too, or the control
  // is stuck open for everything that follows.
  await page.click("#btn-voice");
  await page.waitForTimeout(400);
  const closedByTap = await page.evaluate(() =>
    document.getElementById("voice-status").dataset.state);
  record("tapping the microphone closes a listen even when the browser reports no end",
    closedByTap === "idle", `state="${closedByTap}"`);
  await restoreRealMic();

  // --- giving up must close the microphone ----------------------------------

  // The worst bug this feature has had, and the one place it is checkable. A
  // recogniser that never opens is what this browser really produces, so the app
  // gives up and says so. If it only forgets the recogniser instead of closing
  // it, the microphone stays live: it keeps returning results, each result is
  // answered *out loud*, and the microphone hears that answer through the
  // speakers and asks again. Before the fix this spoke 65 times in 14 seconds
  // and was still going.
  //
  // Only `SpeechRecognition` is replaced, never `webkitSpeechRecognition`, so
  // that the fake cannot leak into the checks that follow through the fallback
  // the app prefers. A fresh page first, so the microphone is still on offer.
  await freshPage();
  await page.evaluate(() => {
    window.__spoken = [];
    window.speechSynthesis.speak = u => window.__spoken.push(String(u && u.text));
    window.__loopMic = { aborted: 0, stopped: 0, emitted: 0 };
    window.SpeechRecognition = class {
      start() {
        // Silent: no start event at all, so the never-opened watchdog ends it.
        this.__timer = setTimeout(() => this.creep(), 4000);
      }
      creep() {
        if (this.__dead) return;
        window.__loopMic.emitted += 1;
        const results = [[{ transcript: "next step" }]];
        results[0].isFinal = true;
        if (this.onresult) this.onresult({ resultIndex: 0, results });
        this.__timer = setTimeout(() => this.creep(), 150);
      }
      stop() { window.__loopMic.stopped += 1; this.__dead = true; clearTimeout(this.__timer); }
      abort() { window.__loopMic.aborted += 1; this.__dead = true; clearTimeout(this.__timer); }
    };
  });
  await page.click("#btn-voice");
  await page.waitForTimeout(6000);   // past LISTEN_START_MS, then into the creep
  const loop = await page.evaluate(() => ({
    mic: window.__loopMic,
    spoken: window.__spoken.slice(),
    state: document.getElementById("voice-status").dataset.state,
  }));
  record("a microphone the app has given up on is closed, not merely forgotten",
    loop.mic.aborted > 0 && loop.mic.emitted === 0,
    `aborted=${loop.mic.aborted} emitted=${loop.mic.emitted}`);
  record("and it does not answer itself over and over through that microphone",
    loop.spoken.length <= 1 && loop.state !== "listening",
    `${loop.spoken.length} spoken, state=${loop.state}: ${JSON.stringify(loop.spoken.slice(0, 2))}`);
  await restoreRealMic();

  // --- the spoken path, driven end to end ----------------------------------

  // A fresh page, because the check above deliberately left the app believing
  // this browser's microphone never opens — which is true, and is the whole
  // point of the check. The happy path below stands in for a recogniser that
  // works, and the app will not accept one on a device it has already written
  // off; that refusal is the fix, not an obstacle to it. Starting from an
  // untried page is what a cook with a working microphone has.
  await freshPage();

  // The headline regression: this exact phrase was printed in the cheatsheet and
  // no branch in the app answered it.
  await say("I'm allergic to dairy");
  const allergy = await page.evaluate(() => {
    const chip = [...document.querySelectorAll("#allergen-chips .allergen-chip")]
      .find(c => c.dataset.allergen === "dairy");
    return {
      avoided: chip ? chip.classList.contains("active") : null,
      text: document.getElementById("voice-text").textContent,
      log: JSON.parse(localStorage.getItem("cookalong.voice-log.v1") || "[]"),
    };
  });
  record('"I\'m allergic to dairy" — the command the cheatsheet promised and nothing implemented — now works',
    allergy.avoided === true,
    `chip active=${allergy.avoided}, line="${allergy.text}"`);
  record("what the cook said is written down next to what it answered",
    allergy.log.some(t => t.who === "you" && /allergic to dairy/i.test(t.text)) &&
      allergy.log.some(t => t.who === "cookalong"),
    JSON.stringify(allergy.log.slice(-2)));

  await page.evaluate(() => {
    const chip = [...document.querySelectorAll("#allergen-chips .allergen-chip")]
      .find(c => c.dataset.allergen === "dairy");
    if (chip && chip.classList.contains("active")) chip.click();
  });

  // An utterance the app does not understand has to say so, and point at the
  // list — silence is what makes a cook think the microphone is broken.
  await say("banana submarine");
  const unclear = await page.evaluate(() => {
    const eng = window.CookalongVoiceCommands;
    const bar = document.getElementById("btn-lang");
    const shown = (bar && (bar.innerText || bar.textContent) || "").replace(/[🌐🎙\s]/g, "");
    const found = eng.LANGS.find(l => l.label === shown || l.short === shown) || {};
    const line = document.getElementById("voice-text").textContent;
    return {
      state: document.getElementById("voice-status").dataset.state,
      text: line,
      // The two diagnostics that were missing: the transcript the app acted on,
      // and the language it was listening in when it got it.
      repeatsHeard: /banana submarine/.test(line),
      namesLang: !!found.label && line.indexOf(found.label) !== -1,
      lang: found.id || null,
    };
  });
  record("speech the app cannot place is answered honestly, and points at the list",
    unclear.state === "error" && /💬/.test(unclear.text),
    `state="${unclear.state}" text="${unclear.text}"`);
  // "I didn't catch that" from a program that has just written a confident
  // transcript down tells a cook nothing: it cannot distinguish a misheard word
  // from a microphone that is not hearing anything, and it hides the one cause
  // it cannot see — a recogniser opened in the wrong language.
  record("a miss repeats the words it actually heard, and names the language it was listening in",
    unclear.repeatsHeard && unclear.namesLang,
    `heard=${unclear.repeatsHeard} namesLang=${unclear.namesLang} (${unclear.lang}) "${unclear.text}"`);
  // Words came back, so the language was good enough to hear them. The phrase is
  // what missed, so this path must NOT move the language — otherwise every
  // English cook who says an unknown word loses their English microphone.
  const afterMiss = await shownLang();
  record("a miss does not touch the language, because words coming back means the language worked",
    afterMiss.id === unclear.lang,
    `still ${afterMiss.id} (${afterMiss.label})`);

  // A step command has to reach the recipe on screen, not just the matcher.
  await openRecipe("tomato-basil-pasta");
  await say("next step");
  const stepped = await page.evaluate(() => ({
    label: document.getElementById("step-label").textContent,
    text: document.getElementById("voice-text").textContent,
    state: document.getElementById("voice-status").dataset.state,
  }));
  record("a spoken step command moves the recipe on screen and says where it landed",
    /^Step 2\b/.test(stepped.label) && /Step 2/.test(stepped.text) && stepped.state === "answered",
    JSON.stringify(stepped));
  await page.click("#btn-back");
  await page.waitForTimeout(300);

  // --- the language the microphone listens in -------------------------------

  // "I might speak Chinese or English" is not a nicety. A recognition session
  // takes exactly one language, so a microphone opened in the wrong one does not
  // half-understand the cook — it does not understand them at all, and every
  // phrase the app then teaches is a phrase that cannot work. Language and
  // taught list are checked together for that reason.
  const sortJoin = list => [...list].sort().join("|");

  const started = await shownLang();
  const wantsCn = /^zh/i.test(started.nav);
  record("the microphone starts in the browser's own language, not a fixed one",
    started.id === (wantsCn ? "zh-CN" : "en-US"),
    `navigator.language=${started.nav} -> ${started.id} (${started.label})`);
  record("the language is on the top bar, readable before anything is opened or pressed",
    started.inTopbar === true, `inTopbar=${started.inTopbar}`);

  const other = wantsCn ? "en-US" : "zh-CN";

  // The bar alone, without opening anything. This is the discoverability half
  // of the bug: the setting that decides whether the microphone understands a
  // word at all used to live three taps deep in a dialog, so a cook whose
  // browser is Chinese-defaulted had no way to find out why English did nothing
  // — and no way to fix it once they suspected.
  await page.click("#btn-lang");
  await page.waitForTimeout(500);
  const switched = await shownLang();
  const taughtInOther = await page.evaluate(
    id => window.CookalongVoiceCommands.help(id).map(r => r.say), other);
  record("switching the language takes the taught list with it, in the same breath",
    switched.id === other &&
      switched.taught.length === taughtInOther.length &&
      sortJoin(switched.taught) === sortJoin(taughtInOther),
    `${started.label} -> ${switched.label}, ${switched.taught.length} phrases taught`);
  record("the same tap on the top bar moves the copy in the panel with it, so neither can teach a different setting",
    switched.agrees && switched.panelId === other,
    `bar="${switched.label}" (${switched.id}) panel="${switched.panelLabel}" (${switched.panelId})`);

  // And back, both ways: the panel button is a control a cook still reaches, and
  // a round trip is what proves the two are one switch rather than two. The
  // panel has to be closed before the bar is used again — it is a dialog, and a
  // dialog covers what is under it.
  await page.click("#btn-convo-badge");
  await page.waitForTimeout(300);
  await page.click("#btn-convo-lang");
  await page.waitForTimeout(500);
  const roundTrip = await shownLang();
  record("the panel's own button is the same switch, and the language round-trips through it",
    roundTrip.id === started.id && roundTrip.agrees,
    `${switched.label} -> ${roundTrip.label}, panel agrees=${roundTrip.agrees}`);
  await page.click("#btn-convo-close");
  await page.waitForTimeout(300);
  await page.click("#btn-lang");
  await page.waitForTimeout(400);

  await openRecipe("tomato-basil-pasta");
  await say("next step");
  const openedLang = await page.evaluate(() => window.__lastMicLang);
  record("the microphone opens in the language the cook chose, not the default",
    openedLang === other, `recognition.lang=${openedLang}, wanted ${other}`);

  // A phrase the app teaches in Chinese has to be a phrase the app acts on —
  // spoken, matched, and recorded as what was said.
  const beforeCn = await page.evaluate(() => document.getElementById("step-label").textContent);
  await say("下一步");
  const afterCn = await page.evaluate(() => ({
    label: document.getElementById("step-label").textContent,
    log: JSON.parse(localStorage.getItem("cookalong.voice-log.v1") || "[]").slice(-2),
  }));
  record("a command spoken in Chinese moves the app, and is recorded as said",
    afterCn.label !== beforeCn &&
      afterCn.log.some(t => t.who === "you" && t.text === "下一步"),
    `${beforeCn} -> ${afterCn.label}`);
  await page.click("#btn-back");
  await page.waitForTimeout(300);

  // --- a language nobody chose, and a microphone that says nothing ----------

  // The report this block exists for: "I tried many times and nothing
  // happened". On a machine whose browser is Chinese, the recogniser opens in
  // Chinese; an English sentence then comes back as nothing at all, the table
  // misses, and all the cook was ever told was something about their phrase.
  //
  // The fix is not a smarter guess — it is to spend one press finding out
  // whether the guess was the problem. `SpeechRecognition` listens in exactly
  // one language, so trying the other one is the only test available.
  await page.evaluate(() => {
    localStorage.removeItem("cookalong.voice-lang.v1");
    localStorage.removeItem("cookalong.voice-lang-chosen.v1");
  });
  await freshPage();

  const guessed = await shownLang();
  record("a language the cook never picked is not remembered as a choice",
    guessed.id === (wantsCn ? "zh-CN" : "en-US"),
    `bar shows ${guessed.id} (${guessed.label})`);

  // A recogniser that accepts start() and then emits not one single event — the
  // exact failure that has to be ruled out before the microphone can be blamed.
  // Same shape as the browser this repo really runs on, not a scripted stub.
  await page.evaluate(() => {
    window.SpeechRecognition = class { start() {} stop() {} abort() {} };
  });
  await page.click("#btn-voice");
  await page.waitForTimeout(2200);           // past LISTEN_START_MS
  const probed = await page.evaluate(() => ({
    state: document.getElementById("voice-status").dataset.state,
    text: document.getElementById("voice-text").textContent,
    mic: document.getElementById("mic-label").textContent.trim(),
  }));
  const afterProbe = await shownLang();
  record("a guessed language is moved out of the way before the cook is blamed for it",
    probed.state === "error" && afterProbe.id === VC.otherLang(guessed.id),
    `${guessed.id} -> ${afterProbe.id} (${afterProbe.label}) "${probed.text}"`);
  record("...and the message says which guess it was, and what it is trying instead",
    new RegExp(guessed.label).test(probed.text) && new RegExp(afterProbe.label).test(probed.text),
    `"${probed.text}"`);
  // Before this, one silent try was enough to brand the screen as having no
  // microphone: the button became "Phrases" and the next press opened the list
  // instead of retrying. The language had not even been ruled out yet.
  record("...and the device is not written off while the language is still untested",
    probed.mic !== "Phrases", `mic button reads "${probed.mic}"`);

  // The second silent try is the probe's own result. A search that can only find
  // one answer is not a search — it must put the first language back, or one
  // press leaves the cook stranded in a language they never chose.
  await page.click("#btn-voice");
  await page.waitForTimeout(2200);
  const exhausted = await page.evaluate(() => ({
    text: document.getElementById("voice-text").textContent,
    mic: document.getElementById("mic-label").textContent.trim(),
  }));
  const restored = await shownLang();
  record("a language that was only being tried is put back the moment it fails too",
    restored.id === guessed.id && restored.agrees,
    `${afterProbe.id} -> ${restored.id} (${restored.label})`);
  record("and with both languages ruled out, the verdict is finally about the microphone",
    /both languages/i.test(exhausted.text) && exhausted.mic === "Phrases",
    `mic="${exhausted.mic}" "${exhausted.text}"`);

  await restoreRealMic();
  await page.evaluate(() => {
    localStorage.removeItem("cookalong.voice-lang.v1");
    localStorage.removeItem("cookalong.voice-lang-chosen.v1");
  });
  await freshPage();

  // --- sound in, no words out ------------------------------------------------

  // The failure this app answered worst, and the one this block exists for.
  // Measured on this machine: microphone open, real audio played into it, and
  // both engines report that sound arrived — `soundstart`, `speechstart` — and
  // then one returns an empty result and the other returns nothing at all. The
  // old answer to that was "I did not hear anything — try again, a little closer
  // to the microphone": advice about the one part of the loop the platform had
  // just said was working, given by an app that already had the evidence.
  //
  // A fault injection rather than a scripted stub: the engine is replaced by the
  // exact shape the installed browsers produce — it opens, it reports sound, and
  // the service then has nothing to say about it.
  const wordlessMic = () => page.evaluate(() => {
    window.__opens = 0;
    window.SpeechRecognition = class {
      start() {
        // Counted, because "the microphone opened again" is a question about this
        // call and not about the screen a moment later: this recogniser fails
        // within a tenth of a second, so anything that samples the state
        // afterwards is reading the next failure, not the retry.
        window.__opens += 1;
        setTimeout(() => {
          if (this.onstart) this.onstart();
          if (this.onaudiostart) this.onaudiostart();
          if (this.onsoundstart) this.onsoundstart();
          if (this.onspeechstart) this.onspeechstart();
          setTimeout(() => { if (this.onerror) this.onerror({ error: "no-speech" }); }, 80);
        }, 40);
      }
      stop() { /* never reports an end */ }
      abort() { /* nothing to abort */ }
    };
  });
  const readVerdict = () => page.evaluate(() => {
    const log = JSON.parse(localStorage.getItem("cookalong.voice-log.v1") || "[]");
    const last = [...log].reverse().find(t => t.who === "cookalong");
    return {
      text: document.getElementById("voice-text").textContent,
      state: document.getElementById("voice-status").dataset.state,
      mic: document.getElementById("mic-label").textContent.trim(),
      title: document.getElementById("btn-voice").title,
      say: last ? last.text : "",
      panel: !document.getElementById("conversation-panel").classList.contains("hidden"),
      rows: document.querySelectorAll("#convo-help-list .cmd-run").length,
    };
  });

  await page.evaluate(() => {
    localStorage.setItem("cookalong.voice-lang.v1", "en-US");
    localStorage.setItem("cookalong.voice-lang-chosen.v1", "1");
    localStorage.removeItem("cookalong.voice-log.v1");
  });
  await freshPage();
  await wordlessMic();

  await page.click("#btn-voice");
  await page.waitForFunction(
    () => document.getElementById("voice-status").dataset.state === "error",
    null, { timeout: 4000 });
  const firstWordless = await readVerdict();
  record("a recogniser that reports sound and returns no words is not reported as the cook's silence",
    /no words came back/i.test(firstWordless.text) && !/closer to the microphone/i.test(firstWordless.text),
    `"${firstWordless.text}"`);
  record("...and the message it was measured with never claims the microphone is at fault",
    /speech service/i.test(firstWordless.say) && !/closer/i.test(firstWordless.say),
    `"${firstWordless.say.slice(0, 130)}"`);
  record("...and one such listen is not enough to change what the button does",
    firstWordless.mic === "Voice", `mic="${firstWordless.mic}"`);

  // The second one is the verdict — and it is a verdict about the speech service
  // rather than about the cook's hardware, which is the distinction the old copy
  // had backwards. The press that produces it is also the press that has to hand
  // over the input that works, because from here the microphone is not on offer.
  await page.click("#btn-voice");
  await page.waitForFunction(
    () => !document.getElementById("conversation-panel").classList.contains("hidden"),
    null, { timeout: 4000 });
  const wordlessVerdict = await readVerdict();
  record("twice in a row is a verdict, and it names the speech service, not the microphone",
    wordlessVerdict.mic === "Phrases" && /speech service/i.test(wordlessVerdict.say) &&
      !/microphone is not opening/i.test(wordlessVerdict.say) &&
      /speech service/i.test(wordlessVerdict.title),
    `mic="${wordlessVerdict.mic}" title="${wordlessVerdict.title}" "${wordlessVerdict.say.slice(0, 110)}"`);
  record("...and the press that produced it is the press that opens the list",
    wordlessVerdict.rows > 5, `${wordlessVerdict.rows} selectable rows`);

  // Measured beats assumed, in the one place a cook goes to find out what is
  // wrong. `recognition.supported` reports that the constructor exists, which it
  // does on exactly the screen whose recogniser has just been watched failing.
  await page.click("#btn-convo-close");
  await page.waitForTimeout(200);
  await page.click("#btn-selfcheck");
  await page.waitForTimeout(400);
  const checkRow = await page.evaluate(() => {
    const row = [...document.querySelectorAll("#selfcheck-list .probe-row")]
      .find(r => /Voice input/i.test(r.textContent || ""));
    return row ? row.textContent.replace(/\s+/g, " ").trim() : "";
  });
  record("the device check reports the measurement, not that the API exists",
    /speech service/i.test(checkRow) && /not working/i.test(checkRow),
    `"${checkRow}"`);
  await page.click("#btn-selfcheck-close");
  await page.waitForTimeout(200);

  // And it is not permanent. A written-off input that cannot be tested again is
  // a screen the cook has lost for the rest of the cook, so the press after the
  // verdict opens the microphone once more rather than re-running the verdict.
  // Counted from the recogniser's own `start()`, because this fault fails again
  // immediately — an assertion that read the screen instead would be reading the
  // failure that follows the retry.
  const opensBefore = await page.evaluate(() => window.__opens || 0);
  await page.click("#btn-voice");
  await page.waitForTimeout(700);
  const retry = await page.evaluate(() => ({
    opens: window.__opens || 0,
    mic: document.getElementById("mic-label").textContent.trim(),
  }));
  record("a verdict is not permanent — the press after it opens the microphone again",
    retry.opens > opensBefore,
    `${opensBefore} opens before that press, ${retry.opens} after it (mic="${retry.mic}")`);

  // Whatever that press ended up doing, it has left the app in its own state and
  // may have put the list back up. Closing it is a cleanup, not an assertion, so
  // it must not be able to fail the run.
  await page.click("#btn-convo-close").catch(() => {});
  await page.waitForTimeout(250);
  await restoreRealMic();
  await page.evaluate(() => {
    localStorage.removeItem("cookalong.voice-lang.v1");
    localStorage.removeItem("cookalong.voice-lang-chosen.v1");
    localStorage.removeItem("cookalong.voice-log.v1");
  });
  await freshPage();

  // --- the conductor: one request, a finished job ---------------------------

  // Said in whatever language the app is in right now, read from the table
  // rather than hard-coded: the blocks above move the language about on purpose,
  // and a job that only works in English is exactly what they exist to prevent.
  const langNow = (await shownLang()).id;
  const cnNow = /^zh/i.test(langNow || "");
  const jobPhrase = await page.evaluate(cn => {
    const cmd = window.CookalongVoiceCommands.COMMANDS.find(c => c.id === "agent-dinner");
    return cn ? cmd.cn.say : cmd.say;
  }, cnNow);
  const yesPhrase = cnNow ? "好的" : "yes";

  // A kitchen that is guaranteed to be short of something: three ingredients and
  // no pantry. The job has to be judged on what it did with an incomplete
  // kitchen, because that is the only kitchen where doing the work is worth
  // anything — a complete one needs no list and no plan.
  await page.evaluate(() => localStorage.setItem("cookalong.pantry.v1", "[]"));
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(500);
  await page.fill("#kitchen-input", "chicken, garlic, rice");
  await page.click("#btn-kitchen-find");
  await page.waitForTimeout(400);

  const shopBefore = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("cookalong.shopping.v1") || "[]").length);

  await say(jobPhrase);
  const proposed = await page.evaluate(() => {
    const log = JSON.parse(localStorage.getItem("cookalong.voice-log.v1") || "[]");
    const last = [...log].reverse().find(t => t.who === "cookalong");
    return {
      state: document.getElementById("voice-status").dataset.state,
      say: last ? last.text : "",
      onHome: !document.getElementById("view-home").classList.contains("hidden"),
      onRecipe: !document.getElementById("view-recipe").classList.contains("hidden"),
    };
  });
  record("asking it to sort out dinner answers with a dish and ONE question",
    proposed.state === "answered" && proposed.onHome && !proposed.onRecipe && /[?？]/.test(proposed.say),
    `"${proposed.say.slice(0, 110)}"`);

  // Nothing has happened yet: the app asked, and a question that has already been
  // acted on is not a question. Opening a dish is free; editing the shopping list
  // is not, and that is what the yes is for.
  record("and nothing has happened yet — the dish is not open and the list is untouched",
    proposed.onHome && !proposed.onRecipe,
    `home=${proposed.onHome} recipe=${proposed.onRecipe}`);

  await say(yesPhrase);
  const carried = await page.evaluate(() => {
    const log = JSON.parse(localStorage.getItem("cookalong.voice-log.v1") || "[]");
    const last = [...log].reverse().find(t => t.who === "cookalong");
    return {
      onRecipe: !document.getElementById("view-recipe").classList.contains("hidden"),
      step: document.getElementById("step-label").textContent,
      say: last ? last.text : "",
      shop: JSON.parse(localStorage.getItem("cookalong.shopping.v1") || "[]").length,
    };
  });
  record("a yes carries the whole plan out: the dish is open, on step one",
    carried.onRecipe && /(^|\D)1(\D|$)/.test(carried.step),
    `step="${carried.step}" onRecipe=${carried.onRecipe}`);
  record("...and the shopping it planned is on the list, built by the same engine the button uses",
    carried.shop > shopBefore, `${shopBefore} -> ${carried.shop} lines on the list`);
  record("...and it says the clock was NOT started, so nobody waits for a timer that is not running",
    /have not started|没有帮你启动/.test(carried.say),
    `"${carried.say.slice(0, 120)}"`);

  await page.click("#btn-back");
  await page.waitForTimeout(300);

  // --- hands-free: the microphone comes back by itself ----------------------

  // The mode is the difference between "you can talk to it" and "you can cook
  // without touching anything", so what has to be proved is that no second press
  // happens — that is the whole feature. The count of starts is the evidence.
  await page.evaluate(() => {
    window.__micStarts = 0;
    window.SpeechRecognition = class {
      start() {
        window.__micStarts += 1;
        const mine = window.__micStarts;
        setTimeout(() => {
          if (this.onstart) this.onstart();
          const results = [[{ transcript: mine === 1 ? "what timers are running" : "banana submarine" }]];
          results[0].isFinal = true;
          if (this.onresult) this.onresult({ resultIndex: 0, results });
          if (this.onend) this.onend();
        }, 60);
      }
      stop() { if (this.onend) this.onend(); }
    };
  });

  await page.click("#btn-handsfree");
  // Wait for the behaviour, not for the clock. The app has to read its own answer
  // out loud before it hands the microphone back, so how long this takes depends
  // on the length of the sentence — and the speech engine in a headless browser
  // is the slowest case, because it never fires `onend` for the first utterance
  // and the app has to fall back to its own reading-time budget. A fixed wait
  // would either flake or quietly lie about what it proved.
  let reopened = true;
  try {
    await page.waitForFunction(() => window.__micStarts >= 2, null, { timeout: 25000 });
  } catch (e) { reopened = false; }
  const free = await page.evaluate(() => ({
    on: document.body.dataset.handsfree,
    pressed: document.getElementById("btn-handsfree").getAttribute("aria-pressed"),
    starts: window.__micStarts,
  }));
  record("hands-free re-opens the microphone by itself, with no second press",
    reopened && free.starts >= 2 && free.on === "on" && free.pressed === "true",
    `${free.starts} microphone opens after one press, body data-handsfree=${free.on}`);

  // And the safety half. A device where the microphone never really opens would,
  // under a mode that re-opens unconditionally, fail, apologise, re-open and fail
  // again for as long as the app is on — the self-feeding loop in a new place.
  // The bound on the number of opens is the evidence that it ended: a mode that
  // loops does not stop at two.
  await page.evaluate(() => {
    window.__micStarts = 0;
    window.SpeechRecognition = class {
      start() { window.__micStarts += 1; }        // opens, and then says nothing, ever
      stop() { }
      abort() { }
    };
  });
  let gaveUpCleanly = true;
  try {
    await page.waitForFunction(() => document.body.dataset.handsfree === "off", null, { timeout: 40000 });
  } catch (e) { gaveUpCleanly = false; }
  const gaveUp = await page.evaluate(() => {
    const log = JSON.parse(localStorage.getItem("cookalong.voice-log.v1") || "[]");
    const last = [...log].reverse().find(t => t.who === "cookalong");
    return {
      on: document.body.dataset.handsfree,
      starts: window.__micStarts,
      say: last ? last.text : "",
    };
  });
  record("a hands-free mode that cannot hear anything switches itself off instead of looping",
    gaveUpCleanly && gaveUp.on === "off" && gaveUp.starts >= 1 && gaveUp.starts <= 6 &&
      // Case-insensitive on purpose: the check is that the cook is told the mode
      // ended, not where in the sentence the clause happens to land.
      /hands-free is off|免遥控/i.test(gaveUp.say),
    `body data-handsfree=${gaveUp.on} after ${gaveUp.starts} silent opens — "${gaveUp.say.slice(0, 140)}"`);

  await restoreRealMic();
  await page.evaluate(() => document.body.dataset.handsfree = "off");
  await page.waitForTimeout(200);

  // --- the conversation panel ----------------------------------------------

  const badge = await page.evaluate(() => ({
    text: document.getElementById("convo-badge-text").textContent,
    unread: document.getElementById("btn-convo-badge").classList.contains("has-unread"),
  }));
  record("the chat button counts what has been said since the cook last looked",
    badge.unread && /new/.test(badge.text), JSON.stringify(badge));

  await page.click("#btn-convo-badge");
  await page.waitForTimeout(400);
  const panel = await page.evaluate(() => {
    const box = document.getElementById("conversation-panel");
    const rows = [...document.querySelectorAll("#convo-list .convo-turn")];
    return {
      open: !box.classList.contains("hidden"),
      mine: rows.filter(r => r.classList.contains("you")).length,
      theirs: rows.filter(r => r.classList.contains("cookalong")).length,
      firstWho: rows.length ? rows[0].querySelector(".convo-who").textContent : null,
      empty: !document.getElementById("convo-empty").classList.contains("hidden"),
      badge: document.getElementById("convo-badge-text").textContent,
      inViewport: Math.round(rows.length ? rows[0].getBoundingClientRect().top : -1) < window.innerHeight,
    };
  });
  record("the panel shows both sides of the conversation, on the first screen",
    panel.open && panel.mine > 0 && panel.theirs > 0 && !panel.empty && panel.inViewport,
    JSON.stringify(panel));
  record("opening the panel clears the unread count", !/new/.test(panel.badge), `badge="${panel.badge}"`);

  // The command list behind the same button is generated from the table, so what
  // the panel teaches and what the matcher answers cannot drift apart.
  await page.click("#btn-convo-help");
  await page.waitForTimeout(300);
  const help = await page.evaluate(() => {
    const eng = window.CookalongVoiceCommands;
    if (!eng) return { taught: [], shown: [], sheet: [], scopes: [], lang: "en-US" };
    // Compare against the table in the language the page is actually showing.
    // The app picks its language from the browser, so asserting the English list
    // would make this check pass or fail on the machine's locale rather than on
    // the app — and the thing being checked is that the screen matches the
    // table, whichever language that table is in.
    const label = (document.getElementById("btn-convo-lang") || {}).textContent || "";
    const lang = (eng.LANGS.find(l => l.label === label.replace(/^🎙\s*/, "").trim()) || {}).id || "en-US";
    const table = eng.help(lang);
    const shown = [...document.querySelectorAll("#convo-help-list .cmd-row .cmd-say")]
      .map(el => el.textContent.replace(/[“”]/g, ""));
    const sheet = [...document.querySelectorAll("#cheatsheet-list .cmd-row .cmd-say")]
      .map(el => el.textContent.replace(/[“”]/g, ""));
    return {
      lang,
      taught: table.map(r => r.say),
      shown,
      sheet,
      scopes: [...document.querySelectorAll("#convo-help-list .cmd-scope")].map(el => el.textContent),
    };
  });
  // The panel groups by where a command works, which is a reading order, not the
  // matcher's precedence order — so the same set is the claim, not the same
  // sequence.
  const sorted = list => [...list].sort().join("|");
  record("the help list on screen is the command table, not a copy of it",
    help.shown.length === help.taught.length && sorted(help.shown) === sorted(help.taught),
    `${help.shown.length} shown of ${help.taught.length} in the table (${help.lang})`);
  record("the home-screen cheatsheet renders the same table",
    help.sheet.length === help.taught.length && sorted(help.sheet) === sorted(help.taught),
    `${help.sheet.length} rendered of ${help.taught.length} (${help.lang})`);
  record("the list is grouped by where each command works",
    help.scopes.length >= 2, help.scopes.join(" / "));

  // Escape closes it, and the arrows belong to it while it is open.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const closed = await page.evaluate(() => ({
    open: !document.getElementById("conversation-panel").classList.contains("hidden"),
    focusInside: !!document.activeElement.closest("#conversation-panel"),
  }));
  record("the panel closes on Back and gives focus back to the page",
    !closed.open && !closed.focusInside, JSON.stringify(closed));

  // --- the standing line survives a 720p screen ----------------------------

  const small = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  try {
    await small.goto(URL, { waitUntil: "load" });
    await small.waitForTimeout(500);
    const bar = await small.evaluate(() => {
      const text = document.getElementById("voice-text");
      const status = document.getElementById("voice-status");
      const topbar = document.getElementById("topbar");
      const lang = document.getElementById("btn-lang");
      const box = lang.getBoundingClientRect();
      // What the line WANTS, measured off a clone rather than read from
      // `scrollWidth`. A nowrap element with `text-overflow: ellipsis` reports
      // the width the layout settled on, not the width the sentence needs — so
      // the old version of this check passed for as long as the cap was cutting
      // the sentence short, which is exactly the failure it claims to catch.
      const probe = text.cloneNode(true);
      probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;max-width:none;width:auto;left:-9999px";
      document.body.appendChild(probe);
      const need = Math.round(probe.getBoundingClientRect().width);
      probe.remove();
      return {
        need,
        have: text.clientWidth,
        line: text.textContent,
        barHeight: Math.round(topbar.getBoundingClientRect().height),
        rowHeight: Math.max(...[...topbar.querySelectorAll("button")]
          .filter(b => b.offsetParent !== null)
          .map(b => Math.round(b.getBoundingClientRect().height))),
        statusInBar: Math.round(status.getBoundingClientRect().bottom) <= Math.round(topbar.getBoundingClientRect().bottom) + 1,
        // The seventh control on the bar has to earn its room, and it earns it
        // by still naming a language. An icon-only switcher would leave a cook
        // who cannot read the label with no way to tell which recogniser is
        // listening — the exact position the original bug put them in.
        langName: (lang.innerText || "").trim(),
        langOnScreen: box.width > 0 && box.height > 0 && box.right <= window.innerWidth + 1,
        langInBar: Math.round(box.bottom) <= Math.round(topbar.getBoundingClientRect().bottom) + 1,
      };
    });
    record("at 720p the line telling the cook how to talk fits, rather than being cut off",
      bar.have >= bar.need,
      `needs ${bar.need}px, has ${bar.have}px — line="${bar.line}"`);
    record("the top bar stays one row tall at 720p, so it cannot push the answer off screen",
      bar.barHeight <= 120 && bar.rowHeight <= 60,
      `height=${bar.barHeight}px, tallest control ${bar.rowHeight}px`);
    record("the language still has a name at 720p, and is on screen inside the bar",
      /EN|English|中/.test(bar.langName) && bar.langOnScreen && bar.langInBar,
      `chip="${bar.langName}" onScreen=${bar.langOnScreen} inBar=${bar.langInBar}`);

    // Hands-free is the tightest case the bar has, because the mode that matters
    // most to this app is also the one that makes this line bigger. The attribute
    // is set rather than the mode switched, because what is measured here is the
    // stylesheet at 720p, not the mode.
    const wide = await small.evaluate(async () => {
      const topbar = document.getElementById("topbar");
      const text = document.getElementById("voice-text");
      document.body.dataset.handsfree = "on";
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const probe = text.cloneNode(true);
      probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;max-width:none;width:auto;left:-9999px";
      document.body.appendChild(probe);
      const need = Math.round(probe.getBoundingClientRect().width);
      probe.remove();
      const tallest = Math.max(...[...topbar.querySelectorAll("button")]
        .filter(b => b.offsetParent !== null)
        .map(b => Math.round(b.getBoundingClientRect().height)));
      const out = {
        have: text.clientWidth,
        need,
        barHeight: Math.round(topbar.getBoundingClientRect().height),
        tallest,
      };
      document.body.dataset.handsfree = "off";
      return out;
    });
    record("and it still fits one row in hands-free, the mode that makes the line bigger",
      wide.have >= wide.need && wide.barHeight <= 120 && wide.tallest <= 60,
      `needs ${wide.need}px, has ${wide.have}px, bar ${wide.barHeight}px, tallest control ${wide.tallest}px`);
  } finally {
    await small.close();
  }

  record("no console errors", errors.length === 0, errors.slice(0, 4).join(" | "));

  await browser.close();
  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) { console.log("FAILED: " + failed.map(f => f.name).join("; ")); process.exit(1); }
})().catch(e => { console.error("HARNESS ERROR:", e.message); process.exit(2); });
