"use strict";

/**
 * CookAlong TV - the conductor: one request, several engines, one finished job.
 *
 * Every other engine in this repo answers a question. This one finishes a job.
 *
 * "Sort out dinner" is not a request for a list to be handed back and acted on
 * alone. It is a request for the decision AND for the three things that follow
 * from it: open the dish, say what the clock looks like, and put the shopping on
 * the list. As separate steps that is two spoken questions and several presses,
 * and the pressing is the part this app exists to remove.
 *
 * So the agent composes, and it decides nothing on its own account. The dish is
 * the head of the ranking `suggest()` already returns, the clock is the summary
 * `plan` already builds, and the purchase is the list `itemsToBuy()` already
 * produces. The agent's whole contribution is to run them in a sensible order
 * and to say what it did — which is why the whole thing is testable without a
 * browser, a microphone, or an Alexa device.
 *
 * Two rules keep that honest, and both are asserted by tests rather than
 * promised in a comment:
 *
 *   1. It asks before it acts. Opening a dish is cheap and undone by Back;
 *      editing the shopping list is neither. Something that quietly changes
 *      global state on one spoken word is something a cook stops trusting.
 *      `compose()` therefore returns a plan and performs nothing — the app only
 *      carries it out once the cook has said yes.
 *   2. It never starts a clock. A dinner that has been "sorted out" should not
 *      arrive with an 18-minute timer already running while the cook is still
 *      chopping onions, and on a Fire TV with no installed voice an unattended
 *      countdown that expires in silence is worse than no countdown at all. The
 *      agent reports where the long wait is and leaves the starting to the cook,
 *      at the step the plan points at.
 *
 * "Use it up" is a separate goal rather than a separate wording, because it
 * optimises for something else: not the best dish, but the best dish that needs
 * nothing bought at all. That is a different question with a different answer
 * and, quite often, no answer — which the agent says instead of quietly
 * downgrading to the other objective.
 *
 * UMD bundle: CommonJS for the Node tests and the Alexa skill,
 * `window.CookalongAgent` in the Fire TV Web App.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("./ingredients.js"),
      require("./plan.js"),
      require("./shopping.js"),
      require("./timer.js")
    );
  } else {
    root.CookalongAgent = factory(
      root.CookalongIngredients,
      root.CookalongPlan,
      root.CookalongShopping,
      root.CookalongTimer
    );
  }
})(typeof self !== "undefined" ? self : this, function (ingredients, plan, shopping, timer) {

  /** Fold an utterance the same way the command table does, so the two agree. */
  function normalize(text) {
    return String(text == null ? "" : text)
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
      .trim();
  }

  function has(t, ...phrases) {
    return phrases.some(p => t.includes(p));
  }

  function isCn(lang) {
    return /^zh/i.test(String(lang == null ? "" : lang));
  }

  /**
   * A duration in words.
   *
   * English goes through the timer's own `speak()`, because that is the phrasing
   * the countdown, the alert and the top bar already use — a second way of
   * saying "18 minutes" is a second thing to keep in step. The timer has no
   * Chinese, so Chinese is written out here.
   */
  function speakDuration(seconds, lang) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    if (!isCn(lang)) {
      return timer && timer.Timer ? new timer.Timer(total).speak() : `${total} seconds`;
    }
    const m = Math.floor(total / 60);
    const s = total % 60;
    const parts = [];
    if (m) parts.push(`${m} 分钟`);
    if (s) parts.push(`${s} 秒`);
    return parts.join("") || "0 秒";
  }

  /**
   * The jobs this agent will take on.
   *
   * ORDER IS PRECEDENCE, exactly as in voice-commands.js, and for the same
   * reason: "use up what's in my kitchen" contains "what s in my kitchen",
   * which is a phrase the kitchen matcher also claims. The job has to be
   * reachable before the question it is made of, or the app answers "here are
   * some recipes" to a cook who asked it to get on with it.
   */
  const GOALS = [
    {
      id: "use-it-up",
      say: "use up what's in my kitchen",
      help: "pick a dish that needs nothing bought, and set the cook up",
      samples: ["use up what I have", "cook without going shopping", "use it all up"],
      cn: {
        say: "把冰箱里的东西用掉",
        help: "挑一道不用买东西就能做的菜，并准备好",
        samples: ["不用去超市就能做什么", "把剩下的都用掉"],
      },
      match(t) {
        return has(t,
          "use up", "use it up", "use it all up", "use everything up", "use them all up",
          "without going shopping", "without a shop",
          "nothing to buy", "no shopping",
          "用掉", "不用去超市", "不用买东西", "别浪费"
        ) ? {} : null;
      },
    },
    {
      id: "dinner",
      say: "sort out dinner",
      help: "decide tonight's dish, open it, and set the cook up",
      samples: ["what should I cook tonight", "decide dinner for me", "sort dinner out"],
      cn: {
        say: "帮我定个晚饭",
        help: "决定今晚做什么、打开它，并准备好",
        samples: ["晚饭吃什么", "今晚吃什么", "随便做点什么"],
      },
      match(t) {
        return has(t,
          "sort out dinner", "sort dinner", "sort out tea", "decide dinner", "plan dinner",
          "what s for dinner", "what should i cook", "what should we eat", "dinner sorted",
          "定个晚饭", "晚饭吃什么", "今晚吃什么", "帮我定晚饭", "随便做点什么"
        ) ? {} : null;
      },
    },
  ];

  /** Which job, if any, an utterance is asking for. */
  function findGoal(text) {
    const t = normalize(text);
    if (!t) return null;
    for (const goal of GOALS) {
      if (goal.match(t)) return { id: goal.id, goal };
    }
    return null;
  }

  /**
   * Work out the whole job and hand it back as data.
   *
   * Nothing here has a side effect. `ctx` is the cook's situation:
   *   have      the canonical ingredients on hand (kitchen + pantry)
   *   recipes   the catalogue
   *   profile   { diets, allergens }
   *   servings  the yield the cook asked for, or null for as written
   *   avoid     recipes already walked past tonight, so "use it up" is stable
   *   lang      the cook's language, for the wording
   */
  function compose(goalId, ctx) {
    const e = ctx || {};
    const goal = GOALS.find(g => g.id === goalId) || null;
    const have = Array.isArray(e.have) ? e.have.slice() : [];
    const recipes = Array.isArray(e.recipes) ? e.recipes : [];
    const avoid = Array.isArray(e.avoid) ? e.avoid : [];
    const servings = Number.isFinite(Number(e.servings)) && Number(e.servings) > 0
      ? Number(e.servings)
      : null;

    const shell = {
      goal: goal ? goal.id : null,
      lang: e.lang,
      ok: false,
      reason: null,
      recipe: null,
      match: null,
      ready: false,
      alternatives: 0,
      closest: null,
      clock: null,
      shopping: null,
      steps: [],
    };

    if (!goal) return Object.assign(shell, { reason: "unknown-goal" });
    if (!ingredients || !plan || !shopping) return Object.assign(shell, { reason: "no-engine" });
    if (!recipes.length) return Object.assign(shell, { reason: "no-recipes" });

    const matches = ingredients.matchRecipes(have, recipes, e.profile);
    const decision = ingredients.suggest(matches, { avoid });
    const ranked = matches.filter(m => m && m.recipe && !avoid.includes(m.recipe.id));

    // "Use it up" is a different objective, not a different wording: it wants
    // the dish that needs nothing bought at all. `readyNow` is the strict
    // reading — no hard miss and not even a swap — and it is deliberately not
    // softened to the general decision below, because "nothing to buy" is a
    // claim a cook acts on without checking.
    const pick = goal.id === "use-it-up"
      ? (ingredients.readyNow(matches).filter(m => !avoid.includes(m.recipe.id))[0] || null)
      : (decision ? decision.pick : null);

    if (!pick) {
      return Object.assign(shell, {
        reason: goal.id === "use-it-up" ? "nothing-ready" : "nothing-cookable",
        // A refusal still has to be worth hearing, so it names the nearest
        // thing: the best cookable dish if there is one, otherwise whatever
        // topped the ranking.
        closest: (decision && decision.pick) || ranked[0] || null,
      });
    }

    const steps = Array.isArray(pick.recipe.steps) ? pick.recipe.steps : [];
    const clock = plan.summary(steps);
    const buy = shopping.itemsToBuy(pick.recipe, {
      servings: servings || pick.recipe.serves,
      have,
      profile: e.profile,
    });

    const planSteps = [{ do: "open", recipeId: pick.recipe.id }];
    if (buy.items.length) planSteps.push({ do: "shop", count: buy.items.length });

    return Object.assign(shell, {
      ok: true,
      recipe: pick.recipe,
      match: pick,
      ready: ingredients.isReadyNow(pick),
      alternatives: decision ? decision.alternatives.length : 0,
      clock: {
        totalCount: clock.totalCount,
        timedCount: clock.timedCount,
        namedSeconds: clock.namedSeconds,
        longest: clock.longest ? { index: clock.longest.index, seconds: clock.longest.seconds } : null,
      },
      shopping: {
        count: buy.items.length,
        empty: buy.items.length === 0,
      },
      steps: planSteps,
    });
  }

  function nameOf(recipe, cn) {
    if (!recipe) return "";
    return cn ? (recipe.nameCn || recipe.name) : recipe.name;
  }

  function countWord(n, cn) {
    return cn ? `${n} 样` : `${n} thing${n === 1 ? "" : "s"}`;
  }

  function buySentence(c, cn) {
    if (c.shopping.empty) {
      return cn ? "它需要的你都有。" : "You have everything it needs.";
    }
    return cn ? `要买 ${countWord(c.shopping.count, true)}。` : `${c.shopping.count} to buy.`;
  }

  function clockSentence(c, cn) {
    if (!c.clock.timedCount) {
      return cn ? "没有任何一步写着时间。" : "No step names a cooking time.";
    }
    const dur = speakDuration(c.clock.longest.seconds, c.lang);
    const step = c.clock.longest.index + 1;
    return cn
      ? `${c.clock.totalCount} 步里有 ${c.clock.timedCount} 步要看表，最久的是第 ${step} 步的 ${dur}。`
      : `${c.clock.timedCount} of ${c.clock.totalCount} steps are on a clock, and the longest is ` +
        `${dur} on step ${step}.`;
  }

  /**
   * What the agent says before it does anything: the whole plan, and one
   * question. It is a question because the next turn edits the shopping list.
   */
  function propose(composition, lang) {
    const c = composition || {};
    const cn = isCn(lang == null ? c.lang : lang);

    if (!c.ok) return { status: refusalStatus(c, cn), say: refusalSpeech(c, cn) };

    const name = nameOf(c.recipe, cn);
    const n = c.shopping.count;
    const ask = c.shopping.empty
      ? (cn ? "要我现在打开它吗？" : "Want me to open it?")
      : (cn
        ? `要我现在打开它，并把这 ${countWord(n, true)}加进购物清单吗？`
        : (n === 1
          ? "Want me to open it and put it on your list?"
          : `Want me to open it and put those ${n} on your list?`));

    const status = cn
      ? `今晚：${name} — ${c.shopping.empty ? "不用买" : `要买 ${c.shopping.count} 样`}`
      : `Tonight: ${name} — ${c.shopping.empty ? "nothing to buy" : `${c.shopping.count} to buy`}`;

    const lead = cn ? `今晚做${name}。` : `Tonight, cook ${name}. `;
    return { status, say: `${lead}${buySentence(c, cn)} ${clockSentence(c, cn)} ${ask}` };
  }

  /**
   * How far off the nearest dish actually is.
   *
   * The distinction matters and is easy to get wrong: a dish with nothing hard
   * missing is one swap away, which is a decision; a dish with three hard misses
   * is a shopping trip. Telling a cook "one swap away" about the second kind is
   * the exact over-claim this app refuses to make anywhere else.
   */
  function shortfall(match, cn) {
    if (!match) return "";
    const hard = (match.missingHard || []).length;
    const swap = (match.missingSubstitutable || []).length;
    if (hard === 0 && swap > 0) return cn ? "只差换一样料" : "one swap away";
    if (hard > 0) return cn ? `还缺 ${hard} 样` : `still ${hard} short`;
    return cn ? "其实现在就能做" : "actually cookable now";
  }

  function refusalStatus(c, cn) {
    if (c.reason === "nothing-ready") return cn ? "没有不用买东西就能做的菜" : "Nothing needs zero shopping";
    if (c.reason === "unknown-goal") return cn ? "我不知道这个任务" : "I do not know that job";
    return cn ? "现在没有能直接做的菜" : "Nothing is cookable yet";
  }

  /**
   * A refusal that still earns its turn: it says what is missing, and names the
   * dish that is closest to being possible, with an honest account of how far
   * off it is — because "no" on its own leaves a cook with nothing to do next.
   */
  function refusalSpeech(c, cn) {
    if (c.reason === "unknown-goal") {
      return cn ? "我不知道这个任务。可以说“帮我定个晚饭”。" : "I do not know that job. Try “sort out dinner”.";
    }
    if (c.reason === "no-engine") {
      return cn
        ? "引擎没有加载，我没法安排这顿饭。"
        : "The engines did not load, so I cannot plan a cook. Reload the page, or use the buttons.";
    }
    if (c.reason === "no-recipes") {
      return cn ? "菜谱没有加载，我没法安排这顿饭。" : "No recipes are loaded, so I cannot plan a cook.";
    }

    const named = c.closest && c.closest.recipe ? nameOf(c.closest.recipe, cn) : "";
    const gap = shortfall(c.closest, cn);
    const near = named
      ? (cn ? `最接近的是${named}，${gap}。` : `The closest is ${named} — ${gap}. `)
      : "";

    if (c.reason === "nothing-ready") {
      return cn
        ? `这个厨房里没有一样东西都不买就能做的菜。${near}再加点食材，或者直接说菜名。`
        : `Nothing in this kitchen can be cooked with no shopping at all. ${near}` +
          "Add an ingredient, or name a dish.";
    }

    // Nothing is cookable even with a swap: an empty or very thin kitchen.
    return cn
      ? `${near}现在没有能直接下锅的菜。再加几样食材，或者问我“能做什么菜”。`
      : `${near}Nothing here can be cooked without a shop yet. ` +
        "Add an ingredient, or ask what you can cook.";
  }

  /**
   * What the agent says once the plan has been carried out.
   *
   * The second paragraph is the rule, said out loud: the clock was not started,
   * and here is why. A cook who is told what the app deliberately did not do is
   * a cook who does not have to wonder whether it forgot.
   */
  function done(composition, lang) {
    const c = composition || {};
    const cn = isCn(lang == null ? c.lang : lang);
    if (!c.ok) return propose(composition, lang);

    const name = nameOf(c.recipe, cn);
    const status = cn ? `已准备好${name}` : `Set up ${name}`;

    const parts = [];
    parts.push(cn ? `已经打开${name}，停在第 1 步。` : `Opened ${name} at step one.`);
    if (!c.shopping.empty) {
      parts.push(cn
        ? `要买的 ${countWord(c.shopping.count, true)}已经在购物清单上了。`
        : `The ${c.shopping.count} thing${c.shopping.count === 1 ? "" : "s"} to buy ${c.shopping.count === 1 ? "is" : "are"} on your list.`);
    }
    if (c.clock.timedCount) {
      const dur = speakDuration(c.clock.longest.seconds, c.lang);
      const step = c.clock.longest.index + 1;
      parts.push(cn
        ? `最久的是第 ${step} 步的 ${dur}，我没有帮你启动——现在启动的话，它响的时候你还在切菜。走到那一步说“开始计时”就行。`
        : `The longest wait is ${dur} on step ${step}, and I have not started it: ` +
          "it would run out while you are still chopping. Say “start the timer” when you get there.");
    } else {
      parts.push(cn ? "这道菜没有哪一步写着时间。" : "This one names no cooking times at all.");
    }

    return { status, say: parts.join(" ") };
  }

  return {
    GOALS,
    findGoal,
    compose,
    propose,
    done,
    speakDuration,
    normalize,
  };
});
