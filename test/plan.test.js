"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

const P = require("../src/plan");
const T = require("../src/timer");
const S = require("../src/servings");
const I = require("../src/ingredients");
const { RECIPES } = require("../src/recipes");

const byId = id => RECIPES.find(r => r.id === id);

/** [[stepIndex, seconds], ...] — the shape the plan is judged on. */
const shape = steps => P.timedSteps(steps).map(e => [e.index, e.seconds]);

// ---------------------------------------------------------------------------
// reading a step's own time
// ---------------------------------------------------------------------------

test("the plan finds the step that names a time, and remembers which step it was", () => {
  const steps = [
    "Heat a pan over medium heat.",                          // 0 — no time
    "Add the garlic and cook for 1 minute until fragrant.",   // 1
    "Season with salt and pepper.",                          // 2 — no time
    "Cover and simmer for 18 minutes, stirring often.",       // 3
  ];
  assert.deepStrictEqual(shape(steps), [[1, 60], [3, 1080]]);
  const timed = P.timedSteps(steps);
  assert.strictEqual(timed[1].text, steps[3], "the entry carries the step it came from");
});

test("a step that names no time is left out rather than guessed at", () => {
  assert.deepStrictEqual(P.timedSteps(["Drain the pasta.", "Serve immediately."]), []);
  assert.strictEqual(P.longest(["Drain the pasta."]), null, "no timed step means nothing to offer");
  assert.deepStrictEqual(P.summary(["Drain the pasta."]).steps, []);
});

test("a step that names a time twice reports the longest, which is what the timer offers", () => {
  // Documented behaviour of stepDurationSeconds, not a new rule: "cook the onion
  // for 3 minutes, then add mushrooms for 4" is one 4-minute wait worth a timer.
  const step = ["Heat the oil, cook the onion for 3 minutes, then add mushrooms for 4 minutes."];
  assert.deepStrictEqual(shape(step), [[0, 240]]);
  assert.strictEqual(T.stepDurationSeconds(step[0]), 240, "the plan is not inventing its own reading");
});

test("a per-side instruction is doubled in the plan, exactly as the timer button doubles it", () => {
  assert.deepStrictEqual(shape(["Cook the bread for 2 to 3 minutes per side."]), [[0, 360]]);
});

test("the longest entry is the maximum, and a tie goes to the step the cook meets first", () => {
  const tie = ["Stir-fry for 2 minutes.", "Add the pepper and stir-fry for 2 minutes."];
  assert.strictEqual(P.longest(tie).index, 0, "two equal waits: the earlier step is the one to point at");

  const later = ["Stir-fry for 2 minutes.", "Cover and simmer for 25 minutes."];
  assert.strictEqual(P.longest(later).index, 1);
  assert.strictEqual(P.longest(later).seconds, 1500);
});

// ---------------------------------------------------------------------------
// the summary
// ---------------------------------------------------------------------------

test("the summary counts the timed steps and sums only what the steps state", () => {
  const steps = ["Cook for 1 minute.", "Rest for 5 minutes.", "Serve."];
  const s = P.summary(steps);
  assert.strictEqual(s.totalCount, 3);
  assert.strictEqual(s.timedCount, 2);
  assert.strictEqual(s.namedSeconds, 360);
  assert.strictEqual(s.longest.index, 1);
  assert.strictEqual(s.steps.length, 2);
});

test("nothing in the summary claims a total cook time", () => {
  // Chopping and plating are not timed, and two steps can run at once, so the sum
  // of what the steps state is not how long the dish takes. The field is named
  // for exactly what it is so no caller can quietly promote it into a duration.
  const s = P.summary(["Cook for 1 minute."]);
  assert.ok(Object.prototype.hasOwnProperty.call(s, "namedSeconds"));
  assert.ok(!Object.prototype.hasOwnProperty.call(s, "totalSeconds"));
  assert.ok(!Object.prototype.hasOwnProperty.call(s, "cookTimeSeconds"));
});

// ---------------------------------------------------------------------------
// the corpus: what each shipped recipe actually plans out
// ---------------------------------------------------------------------------

test("every shipped recipe plans out exactly the steps that name a time", () => {
  // Pinned as a table because this is what the panel shows on screen: if a recipe
  // is edited so a step loses (or gains) a duration, the cook-visible plan changes
  // and that edit should have to say so on purpose.
  const expected = {
    "tomato-basil-pasta": [[0, 540], [2, 60], [3, 480]],
    "vegetable-stir-fry": [[2, 120], [3, 120], [5, 60]],
    "garlic-chicken-rice": [[1, 480], [2, 30], [3, 60], [5, 1080], [6, 300]],
    "fluffy-french-toast": [[1, 20], [3, 360]],
    "mushroom-risotto": [[2, 240], [3, 60], [4, 1080], [6, 120]],
    "tofu-scramble": [[2, 10], [3, 240], [4, 120]],
    "beef-broccoli": [[3, 120], [4, 180], [5, 60]],
    "banana-oat-pancakes": [[2, 180], [4, 240]],
    "lemon-garlic-shrimp": [[2, 30], [3, 240]],
    "hearty-chicken-soup": [[2, 180], [3, 240], [5, 1500]],
  };
  RECIPES.forEach(recipe => {
    assert.ok(expected[recipe.id], `${recipe.id} is not in the plan table — add it, do not skip it`);
    assert.deepStrictEqual(shape(recipe.steps), expected[recipe.id], `${recipe.id} plan changed`);
  });
  assert.strictEqual(Object.keys(expected).length, RECIPES.length, "the table covers every recipe");
});

