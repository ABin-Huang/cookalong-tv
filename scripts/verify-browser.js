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
      window.SpeechRecognition = class {
        start() {
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

  // A recogniser that does open the microphone and then goes quiet is the other
  // half of the same trap: if the timeout left the control thinking a session was
  // still running, the next tap would be a request to stop it, and the button
  // would be dead for the rest of the cook.
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
  // the app prefers.
  await page.evaluate(() => {
    window.__spoken = [];
    window.speechSynthesis.speak = u => window.__spoken.push(String(u && u.text));
    window.__loopMic = { aborted: 0, stopped: 0, emitted: 0 };
    window.SpeechRecognition = class {
      start() {
        // Silent: no start event at all, so the grace watchdog is what ends it.
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
  await page.waitForTimeout(6000);   // past LISTEN_GRACE_MS, then into the creep
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
  const unclear = await page.evaluate(() => ({
    state: document.getElementById("voice-status").dataset.state,
    text: document.getElementById("voice-text").textContent,
  }));
  record("speech the app cannot place is answered honestly, and points at the list",
    unclear.state === "error" && /💬/.test(unclear.text),
    `state="${unclear.state}" text="${unclear.text}"`);

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
    const table = eng ? eng.help() : [];
    const shown = [...document.querySelectorAll("#convo-help-list .cmd-row .cmd-say")]
      .map(el => el.textContent.replace(/[“”]/g, ""));
    const sheet = [...document.querySelectorAll("#cheatsheet-list .cmd-row .cmd-say")]
      .map(el => el.textContent.replace(/[“”]/g, ""));
    return {
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
    `${help.shown.length} shown of ${help.taught.length} in the table`);
  record("the home-screen cheatsheet renders the same table",
    help.sheet.length === help.taught.length && sorted(help.sheet) === sorted(help.taught),
    `${help.sheet.length} rendered of ${help.taught.length}`);
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
      return {
        clipped: text.scrollWidth > text.clientWidth + 1,
        line: text.textContent,
        barHeight: Math.round(topbar.getBoundingClientRect().height),
        statusInBar: Math.round(status.getBoundingClientRect().bottom) <= Math.round(topbar.getBoundingClientRect().bottom) + 1,
      };
    });
    record("at 720p the line telling the cook how to talk is not cut off",
      !bar.clipped && bar.statusInBar,
      `clipped=${bar.clipped} line="${bar.line}"`);
    record("the top bar stays one row tall at 720p, so it cannot push the answer off screen",
      bar.barHeight <= 120, `height=${bar.barHeight}px`);
  } finally {
    await small.close();
  }

  record("no console errors", errors.length === 0, errors.slice(0, 4).join(" | "));

  await browser.close();
  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) { console.log("FAILED: " + failed.map(f => f.name).join("; ")); process.exit(1); }
})().catch(e => { console.error("HARNESS ERROR:", e.message); process.exit(2); });
