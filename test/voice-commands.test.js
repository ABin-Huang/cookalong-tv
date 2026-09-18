"use strict";

/**
 * The command table is the app's promise about what it can hear, so these tests
 * are mostly about the promise being true: every phrase the app teaches has to
 * be a phrase the app answers, and the phrases have to survive each other.
 *
 * None of this needs a browser. The table is a UMD module for exactly this
 * reason — the drift it guards against was invisible until a person tapped the
 * microphone and got "I didn't catch that".
 */

const { test } = require("node:test");
const assert = require("node:assert");

const VC = require("../src/voice-commands.js");
const { RECIPES } = require("../src/recipes.js");
const { COMMON_ALLERGENS } = require("../src/ingredients.js");

/** Everywhere a command could fire: a recipe open on a device with a kitchen. */
const EVERYWHERE = {
  recipes: RECIPES,
  allergens: COMMON_ALLERGENS,
  atHome: true,
  hasRecipe: true,
};

const matchId = (phrase, env) => {
  const hit = VC.findCommand(phrase, env || EVERYWHERE);
  return hit ? hit.id : null;
};

test("every command's own example is answered by that same command", () => {
  // This is the whole point of the table. A phrase the app teaches that does
  // not reach its own rule is a lie told to a first-time cook, and the one that
  // shipped — "I'm allergic to dairy" in the cheatsheet with no branch in the
  // chain — is why the table exists.
  VC.COMMANDS.forEach(command => {
    [command.say, ...(command.samples || [])].forEach(phrase => {
      assert.strictEqual(
        matchId(phrase), command.id,
        `"${phrase}" is taught by ${command.id} but reaches ${matchId(phrase)}`
      );
    });
  });
});

test("every command is reachable on the screen it is scoped to", () => {
  const scopes = VC.SCOPES;
  VC.COMMANDS.forEach(command => {
    assert.ok(scopes.includes(command.scope),
      `${command.id} has scope "${command.scope}", which no label covers`);

    const atHome = { recipes: RECIPES, allergens: COMMON_ALLERGENS, atHome: true, hasRecipe: false };
    const inRecipe = { recipes: RECIPES, allergens: COMMON_ALLERGENS, atHome: false, hasRecipe: true };

    if (command.scope === "always") {
      assert.strictEqual(matchId(command.say, atHome), command.id,
        `${command.id} says it works anywhere, but the home screen ignores it`);
      assert.strictEqual(matchId(command.say, inRecipe), command.id,
        `${command.id} says it works anywhere, but an open recipe ignores it`);
      return;
    }
    // A command scoped elsewhere must stay silent rather than half-work: "next
    // step" on the home screen has to fall through to the honest "didn't catch
    // that", not appear to succeed.
    const wrong = command.scope === "home" ? inRecipe : atHome;
    assert.notStrictEqual(matchId(command.say, wrong), command.id,
      `${command.id} claims an utterance on the screen it is not scoped to`);
  });
});

test("the phrases a cook says for one thing do not get answered by another", () => {
  // Each of these was a real mis-claim in the if/else chain the table replaced.
  // Precedence is invisible in code review, so it gets asserted here.

  // "shopping list" appears in both the read rule and the add rule; the read
  // rule sat first, so adding to the list read it back instead.
  assert.strictEqual(matchId("add to my shopping list"), "add-missing");
  assert.strictEqual(matchId("add what's missing"), "add-missing");
  assert.strictEqual(matchId("read my shopping list"), "read-shopping");
  assert.strictEqual(matchId("what do I need to buy"), "read-shopping");

  // "gluten" appears in both the allergy rule and the gluten-free diet filter;
  // the filter sat first, so declaring an allergy silently filtered instead.
  assert.strictEqual(matchId("I'm allergic to gluten"), "allergy");
  assert.strictEqual(matchId("filter gluten-free"), "diet-gluten-free");

  // The kitchen rule accepts "I have", which swallowed every timer question
  // phrased the way people actually phrase it.
  assert.strictEqual(matchId("I have a timer running"), "timer-status");
  assert.strictEqual(matchId("I have eggs and rice"), "kitchen-match");

  // "read" is the generic step reader; the list reader is the specific one.
  assert.strictEqual(matchId("read the step", { recipes: RECIPES, allergens: COMMON_ALLERGENS, atHome: false, hasRecipe: true }), "read-step");
});