test("no shipped recipe has an empty plan, so the panel is never dead UI", () => {
  RECIPES.forEach(recipe => {
    const s = P.summary(recipe.steps);
    assert.ok(s.timedCount > 0, `${recipe.id} names no time anywhere`);
    assert.ok(s.longest && s.longest.seconds > 0, `${recipe.id} has no longest step`);
    assert.strictEqual(s.namedSeconds, s.steps.reduce((n, e) => n + e.seconds, 0));
  });
});

test("every planned time is a length a timer would actually accept", () => {
  // The engine's own floor is 5s and its ceiling 6h; anything outside would be a
  // number the timer button could not offer, so a plan row would be a dead end.
  RECIPES.forEach(recipe => {
    P.timedSteps(recipe.steps).forEach(e => {
      assert.ok(e.seconds >= 5, `${recipe.id} step ${e.index + 1} plans an unusable ${e.seconds}s`);
      assert.ok(e.seconds <= 6 * 3600, `${recipe.id} step ${e.index + 1} plans ${e.seconds}s`);
    });
  });
});

test("the longest planned step is the step the timer would offer the longest wait for", () => {
  RECIPES.forEach(recipe => {
    const fromSteps = recipe.steps.map(s => T.stepDurationSeconds(s)).filter(Boolean);
    const max = Math.max(...fromSteps);
    assert.strictEqual(P.longest(recipe.steps).seconds, max,
      `${recipe.id}: the plan and the timer button disagree about the longest wait`);
  });
});

// ---------------------------------------------------------------------------
// the plan survives the other engines — this is the point of the sweep
// ---------------------------------------------------------------------------

test("rescaling a recipe changes which pot, never how long", () => {
  // The whole reason the plan is safe to show next to a servings stepper: the
  // amounts rewrite and the times do not, so the plan is identical at every yield.
  [0.5, 2, 3].forEach(factor => {
    RECIPES.forEach(recipe => {
      const heads = S.ingredientHeads(recipe.ingredients);
      const scaled = recipe.steps.map(step => S.scaleStepText(step, factor, heads));
      assert.deepStrictEqual(shape(scaled), shape(recipe.steps),
        `${recipe.id} at x${factor}: scaling moved a cooking time`);
    });
  });
});

test("swapping an ingredient rewrites the step and leaves every time alone", () => {
  let swapsChecked = 0;
  RECIPES.forEach(recipe => {
    const profile = { diets: recipe.diet || [], allergens: [] };
    (recipe.ingredients || []).forEach(ing => {
      const info = I.listSubstitutes(recipe, ing.canonical, profile);
      const option = (info.compatible || [])[0];
      if (!option) return;
      const shown = I.displayName(ing.canonical);
      const names = [ing.name, shown, shown.replace(/s$/, "")];
      const { steps } = I.substituteInSteps(recipe.steps, names, option.name);
      assert.deepStrictEqual(shape(steps), shape(recipe.steps),
        `${recipe.id}: swapping ${ing.canonical} -> ${option.name} moved a cooking time`);
      swapsChecked += 1;
    });
  });
  assert.ok(swapsChecked >= 20, `expected the corpus to exercise real swaps, only saw ${swapsChecked}`);
});

// ---------------------------------------------------------------------------
// robustness
// ---------------------------------------------------------------------------

test("junk input produces an empty plan instead of a crash", () => {
  const junk = [null, undefined, "not an array", 42, {}, []];
  junk.forEach(value => {
    assert.deepStrictEqual(P.timedSteps(value), []);
    assert.strictEqual(P.longest(value), null);
    assert.deepStrictEqual(P.summary(value).steps, []);
    assert.strictEqual(P.summary(value).namedSeconds, 0);
  });
  assert.deepStrictEqual(P.timedSteps([null, undefined, 42, "", "Cook for 2 minutes."]).map(e => e.index), [4]);
});

test("the plan hands back its own objects, so a caller cannot poison the next read", () => {
  const first = P.timedSteps(["Cook for 2 minutes."]);
  first[0].seconds = 99999;
  assert.strictEqual(P.timedSteps(["Cook for 2 minutes."])[0].seconds, 120,
    "a mutated entry must not survive into the next call");
});
