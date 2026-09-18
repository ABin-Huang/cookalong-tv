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
  CookalongShopping: "shopping-engine.js",
  CookalongAgent: "agent-engine.js",
  CookalongVoiceCommands: "voice-commands-engine.js",
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

test("shopping-engine is loaded after both engines it resolves at load time", () => {
  // shopping-engine is the only engine that needs two others, and it takes them
  // as factory arguments: `factory(CookalongServings, CookalongIngredients)`.
  // Load it before either and it is built with a missing engine — amounts stop
  // being scaled and spoken wrong, and nothing throws. Same silent-empty failure
  // as the plan/timer pair above, so it gets the same guard.
  const order = ["ingredients-engine.js", "servings-engine.js", "shopping-engine.js"]
    .map(f => ({ f, at: html.indexOf(`src="${f}"`) }));
  order.forEach(({ f, at }) => assert.ok(at !== -1, `${f} must be loaded by index.html`));
  assert.ok(order[1].at > order[0].at, "servings-engine.js must come after ingredients-engine.js");
  assert.ok(order[2].at > order[0].at, "shopping-engine.js must come after ingredients-engine.js");
  assert.ok(order[2].at > order[1].at, "shopping-engine.js must come after servings-engine.js");
});

test("agent-engine is loaded after all four engines it composes", () => {
  // The conductor resolves its collaborators as factory arguments, so loading it
  // early builds it with missing engines. It then cannot rank, cannot plan and
  // cannot list a purchase — and because it never throws, the symptom is an
  // agent that politely refuses every job. Same silent-empty shape as the two
  // ordering traps above, so it gets the same guard.
  const deps = ["ingredients-engine.js", "plan-engine.js", "shopping-engine.js", "timer-engine.js"];
  const agentAt = html.indexOf('src="agent-engine.js"');
  assert.ok(agentAt !== -1, "index.html must load agent-engine.js");
  deps.forEach(dep => {
    const at = html.indexOf(`src="${dep}"`);
    assert.ok(at !== -1, `${dep} must be loaded by index.html`);
    assert.ok(agentAt > at, `agent-engine.js must come after ${dep}`);
  });

  // And the command table teaches the agent's goals, so it has to exist first.
  const voiceAt = html.indexOf('src="voice-commands-engine.js"');
  assert.ok(voiceAt > agentAt,
    "voice-commands-engine.js must come after agent-engine.js — it renders the agent's goals as taught commands");
});

test("the conductor's jobs are taught, and taught above the question they are made of", () => {
  // "Use up what's in my kitchen" contains "what's in my kitchen", which the
  // kitchen matcher also claims. Order is the whole fix: get it wrong and a cook
  // who asked the app to get on with dinner is handed a list of recipes, with
  // nothing in the output to say why. Precedence is invisible in review, so it
  // is asserted here and in test/voice-commands.test.js.
  const VOICE = require("../src/voice-commands.js");
  const ids = VOICE.COMMANDS.map(c => c.id);
  const agent = ids.filter(id => id.startsWith("agent-"));
  assert.ok(agent.length >= 2, "every agent goal must appear in the command table");

  const kitchenAt = ids.indexOf("kitchen-match");
  agent.forEach(id => {
    assert.ok(ids.indexOf(id) < kitchenAt,
      `${id} must sit above kitchen-match, or the kitchen matcher steals its phrases`);
  });

  // A taught phrase is a promise the table has to keep: it must reach its own
  // command, in both languages.
  ["en-US", "zh-CN"].forEach(lang => {
    const cn = lang.startsWith("zh");
    agent.forEach(id => {
      const declared = VOICE.COMMANDS.find(c => c.id === id);
      const phrase = cn ? declared.cn.say : declared.say;
      const hit = VOICE.findCommand(phrase, { recipes: require("../src/recipes.js").RECIPES });
      assert.ok(hit && hit.id === id,
        `the taught phrase "${phrase}" must reach ${id}, but reached ${hit && hit.id}`);
    });
  });
});

test("the shipped engines are byte-identical to their src/ originals", () => {
  const pairs = [
    ["src/ingredients.js", "public/ingredients-engine.js"],
    ["src/timer.js", "public/timer-engine.js"],
    ["src/capabilities.js", "public/capabilities-engine.js"],
    ["src/progress.js", "public/progress-engine.js"],
    ["src/servings.js", "public/servings-engine.js"],
    ["src/plan.js", "public/plan-engine.js"],
    ["src/shopping.js", "public/shopping-engine.js"],
    ["src/agent.js", "public/agent-engine.js"],
    ["src/voice-commands.js", "public/voice-commands-engine.js"],
  ];
  const normalize = s => s.replace(/\r\n/g, "\n");
  pairs.forEach(([from, to]) => assert.strictEqual(
    normalize(read(to)), normalize(read(from)),
    `${to} has drifted from ${from} — run npm run build:web`
  ));
});