test("the table answers what it can and admits what it cannot", () => {
  // Silence is the correct answer for speech that is not a command — the
  // caller turns it into "I didn't catch that", which is honest. What must not
  // happen is a command claiming speech it does not understand, because then
  // the app does something unrelated to what was said.
  ["banana", "um", "", "   ", "who won the match last night", "play some music"]
    .forEach(phrase => assert.strictEqual(matchId(phrase), null, `"${phrase}" should match nothing`));
});

test("no two commands teach the same phrase, and none is missing its words", () => {
  const seen = new Map();
  VC.COMMANDS.forEach(command => {
    assert.ok(command.id, "every command needs an id");
    assert.ok(command.say && command.say.trim(), `${command.id} teaches no phrase`);
    assert.ok(command.help && command.help.trim(), `${command.id} explains nothing`);
    assert.strictEqual(typeof command.match, "function", `${command.id} has no rule to match with`);
    assert.ok(seen.get(command.id) === undefined, `${command.id} is declared twice`);
    seen.set(command.id, true);

    const taught = VC.normalize(command.say);
    const clash = VC.COMMANDS.find(c => c !== command && VC.normalize(c.say) === taught);
    assert.strictEqual(clash, undefined,
      `${command.id} and ${clash && clash.id} both teach "${command.say}"`);
  });
});

test("the help screen lists every command, with a label for every scope used", () => {
  const listed = VC.help();
  assert.strictEqual(listed.length, VC.COMMANDS.length);
  listed.forEach(row => {
    assert.ok(VC.SCOPE_LABEL.en[row.scope], `${row.id} is listed under a scope with no label`);
    assert.ok(row.say && row.help);
  });
  // The home-scoped command is the one a first-time cook needs, so it has to be
  // in the list the help screen renders.
  assert.ok(listed.some(r => r.id === "open-recipe"));
});

test("every command is taught in Chinese, and in a Chinese that actually works", () => {
  const inCn = VC.help("zh-CN");
  assert.strictEqual(inCn.length, VC.COMMANDS.length);

  VC.COMMANDS.forEach((command, index) => {
    assert.ok(command.cn, `${command.id} has no Chinese form, so it is unusable in Chinese`);
    assert.ok(command.cn.say && command.cn.help,
      `${command.id} has no Chinese phrase or description to teach`);

    // The same promise the English table makes, made in Chinese: a phrase the
    // app teaches has to be a phrase the app answers. A Chinese speaker is
    // handed these, and a list that lies is worse than no list.
    const taught = [command.cn.say].concat(command.cn.samples || []);
    taught.forEach(phrase => {
      assert.strictEqual(matchId(phrase), command.id,
        `"${phrase}" is taught by ${command.id} in Chinese but reaches ${matchId(phrase)}`);
    });

    // And the rendered list must show the Chinese, not the English.
    assert.strictEqual(inCn[index].say, command.cn.say,
      `${command.id} is still advertised in English on a Chinese help screen`);
    assert.ok(!/[a-z]{3}/i.test(inCn[index].say) || /[一-龥]/.test(inCn[index].say),
      `${command.id} teaches a Chinese phrase with no Chinese in it`);
  });

  // Every Chinese phrase has to be distinct, or one silently shadows another.
  const seen = new Set();
  VC.COMMANDS.forEach(c => {
    const key = VC.normalize(c.cn.say);
    assert.ok(!seen.has(key), `two commands both teach the Chinese phrase "${c.cn.say}"`);
    seen.add(key);
  });
});

test("the scope labels are translated, not left in English", () => {
  VC.SCOPES.forEach(scope => {
    assert.ok(VC.SCOPE_LABEL.en[scope], `${scope} has no English label`);
    assert.ok(VC.SCOPE_LABEL.zh[scope], `${scope} has no Chinese label`);
    assert.strictEqual(VC.scopeLabel(scope, "zh-CN"), VC.SCOPE_LABEL.zh[scope]);
    assert.strictEqual(VC.scopeLabel(scope, "en-US"), VC.SCOPE_LABEL.en[scope]);
  });
  assert.ok(/[一-龥]/.test(VC.scopeLabel("always", "zh")));
  assert.ok(!/[一-龥]/.test(VC.scopeLabel("always", "en")));
});

