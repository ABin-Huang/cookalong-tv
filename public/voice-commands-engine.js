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
    module.exports = factory(require("./agent.js"));
  } else {
    root.CookalongVoiceCommands = factory(root.CookalongAgent);
  }
})(typeof self !== "undefined" ? self : this, function (agent) {

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
   *
   * `nameCn` is matched the same way. A Chinese speaker names a dish in Chinese,
   * and the recogniser in Chinese mode will never hand back the English name, so
   * without it the flagship command ("cook tomato basil pasta") has no Chinese
   * equivalent at all.
   */
  function findRecipe(t, recipes) {
    let best = null;
    let bestLength = 0;
    (recipes || []).forEach(recipe => {
      if (!recipe) return;
      [recipe.name, recipe.nameCn].forEach(candidate => {
        const name = normalize(candidate);
        if (!name || !t.includes(name)) return;
        if (name.length <= bestLength) return;
        best = recipe;
        bestLength = name.length;
      });
    });
    return best;
  }

  /**
   * How a cook says each allergen in Chinese.
   *
   * The canonical names belong to the ingredient engine; what a cook actually
   * says is this file's business, which is why the words live here. A test
   * asserts every canonical allergen has an entry, so an allergen added to the
   * engine without its spoken form fails the suite rather than quietly becoming
   * unreachable by voice in Chinese.
   */
  const ALLERGEN_CN = {
    dairy: ["奶", "牛奶", "乳制品", "奶油", "芝士", "奶酪"],
    egg: ["鸡蛋", "蛋"],
    gluten: ["麸质", "面筋", "小麦"],
    shellfish: ["贝壳", "贝类", "海鲜"],
    fish: ["鱼"],
    soy: ["大豆", "黄豆", "酱油"],
    nuts: ["坚果", "果仁"],
    peanut: ["花生"],
    sesame: ["芝麻"],
  };

  /** The allergen a cook just named, allowing for the plural they actually say. */
  function findAllergen(t, known) {
    const words = new Set(t.split(" ").filter(Boolean));
    const singular = w => w.replace(/s$/, "");
    return (known || []).find(allergen => {
      const a = normalize(allergen);
      if (words.has(a) || words.has(a + "s") || words.has(singular(a))) return true;
      // Chinese has no plurals and no word boundaries to split on, so the
      // spoken forms are looked for inside the sentence.
      const cn = ALLERGEN_CN[a];
      return !!cn && cn.some(w => t.includes(w));
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
      cn: {
        say: "我对牛奶过敏",
        help: "把某个食材从所有菜谱里去掉",
        samples: ["我对坚果过敏", "我不能吃海鲜", "不要放麸质", "我可以吃牛奶了"],
      },
      match(ctx) {
        const allergen = findAllergen(ctx.t, ctx.allergens);
        const declaring = has(ctx.t, "allerg", "can t eat", "leave out",
          "过敏", "不能吃", "不吃", "不要放", "别放", "不放");
        const clearing = /\bnot allerg|no longer allerg|stop avoiding|i can eat|forget the|不再过敏|可以吃|不用避/.test(ctx.t);
        // Declaring needs a word that means "leave it out". Clearing needs to
        // name the thing — "what can I eat" and "我可以吃什么" are questions, not
        // a cook changing their mind, and a bare "can eat" trigger would swallow
        // them. Requiring an allergen is what tells the two apart.
        if (!declaring && !(clearing && allergen)) return null;
        return { allergen, remove: clearing };
      },
    },

    /* -- opening a dish ------------------------------------------------------ */
    {
      id: "open-recipe",
      scope: "home",
      say: "cook tomato basil pasta",
      help: "open a recipe by saying its name",
      samples: ["open garlic chicken rice", "cook beef and broccoli", "cook creamy mushroom risotto"],
      cn: { say: "做番茄罗勒意面", help: "说出菜名就能打开", samples: ["打开蒜香鸡饭", "做西兰花炒牛肉"] },
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
      cn: { say: "只看纯素", help: "只显示纯素的菜谱", samples: ["我要纯素", "全素菜谱"] },
      match(ctx) {
        return has(ctx.t, "vegan", "纯素", "全素") ? { diet: "vegan" } : null;
      },
    },
    {
      id: "diet-vegetarian",
      scope: "always",
      say: "filter vegetarian",
      help: "show only vegetarian recipes",
      cn: { say: "只看素食", help: "只显示素食的菜谱", samples: ["我要素食"] },
      match(ctx) {
        return has(ctx.t, "vegetarian", "素食") ? { diet: "vegetarian" } : null;
      },
    },
    {
      id: "diet-gluten-free",
      scope: "always",
      say: "filter gluten-free",
      help: "show only gluten-free recipes",
      cn: { say: "只看无麸质", help: "只显示无麸质的菜谱", samples: ["无麸质菜谱"] },
      match(ctx) {
        return has(ctx.t, "gluten", "麸质") ? { diet: "gluten-free" } : null;
      },
    },
    {
      id: "diet-all",
      scope: "always",
      say: "show all recipes",
      help: "clear the filters",
      samples: ["show everything"],
      cn: { say: "显示全部菜谱", help: "清除所有筛选", samples: ["全部菜谱", "所有菜谱"] },
      match(ctx) {
        return has(ctx.t, "all recipes", "show everything", "全部菜谱", "所有菜谱") ? { diet: "any" } : null;
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
      cn: { say: "设置计时器", help: "给屏幕上这一步开始计时", samples: ["设个计时器", "开始计时"] },
      match(ctx) {
        if (!has(ctx.t, "timer", "计时器", "定时器", "计时")) return null;
        return has(ctx.t, "set", "add", "start a", "设置", "设个", "加个", "开始") ? {} : null;
      },
    },
    {
      id: "timer-pause",
      scope: "always",
      say: "pause the timers",
      help: "pause every timer that is counting",
      samples: ["stop the timers", "cancel the timer"],
      cn: { say: "暂停计时器", help: "把所有在走的计时器暂停", samples: ["停掉计时器", "取消计时"] },
      match(ctx) {
        if (!has(ctx.t, "timer", "计时器", "定时器", "计时")) return null;
        return has(ctx.t, "pause", "stop", "cancel", "暂停", "停掉", "取消") ? {} : null;
      },
    },
    {
      id: "timer-resume",
      scope: "always",
      say: "resume the timers",
      help: "start the next timer that is waiting",
      samples: ["restart the timer"],
      cn: { say: "继续计时", help: "让下一个等待中的计时器开始", samples: ["恢复计时", "重启计时器"] },
      match(ctx) {
        if (!has(ctx.t, "timer", "计时器", "定时器", "计时")) return null;
        return has(ctx.t, "resume", "restart", "继续", "恢复", "重启") ? {} : null;
      },
    },
    {
      id: "timer-status",
      scope: "always",
      say: "what timers are running",
      help: "hear how many timers are going, and what is next",
      samples: ["I have a timer running", "which timers are going"],
      cn: { say: "现在有几个计时器", help: "听还有几个计时器在走，下一个是谁", samples: ["计时器还有多久"] },
      match(ctx) {
        return has(ctx.t, "timer", "计时器", "定时器", "计时") ? {} : null;
      },
    },

    /* -- hands-free ----------------------------------------------------------
     * The mode that keeps the microphone coming back, so a whole cook needs no
     * pressing at all. Off precedes on because "hands-free off" contains
     * "hands free" — the other order reads a request to stop as a request to
     * keep going, which is the one direction this must never move in.
     */
    {
      id: "hands-free-off",
      scope: "always",
      say: "stop listening",
      help: "stop the microphone re-opening after every answer",
      samples: ["hands-free off", "turn off hands-free", "no more listening"],
      cn: { say: "不用听了", help: "不要再自动打开麦克风", samples: ["退出免遥控", "关掉免遥控"] },
      match(ctx) {
        return has(ctx.t,
          "stop listening", "hands free off", "turn off hands free", "no more listening",
          "不用听了", "退出免遥控", "关掉免遥控"
        ) ? {} : null;
      },
    },
    {
      id: "hands-free-on",
      scope: "always",
      say: "hands-free",
      help: "keep listening after every answer, so nothing needs pressing",
      samples: ["hands free mode", "keep listening", "stay listening"],
      cn: { say: "免遥控", help: "每次回答后继续听，全程不用按键", samples: ["一直听着", "持续听"] },
      match(ctx) {
        return has(ctx.t,
          "hands free", "keep listening", "stay listening",
          "免遥控", "一直听着", "持续听"
        ) ? {} : null;
      },
    },

    /* -- the kitchen question ------------------------------------------------ */
    {
      id: "kitchen-match",
      scope: "always",
      say: "what can I cook with chicken and garlic",
      help: "match recipes to the ingredients you say",
      samples: ["what's in my kitchen", "I have eggs and rice", "冰箱里有鸡蛋"],
      cn: { say: "冰箱里有鸡肉和蒜，能做什么菜", help: "说出你的食材，我来配菜谱", samples: ["我家里有鸡蛋和米饭"] },
      match(ctx) {
        return has(ctx.t,
          "what can i cook", "what can i make", "what s in my kitchen", "what is in my kitchen",
          "i have", "i ve got", "my fridge has",
          "冰箱里有", "我家里有", "家里有", "能做什么菜", "有什么菜能做", "能拿什么做"
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
      cn: { say: "把缺的加到购物清单", help: "把这道菜缺的材料加进购物清单", samples: ["还缺什么", "加到购物清单里"] },
      match(ctx) {
        return has(ctx.t,
          "add missing", "add what s missing", "add the missing",
          "what s missing", "add what i need",
          "add to my list", "add to the list", "add to my shopping list", "add to the shopping list",
          "add it to my list", "add them to my list",
          "加到购物清单", "加到清单", "还缺什么", "缺什么"
        ) ? {} : null;
      },
    },
    {
      id: "read-shopping",
      scope: "always",
      say: "what do I need to buy",
      help: "read the shopping list aloud",
      samples: ["read my shopping list", "what's on my list"],
      cn: { say: "我要买什么", help: "把购物清单念出来", samples: ["念一下购物清单", "购物清单上有什么"] },
      match(ctx) {
        return has(ctx.t,
          "what do i need to buy", "what to buy", "shopping list",
          "read my list", "read the list", "what s on my list",
          "购物清单", "要买什么", "要买点什么"
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
      cn: { say: "做菜顺序是什么", help: "听哪个等最久、先做哪一步", samples: ["哪个花时间最久", "先做什么"] },
      match(ctx) {
        return has(ctx.t,
          "cook plan", "what s the plan", "what is the plan",
          "what takes longest", "longest wait", "what should i start",
          "做菜顺序", "哪个花时间最久", "哪个最久", "先做什么", "先做哪一步"
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
      cn: { say: "下一步", help: "进入下一步", samples: ["下一个", "继续下一步"] },
      match(ctx) {
        return has(ctx.t, "next", "下一步", "下一个") ? {} : null;
      },
    },
    {
      id: "prev-step",
      scope: "recipe",
      say: "previous step",
      help: "go back a step",
      samples: ["go back", "back a step"],
      cn: { say: "上一步", help: "回到上一步", samples: ["前一步", "回去一步"] },
      match(ctx) {
        return has(ctx.t, "previous", "back", "上一步", "前一步", "回去一步") ? {} : null;
      },
    },
    {
      id: "repeat-step",
      scope: "recipe",
      say: "repeat step",
      help: "hear the current step again",
      samples: ["say that again"],
      cn: { say: "再说一遍", help: "把当前这一步再念一次", samples: ["重复这一步", "再念一遍"] },
      match(ctx) {
        return has(ctx.t, "repeat", "say that again", "再说一遍", "重复", "再念一遍") ? {} : null;
      },
    },
    {
      id: "read-step",
      scope: "recipe",
      say: "read the step",
      help: "read the current step aloud",
      samples: ["speak the step"],
      cn: { say: "念一下这一步", help: "把当前这一步念出来", samples: ["读这一步", "念这一步"] },
      match(ctx) {
        return has(ctx.t, "read", "speak", "念", "读") ? {} : null;
      },
    },

    /* -- the conversation itself --------------------------------------------- */
    {
      id: "open-log",
      scope: "always",
      say: "show our conversation",
      help: "see everything you and CookAlong have said",
      samples: ["what did I say", "what did you say", "show the conversation"],
      cn: { say: "看看我们的对话", help: "看你和 CookAlong 说过的所有内容", samples: ["我说了什么", "你说了什么", "打开对话"] },
      match(ctx) {
        return has(ctx.t,
          "conversation", "what did i say", "what did you say",
          "what have i said", "transcript",
          "对话", "我说了什么", "你说了什么"
        ) ? {} : null;
      },
    },
    {
      id: "help",
      scope: "always",
      say: "what can I say",
      help: "open this list on screen",
      samples: ["what can you do", "give me some help"],
      cn: { say: "我能说什么", help: "把这个列表打开", samples: ["你能做什么", "帮帮我"] },
      match(ctx) {
        return has(ctx.t,
          "what can i say", "what do i say", "what should i say",
          "what can you do", "what can you help", "commands", "help",
          "我能说什么", "能说什么", "你能做什么", "帮帮我"
        ) ? {} : null;
      },
    },
  ];

  /**
   * The jobs the conductor will take on, taught from the conductor's own list.
   *
   * The phrases are in two files because they are two different things: agent.js
   * owns what a job does, and this table owns the phrase a cook says and the fact
   * that it is advertised. Generating the entries from `AGENT.GOALS` is what
   * stops a job from existing without being taught — which is the drift this
   * whole table was built to prevent, when the cheatsheet offered a phrase that
   * nothing answered.
   *
   * ORDER: these must sit ABOVE `kitchen-match`. "Use up what's in my kitchen"
   * contains "what's in my kitchen", which the kitchen matcher also claims, so
   * the wrong order answers a cook who asked the app to get on with dinner with
   * a list of recipes. A test pins it.
   */
  function agentCommands(conductor) {
    return ((conductor && conductor.GOALS) || []).map(goal => ({
      id: `agent-${goal.id}`,
      scope: "always",
      say: goal.say,
      help: goal.help,
      samples: goal.samples || [],
      cn: goal.cn,
      match(ctx) {
        return goal.match(ctx.t) ? { goal: goal.id } : null;
      },
    }));
  }

  const KITCHEN_AT = COMMANDS.findIndex(c => c.id === "kitchen-match");
  COMMANDS.splice(KITCHEN_AT < 0 ? COMMANDS.length : KITCHEN_AT, 0, ...agentCommands(agent));

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

  /**
   * Everything the app teaches, in table order, for the screen to render.
   *
   * The language is the cook's, not the app's: a Chinese speaker has to be
   * taught Chinese phrases, because those are the phrases the recogniser in
   * Chinese mode will hand back. Teaching the English ones would make the list
   * a lie in the one place the app promises not to lie.
   */
  function help(lang) {
    const cn = normalize(lang).startsWith("zh");
    return COMMANDS.map(c => (cn && c.cn
      ? { id: c.id, say: c.cn.say, help: c.cn.help, scope: c.scope }
      : { id: c.id, say: c.say, help: c.help, scope: c.scope }));
  }

  /** Reading order for the help screen, which is not the same as precedence. */
  const SCOPES = ["always", "home", "recipe"];

  const SCOPE_LABEL = {
    "en": {
      always: "Anywhere",
      home: "On the home screen",
      recipe: "While a recipe is open",
    },
    "zh": {
      always: "随时可用",
      home: "在主屏幕上",
      recipe: "打开菜谱后",
    },
  };

  /** The recognition languages this table actually answers in. */
  const LANGS = [
    { id: "en-US", label: "English", short: "EN" },
    { id: "zh-CN", label: "中文", short: "中" },
  ];

  function scopeLabel(scope, lang) {
    const table = SCOPE_LABEL[normalize(lang).startsWith("zh") ? "zh" : "en"];
    return table[scope] || table.always;
  }

  /**
   * The other language this table answers in.
   *
   * A recogniser is opened in exactly one language, so when a cook's language was
   * never chosen — only guessed from the browser — trying the other one is the
   * only remaining test. The caller asks here rather than keeping its own copy of
   * which languages exist, because a second copy is how a switcher ends up
   * offering a language the table has no phrases for.
   */
  function otherLang(id) {
    const at = LANGS.findIndex(l => l.id === id);
    if (at === -1) return LANGS[0].id;
    return LANGS[(at + 1) % LANGS.length].id;
  }

  return {
    COMMANDS,
    SCOPE_LABEL,
    SCOPES,
    LANGS,
    ALLERGEN_CN,
    findCommand,
    help,
    scopeLabel,
    otherLang,
    normalize,
    findRecipe,
    findAllergen,
  };
});