test("the decision is rendered above the catalogue it was chosen from", () => {
  // The home screen promises one decision, and a decision is only a decision if
  // it is on the first screen. #kitchen originally sat below #recipe-grid, which
  // put the answer about 1200px down a 1080p TV — you had to scroll past ten
  // recipes to read the single line the app exists to say. Markup order was the
  // whole fix, so markup order is what gets asserted.
  //
  // The chips stay above the kitchen because they scope the decision, not just
  // the grid: runKitchenMatch() reads the active diet and the allergy profile.
  // Reading order is scope -> question -> answer -> catalogue.
  const at = id => html.indexOf(`id="${id}"`);
  ["filters", "allergens", "kitchen", "recipe-grid"].forEach(id =>
    assert.ok(at(id) !== -1, `index.html must declare #${id}`));
  assert.ok(at("filters") < at("kitchen"),
    "#filters must come before #kitchen — it scopes the decision, so it has to be read first");
  assert.ok(at("allergens") < at("kitchen"),
    "#allergens must come before #kitchen — it scopes the decision, so it has to be read first");
  assert.ok(at("kitchen") < at("recipe-grid"),
    "#kitchen must come before #recipe-grid, or the decision falls below the fold on a 10-ft screen");
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

test("the voice command table is loaded before the script that matches with it", () => {
  // app.js resolves window.CookalongVoiceCommands at parse time and both the
  // matcher and the rendered cheatsheet read it. Reorder the tags and every
  // spoken command falls through to "I didn't catch that" — the exact failure
  // this table was introduced to make impossible.
  const engineAt = html.indexOf('src="voice-commands-engine.js"');
  const appAt = html.indexOf('src="app.js"');
  assert.ok(engineAt !== -1, "index.html must load voice-commands-engine.js");
  assert.ok(appAt !== -1, "index.html must load app.js");
  assert.ok(engineAt < appAt,
    "voice-commands-engine.js must come before app.js, or the matcher has no table to read");
});

test("the advertised commands are generated from the table, never typed into the markup", () => {
  // The list that used to live here had drifted: it offered "I'm allergic to
  // dairy" and no branch in app.js answered it. A hand-written list of what the
  // app understands is a promise nobody checks, so the markup must not contain
  // one — it holds an empty <ul> and the table fills it at boot.
  const sheet = html.slice(html.indexOf('id="voice-cheatsheet"'));
  const body = sheet.slice(0, sheet.indexOf("</aside>"));
  assert.ok(body.includes('id="cheatsheet-list"'),
    "the cheatsheet must have a list for the command table to fill");
  assert.ok(!/<li[^>]*>[^<]*["“]/i.test(body),
    "the cheatsheet still has a hand-typed command in it — render it from src/voice-commands.js instead");

  // And the app has to actually fill both places the table is taught.
  assert.match(app, /renderCommandList\(\$\("cheatsheet-list"\)\)/,
    "app.js must render the command table into the cheatsheet");
  assert.match(app, /renderCommandList\(\$\("convo-help-list"\)\)/,
    "app.js must render the command table into the help panel");
});

test("the conversation is shown in the top bar and written down in the panel", () => {
  // Two halves of one complaint: the cook could not tell that the app was
  // listening, and could not see afterwards what had been said. The state has to
  // reach the top bar, and the transcript has to reach the panel — and both have
  // to be driven from one place, or half of each exchange goes missing.
  ["idle", "listening", "thinking", "answered"].forEach(state =>
    assert.ok(app.includes(`"${state}"`), `app.js never sets the "${state}" voice state`));

  assert.match(app, /dataset\.state\s*=\s*state/,
    "the top bar must carry the voice state where the stylesheet can show it");
  assert.match(app, /function answer\(/, "there must be one funnel every answer goes through");
  assert.match(app, /logTurn\("you"/, "what the cook said must be recorded, not just what was answered");
  assert.match(app, /function renderConvo\(/, "the panel must render the transcript");

  // The dead end the probe found: chromium accepts start() and emits nothing at
  // all, so a listening state with no timeout is a screen that lies forever.
  // Two deadlines, not one: a microphone that never opened has to be told apart
  // from an utterance that is still going, or every silence costs the full wait.
  assert.match(app, /LISTEN_START_MS/, "there must be a deadline for a microphone that never opens");
  assert.match(app, /LISTEN_LIMIT_MS/, "there must be a timeout for an utterance that never ends");
  assert.match(app, /RECOGNITION_ERRORS/, "recognition failures must be turned into words");
});

test("the microphone's liveness is measured, not inferred from the constructor", () => {
  // The bug behind "the voice interaction is completely unusable": capability
  // was decided by `!!SpeechRecognition`, which is true in a browser that emits
  // zero events. Existence of the API is not evidence that it works, so the app
  // has to record what it actually saw and act on that.
  assert.match(app, /let voiceInputDead\s*=\s*false/,
    "the app must carry the measured verdict about this device's recogniser");
  assert.match(app, /voiceInputDead\s*=\s*true/,
    "a recogniser caught never starting must be recorded as such");
  assert.match(app, /voiceInputDead\s*=\s*false/,
    "a recogniser that does start must be allowed to clear the verdict");
  // And the verdict has to change what the button does, not just what it says.
  assert.match(app, /function offerPhrasesInstead\(/,
    "a device that cannot listen must be given the input that does work");
  assert.match(app, /interpret\(row\.say\)/,
    "selecting a phrase must run it through the same interpreter the microphone feeds");
  assert.match(app, /className = "cmd-run"/,
    "the command rows must be real controls a D-pad can land on");
});

test("a press on the microphone can interrupt the app", () => {
  // Barge-in. Without it "stop, I meant something else" costs the whole answer.
  assert.match(app, /speechSynthesis\.cancel\(\)/,
    "pressing the microphone must be able to cut the app off mid-sentence");
  assert.match(app, /ANSWER_REST_MS[\s\S]*ERROR_REST_MS/,
    "an answer and a failure must not hold the top bar for the same length of time");
});