test("every allergen the engine knows can be said in Chinese", () => {
  // The canonical names come from the ingredient engine; the spoken forms live
  // in the voice table. This is the guard that keeps the two in step — an
  // allergen added to the engine without a Chinese word would be silent.
  COMMON_ALLERGENS.forEach(allergen => {
    assert.ok(VC.ALLERGEN_CN[allergen],
      `${allergen} has no Chinese spoken form, so it cannot be declared by voice`);
    assert.ok(VC.ALLERGEN_CN[allergen].length, `${allergen} has an empty Chinese form`);
  });
});

test("an utterance is matched the way a recogniser delivers it, not the way it is typed", () => {
  assert.strictEqual(VC.normalize("Tomato-Basil Pasta?"), "tomato basil pasta");
  assert.strictEqual(VC.normalize("  What's   in my kitchen  "), "what s in my kitchen");
  assert.strictEqual(VC.normalize("冰箱里有鸡蛋"), "冰箱里有鸡蛋");
  assert.strictEqual(VC.normalize(null), "");
  // The rules are written against the normalised form, so the punctuation a
  // recogniser inserts must not be what decides whether a command fires.
  assert.strictEqual(matchId("What's in my kitchen?"), "kitchen-match");
  assert.strictEqual(matchId("Add what's missing!"), "add-missing");
});

test("a dish is only opened when the cook names the whole dish", () => {
  // Naming an ingredient is a question about the kitchen, not a request for a
  // dish. If "chicken" opened Garlic Chicken Rice, the kitchen matcher would be
  // unreachable for half the things a cook actually says.
  assert.strictEqual(VC.findRecipe(VC.normalize("chicken"), RECIPES), null);
  assert.strictEqual(VC.findRecipe(VC.normalize("what can i cook with chicken"), RECIPES), null);
  assert.strictEqual(
    (VC.findRecipe(VC.normalize("cook tomato basil pasta"), RECIPES) || {}).id,
    "tomato-basil-pasta"
  );
  // The length of the name decides, not the order of the catalogue.
  assert.strictEqual(
    (VC.findRecipe(VC.normalize("I want the creamy mushroom risotto tonight"), RECIPES) || {}).id,
    "mushroom-risotto"
  );
});

test("an allergen is recognised in the plural a cook actually uses", () => {
  assert.strictEqual(VC.findAllergen(VC.normalize("i'm allergic to eggs"), COMMON_ALLERGENS), "egg");
  assert.strictEqual(VC.findAllergen(VC.normalize("no nuts please"), COMMON_ALLERGENS), "nuts");
  assert.strictEqual(VC.findAllergen(VC.normalize("i can't eat dairy"), COMMON_ALLERGENS), "dairy");
  assert.strictEqual(VC.findAllergen(VC.normalize("i'm allergic to unicorn"), COMMON_ALLERGENS), null);
});

test("declaring an allergy sets it, and only a denial clears it", () => {
  const allergy = (phrase) => {
    const hit = VC.findCommand(phrase, EVERYWHERE);
    return hit && hit.capture;
  };
  // "I'm allergic to dairy" is an instruction, so it must be idempotent rather
  // than a toggle: saying it twice must not quietly put dairy back on the menu.
  assert.deepStrictEqual(allergy("I'm allergic to dairy"), { allergen: "dairy", remove: false });
  assert.deepStrictEqual(allergy("I'm allergic to dairy again"), { allergen: "dairy", remove: false });
  assert.deepStrictEqual(allergy("I'm not allergic to dairy"), { allergen: "dairy", remove: true });

  // Naming no allergen is still a question the app can answer usefully.
  const vague = allergy("I'm allergic to something");
  assert.ok(vague && vague.allergen === null, "an unnamed allergen should ask which one");
});

