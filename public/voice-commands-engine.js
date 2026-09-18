"use strict";

/**
 * CookAlong TV - what you can say to this screen, in one table.
 *
 * The app used to teach its spoken commands in three places that could drift
 * apart: the cheatsheet typed into index.html, the if/else chain in app.js, and
 * the standing line in the topbar. They had already drifted, in both
 * directions:
 *
 *   - the cheatsheet offered "I'm allergic to dairy" and no branch in the chain
 *     answered it, so the one list a new cook is handed contained a phrase that
 *     did nothing;
 *   - "add to my shopping list" was claimed by the read-the-list rule, which
 *     sits earlier in the chain, so it read the list back instead of adding to
 *     it;
 *   - "I have a timer running" was claimed by the kitchen matcher, because that
 *     rule and the timer rules both key off phrases a cook uses for something
 *     else.
 *
 * A prompt that lies is worse than no prompt. A cook who is told to say
 * something, says it, and is told "I didn't catch that" concludes the
 * microphone is broken — and hands-free is the entire product, so that is the
 * one conclusion this app cannot afford.
 *
 * So the commands live here, once. Each entry carries the phrase the app
 * teaches, the rule that recognises it, and what it is for. The cheatsheet and
 * the help panel are both rendered from this table, the matcher walks this
 * table, and a test feeds every entry its own examples — so a phrase the app
 * teaches is a phrase the app answers, by construction.
 *
 * ORDER IS PRECEDENCE. The table is scanned top to bottom and the first entry
 * to claim an utterance handles it, so the specific must sit above the general:
 * "add what's missing" has to be reached before "shopping list", and
 * "I'm allergic to gluten" has to be reached before "gluten-free". Adding an
 * entry in the wrong place silently steals utterances from the one below it,
 * which is why the test suite asserts the ordering traps explicitly.
 *
 * UMD bundle: works as a CommonJS module (Node tests) and as
 * `window.CookalongVoiceCommands` in the Fire TV Web App.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.CookalongVoiceCommands = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {

  /**
   * Fold an utterance to something matchable: lower case, punctuation to
   * spaces, runs of space collapsed. "Tomato-basil pasta?" and "tomato basil
   * pasta" have to normalise to the same string, because a cook does not type
   * and a recogniser does not punctuate the way a keyboard does.
   *
   * Note the consequence for the rules below: an apostrophe becomes a space,
   * so "what's" normalises to "what s" and "can't" to "can t". Every pattern in
   * this file is written against the normalised form, not the written form.
   * CJK is kept, because the kitchen matcher accepts Chinese ingredient lists.
   */
  function normalize(text) {
    return String(text == null ? "" : text)
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
      .trim();
  }

  /** Does the utterance contain any of these phrases? */
  function has(t, ...phrases) {
    return phrases.some(p => t.includes(p));
  }

  /**
   * Which recipe, if any, the cook just named.
   *
   * The whole name has to appear — "chicken" alone must not open Garlic Chicken
   * Rice, because "what can I cook with chicken" is a question about the
   * kitchen, not a request for a specific dish. Longest name wins, so a dish
   * whose name contains another's stays reachable.
   */
  function findRecipe(t, recipes) {
    let best = null;
    let bestLength = 0;
    (recipes || []).forEach(recipe => {
      const name = normalize(recipe && recipe.name);
      if (!name || !t.includes(name)) return;
      if (name.length <= bestLength) return;
      best = recipe;
      bestLength = name.length;
    });
    return best;
  }

  /** The allergen a cook just named, allowing for the plural they actually say. */
  function findAllergen(t, known) {
    const words = new Set(t.split(" ").filter(Boolean));
    const singular = w => w.replace(/s$/, "");
    return (known || []).find(allergen => {
      const a = normalize(allergen);
      return words.has(a) || words.has(a + "s") || words.has(singular(a));
    }) || null;
  }

  const COMMANDS = [
    /* -- allergies -----------------------------------------------------------
     * First, because it is the only command whose own words collide with
     * another command's: "I'm allergic to gluten" contains "gluten", and the
     * diet filter below would otherwise claim it and silently narrow the
     * catalogue instead of setting an allergy.
     */
    {
      id: "allergy",
      scope: "always",
      say: "I'm allergic to dairy",
      help: "leave an ingredient out of every recipe",
      samples: ["i am allergic to nuts", "I can't eat shellfish", "leave out gluten", "I'm not allergic to soy"],
      match(ctx) {
        if (!has(ctx.t, "allerg", "can t eat", "leave out")) return null;
        const remove = /\bnot allerg|no longer allerg|stop avoiding|i can eat|forget the/.test(ctx.t);
        return { allergen: findAllergen(ctx.t, ctx.allergens), remove };
      },
    },

    /* -- opening a dish ------------------------------------------------------ */
    {
      id: "open-recipe",
      scope: "home",
      say: "cook tomato basil pasta",
      help: "open a recipe by saying its name",
      samples: ["open garlic chicken rice", "cook beef and broccoli", "cook creamy mushroom risotto"],
      match(ctx) {
        const recipe = ctx.findRecipe();
        return recipe ? { recipe } : null;
      },
    },

    /* -- diet filters -------------------------------------------------------- */
    {
      id: "diet-vegan",
      scope: "always",
      say: "filter vegan",
      help: "show only vegan recipes",
      match(ctx) {
        return ctx.t.includes("vegan") ? { diet: "vegan" } : null;
      },
    },
    {
      id: "diet-vegetarian",
      scope: "always",
      say: "filter vegetarian",
      help: "show only vegetarian recipes",
      match(ctx) {
        return ctx.t.includes("vegetarian") ? { diet: "vegetarian" } : null;
      },
    },
    {
      id: "diet-gluten-free",
      scope: "always",
      say: "filter gluten-free",
      help: "show only gluten-free recipes",
      match(ctx) {
        return ctx.t.includes("gluten") ? { diet: "gluten-free" } : null;
      },
    },
    {
      id: "diet-all",
      scope: "always",
      say: "show all recipes",
      help: "clear the filters",
      samples: ["show everything"],
      match(ctx) {
        return has(ctx.t, "all recipes", "show everything") ? { diet: "any" } : null;
      },
    },

    /* -- timers --------------------------------------------------------------
     * Above the kitchen matcher, because the kitchen rule accepts "I have" —
     * and "I have a timer running" is a question about timers.
     * Order inside the block is load-bearing too: "start a timer" contains
     * "start", so the set rule has to precede the resume rule.
     */
    {
      id: "timer-set",
      scope: "always",
      say: "set a timer",
      help: "start a timer for the step on screen",
      samples: ["start a timer", "add a timer"],
      match(ctx) {
        if (!ctx.t.includes("timer")) return null;
        return has(ctx.t, "set", "add", "start a") ? {} : null;
      },
    },
    {
      id: "timer-pause",
      scope: "always",
      say: "pause the timers",
      help: "pause every timer that is counting",
      samples: ["stop the timers", "cancel the timer"],
      match(ctx) {
        if (!ctx.t.includes("timer")) return null;
        return has(ctx.t, "pause", "stop", "cancel") ? {} : null;
      },
    },
    {
      id: "timer-resume",
      scope: "always",
      say: "resume the timers",
      help: "start the next timer that is waiting",
      samples: ["restart the timer"],
      match(ctx) {
        if (!ctx.t.includes("timer")) return null;
        return has(ctx.t, "resume", "restart") ? {} : null;
      },
    },
    {
      id: "timer-status",
      scope: "always",
      say: "what timers are running",
      help: "hear how many timers are going, and what is next",
      samples: ["I have a timer running", "which timers are going"],
      match(ctx) {
        return ctx.t.includes("timer") ? {} : null;
      },
    },

    /* -- the kitchen question ------------------------------------------------ */
    {
      id: "kitchen-match",
      scope: "always",
      say: "what can I cook with chicken and garlic",
      help: "match recipes to the ingredients you say",
      samples: ["what's in my kitchen", "I have eggs and rice", "冰箱里有鸡蛋"],
      match(ctx) {
        return has(ctx.t,
          "what can i cook", "what can i make", "what s in my kitchen", "what is in my kitchen",
          "i have", "i ve got", "my fridge has",
          "冰箱里有", "我家里有", "家里有"
        ) ? {} : null;
      },
    },

    /* -- the shopping list ---------------------------------------------------
     * "Add" precedes "read": the read rule keys off "shopping list", which
     * appears in "add to my shopping list" too, so the other order answers
     * "added it" by reading the list back.
     */
    {
      id: "add-missing",
      scope: "always",
      say: "add what's missing",
      help: "put this recipe's missing items on the list",
      samples: ["what's missing", "add to my shopping list", "add it to my list"],
      match(ctx) {
        return has(ctx.t,
          "add missing", "add what s missing", "add the missing",
          "what s missing", "add what i need",
          "add to my list", "add to the list", "add to my shopping list", "add to the shopping list",
          "add it to my list", "add them to my list"
        ) ? {} : null;
      },
    },
    {
      id: "read-shopping",
      scope: "always",
      say: "what do I need to buy",
      help: "read the shopping list aloud",
      samples: ["read my shopping list", "what's on my list"],
      match(ctx) {
        return has(ctx.t,
          "what do i need to buy", "what to buy", "shopping list",
          "read my list", "read the list", "what s on my list"
        ) ? {} : null;
      },
    },

    /* -- the cook plan ------------------------------------------------------- */
    {
      id: "cook-plan",
      scope: "always",
      say: "what's the cook plan",
      help: "hear the longest wait, and what to start first",
      samples: ["what takes longest", "what should I start first"],
      match(ctx) {
        return has(ctx.t,
          "cook plan", "what s the plan", "what is the plan",
          "what takes longest", "longest wait", "what should i start"
        ) ? {} : null;
      },
    },

    /* -- while a recipe is open ---------------------------------------------- */
    {
      id: "next-step",
      scope: "recipe",
      say: "next step",
      help: "move to the next step",
      samples: ["next", "go to the next step"],
      match(ctx) {
        return ctx.t.includes("next") ? {} : null;
      },
    },
    {
      id: "prev-step",
      scope: "recipe",
      say: "previous step",
      help: "go back a step",
      samples: ["go back", "back a step"],
      match(ctx) {
        return has(ctx.t, "previous", "back") ? {} : null;
      },
    },
    {
      id: "repeat-step",
      scope: "recipe",
      say: "repeat step",
      help: "hear the current step again",
      samples: ["say that again"],
      match(ctx) {
        return has(ctx.t, "repeat", "say that again") ? {} : null;
      },
    },
    {
      id: "read-step",
      scope: "recipe",
      say: "read the step",
      help: "read the current step aloud",
      samples: ["speak the step"],
      match(ctx) {
        return has(ctx.t, "read", "speak") ? {} : null;
      },
    },

    /* -- the conversation itself --------------------------------------------- */
    {
      id: "open-log",
      scope: "always",
      say: "show our conversation",
      help: "see everything you and CookAlong have said",
      samples: ["what did I say", "what did you say", "show the conversation"],
      match(ctx) {
        return has(ctx.t,
          "conversation", "what did i say", "what did you say",
          "what have i said", "transcript"
        ) ? {} : null;
      },
    },
    {
      id: "help",
      scope: "always",
      say: "what can I say",
      help: "open this list on screen",
      samples: ["what can you do", "give me some help"],
      match(ctx) {
        return has(ctx.t,
          "what can i say", "what do i say", "what should i say",
          "what can you do", "what can you help", "commands", "help"
        ) ? {} : null;
      },
    },
  ];

  /**
   * Read an utterance against the table and hand back the first command that
   * claims it, with whatever it needs to act.
   *
   * `env` is the app's current situation:
   *   recipes    the catalogue, so a dish can be named
   *   allergens  the allergens the app knows about
   *   atHome     the home screen is the one on show
   *   hasRecipe  a recipe is open, so step commands mean something
   *
   * A command scoped to a screen it is not on does not claim the utterance, so
   * "next step" on the home screen falls through to the honest "I didn't catch
   * that" instead of appearing to work.
   */
  function findCommand(transcript, env) {
    const t = normalize(transcript);
    if (!t) return null;
    const e = env || {};
    const ctx = {
      t,
      raw: String(transcript == null ? "" : transcript),
      recipes: e.recipes || [],
      allergens: e.allergens || [],
      atHome: !!e.atHome,
      hasRecipe: !!e.hasRecipe,
      findRecipe: () => findRecipe(t, e.recipes || []),
    };

    for (const command of COMMANDS) {
      if (command.scope === "home" && !ctx.atHome) continue;
      if (command.scope === "recipe" && !ctx.hasRecipe) continue;
      const capture = command.match(ctx);
      if (capture) return { id: command.id, command, capture };
    }
    return null;
  }

  /** Everything the app teaches, in table order, for the screen to render. */
  function help() {
    return COMMANDS.map(c => ({ id: c.id, say: c.say, help: c.help, scope: c.scope }));
  }

  /** Reading order for the help screen, which is not the same as precedence. */
  const SCOPE_LABEL = {
    always: "Anywhere",
    home: "On the home screen",
    recipe: "While a recipe is open",
  };

  return {
    COMMANDS,
    SCOPE_LABEL,
    findCommand,
    help,
    normalize,
    findRecipe,
    findAllergen,
  };
});
