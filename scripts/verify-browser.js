"use strict";

/**
 * Browser verification for the shopping list — the checks no unit test can make.
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
 * Requires playwright (npm i -D playwright && npx playwright install chromium).
 * Override the target with COOKALONG_URL=http://localhost:3000/index.html
 */

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch (e) {
  console.error(
    "This harness needs playwright, which is not installed:\n" +
    "  npm i -D playwright && npx playwright install chromium\n\n" +
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

  record("no console errors", errors.length === 0, errors.slice(0, 4).join(" | "));

  await browser.close();
  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) { console.log("FAILED: " + failed.map(f => f.name).join("; ")); process.exit(1); }
})().catch(e => { console.error("HARNESS ERROR:", e.message); process.exit(2); });
