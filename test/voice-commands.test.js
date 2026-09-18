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
  const scopes = Object.keys(VC.SCOPE_LABEL);
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
    assert.ok(VC.SCOPE_LABEL[row.scope], `${row.id} is listed under a scope with no label`);
    assert.ok(row.say && row.help);
  });
  // The home-scoped command is the one a first-time cook needs, so it has to be
  // in the list the help screen renders.
  assert.ok(listed.some(r => r.id === "open-recipe"));
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
