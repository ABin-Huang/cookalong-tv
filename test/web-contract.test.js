"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = rel => fs.readFileSync(path.join(ROOT, rel), "utf8");

const app = read("public/app.js");
const html = read("public/index.html");
const sw = read("public/sw.js");

/** Every id the script looks up with $("...") or getElementById("..."). */
function referencedIds(source) {
  const ids = new Set();
  const re = /\$\(\s*"([^"]+)"\s*\)|getElementById\(\s*"([^"]+)"\s*\)/g;
  let m;
  while ((m = re.exec(source)) !== null) ids.add(m[1] || m[2]);
  return [...ids].sort();
}

/** Every id the markup actually declares. */
function declaredIds(markup) {
  const ids = new Set();
  const re = /\sid="([^"]+)"/g;
  let m;
  while ((m = re.exec(markup)) !== null) ids.add(m[1]);
  return [...ids].sort();
}

const ENGINE_SCRIPTS = {
  COOKALONG_RECIPES: "recipes-data.js",
  CookalongIngredients: "ingredients-engine.js",
  CookalongTimer: "timer-engine.js",
  CookalongCapabilities: "capabilities-engine.js",
  CookalongProgress: "progress-engine.js",
  CookalongServings: "servings-engine.js",
  CookalongPlan: "plan-engine.js",
};

test("every element app.js looks up is actually declared in index.html", () => {
  // A rename on one side only fails at runtime, silently, in whichever handler
  // touches it first — and no unit test loads either file. This is the same
  // model-to-handler drift the skill contract test guards, one layer down.
  const declared = new Set(declaredIds(html));
  const missing = referencedIds(app).filter(id => !declared.has(id));
  assert.deepStrictEqual(
    missing, [],
    `app.js references ids index.html does not declare: ${missing.join(", ")}`
  );
});

test("the app only consumes engines the page actually loads", () => {
  Object.entries(ENGINE_SCRIPTS).forEach(([globalName, file]) => {
    assert.ok(app.includes(`window.${globalName}`), `app.js should consume window.${globalName}`);
    assert.ok(html.includes(`src="${file}"`), `${file} must be loaded by index.html so ${globalName} exists`);
  });
});

test("the service worker pre-caches every script the page needs offline", () => {
  Object.values(ENGINE_SCRIPTS)
    .concat(["app.js", "styles.css", "index.html", "manifest.json", "icon.svg"])
    .forEach(file => assert.ok(
      sw.includes(`"${file}"`) || sw.includes(`"${file}",`),
      `${file} is missing from the service worker shell, so the app breaks offline`
    ));
});

test("the offline cache version was bumped when the shell grew", () => {
  const match = /CACHE_VERSION\s*=\s*"([^"]+)"/.exec(sw);
  assert.ok(match, "the service worker must declare a cache version");
  assert.notStrictEqual(match[1], "cookalong-v7", "the cached shell changed, so the cache must be bumped");
});

test("plan-engine is loaded after the engine it reads durations through", () => {
  // plan-engine resolves window.CookalongTimer at load time, so the order in the
  // markup is load-bearing: reverse it and the plan silently goes empty.
  const timerAt = html.indexOf('src="timer-engine.js"');
  const planAt = html.indexOf('src="plan-engine.js"');
  assert.ok(timerAt !== -1 && planAt !== -1, "both engines must be loaded");
  assert.ok(planAt > timerAt, "plan-engine.js must come after timer-engine.js in index.html");
});

test("the shipped engines are byte-identical to their src/ originals", () => {
  const pairs = [
    ["src/ingredients.js", "public/ingredients-engine.js"],
    ["src/timer.js", "public/timer-engine.js"],
    ["src/capabilities.js", "public/capabilities-engine.js"],
    ["src/progress.js", "public/progress-engine.js"],
    ["src/servings.js", "public/servings-engine.js"],
    ["src/plan.js", "public/plan-engine.js"],
  ];
  const normalize = s => s.replace(/\r\n/g, "\n");
  pairs.forEach(([from, to]) => assert.strictEqual(
    normalize(read(to)), normalize(read(from)),
    `${to} has drifted from ${from} — run npm run build:web`
  ));
});

test("the speech guard is present, not just the speech call", () => {
  // The bug this whole capability layer exists to prevent: calling speak() on a
  // device that has the API and no voices. Guarding on the summarised verdict
  // rather than on the API's existence is the fix, so assert the fix itself.
  assert.match(app, /capSummary\s*&&\s*!capSummary\.spokenPrimary/,
    "speak() must consult the measured verdict, not just window.speechSynthesis");
  assert.match(app, /!capSummary\.canListen/,
    "the microphone button must check whether listening is possible");
});