test("the kitchen question reaches the matcher whether or not the cook phrases it as one", () => {
  // The kitchen command is the only one whose result becomes a search query, so
  // it has to fire on the sentence and then be readable by the ingredient
  // parser — which reads the normalised words, not the original punctuation.
  assert.strictEqual(matchId("What can I cook with chicken and garlic?"), "kitchen-match");
  assert.strictEqual(matchId("I have chicken, garlic and rice"), "kitchen-match");
  assert.strictEqual(VC.normalize("chicken, garlic and rice"), "chicken garlic and rice");

  // The capture carries nothing: the app re-reads the transcript for the
  // ingredient names, because a dish name and an ingredient list are not the
  // same shape and only the parser knows which is which.
  const hit = VC.findCommand("I have chicken, garlic and rice", EVERYWHERE);
  assert.deepStrictEqual(hit.capture, {});
});

test("turning hands-free off is never read as turning it on", () => {
  // "hands-free off" contains "hands free", so the two entries collide and the
  // order decides. The wrong order turns a request to stop the microphone
  // re-opening into a request to keep it going — the app doing the opposite of
  // what it was told, in the one mode where the cook cannot see it happen.
  const offAt = VC.COMMANDS.findIndex(c => c.id === "hands-free-off");
  const onAt = VC.COMMANDS.findIndex(c => c.id === "hands-free-on");
  assert.ok(offAt !== -1 && onAt !== -1, "both halves of the mode must be in the table");
  assert.ok(offAt < onAt, "hands-free-off must precede hands-free-on, or 'hands-free off' switches it on");

  assert.strictEqual(matchId("hands-free off"), "hands-free-off");
  assert.strictEqual(matchId("turn off hands-free"), "hands-free-off");
  assert.strictEqual(matchId("stop listening"), "hands-free-off");
  assert.strictEqual(matchId("hands-free"), "hands-free-on");
  assert.strictEqual(matchId("keep listening"), "hands-free-on");
  assert.strictEqual(matchId("退出免遥控"), "hands-free-off");
  assert.strictEqual(matchId("免遥控"), "hands-free-on");
});

test("asking the app to sort out dinner is not answered with a list of recipes", () => {
  // The jobs live above the kitchen matcher because "use up what's in my
  // kitchen" contains "what's in my kitchen". Below it, the kitchen rule claims
  // the sentence and answers a cook who asked the app to get on with it with a
  // ranked list — which is what they were trying to avoid asking for.
  const jobs = VC.COMMANDS.filter(c => c.id.startsWith("agent-")).map(c => c.id);
  const kitchenAt = VC.COMMANDS.findIndex(c => c.id === "kitchen-match");
  assert.ok(jobs.length >= 2, "the conductor's jobs have to be taught");
  jobs.forEach(id => {
    assert.ok(VC.COMMANDS.findIndex(c => c.id === id) < kitchenAt,
      `${id} sits below kitchen-match and will be swallowed by it`);
  });

  assert.strictEqual(matchId("use up what's in my kitchen"), "agent-use-it-up");
  assert.strictEqual(matchId("sort out dinner"), "agent-dinner");
  assert.strictEqual(matchId("把冰箱里的东西用掉"), "agent-use-it-up");
  assert.strictEqual(matchId("帮我定个晚饭"), "agent-dinner");

  // ...and the kitchen question itself still reaches the kitchen matcher.
  assert.strictEqual(matchId("what's in my kitchen"), "kitchen-match");
  assert.strictEqual(matchId("冰箱里有鸡蛋"), "kitchen-match");
});

test("a job carries its goal, so the app does not need a second registration", () => {
  // The app routes any capture that carries a goal to the conductor, which is
  // how a job added to AGENT.GOALS works without another line in app.js — and
  // how one added there cannot end up taught but unhandled.
  const hit = VC.findCommand("sort out dinner", EVERYWHERE);
  assert.ok(hit.capture && hit.capture.goal === "dinner",
    "the capture has to name the goal, or the app cannot run it");
  VC.COMMANDS.filter(c => c.id.startsWith("agent-")).forEach(command => {
    const own = VC.findCommand(command.say, EVERYWHERE);
    assert.ok(own.capture && own.capture.goal,
      `${command.id} is taught but carries no goal for the app to run`);
  });
});
