"use strict";

/**
 * CookAlong TV - Ingredient intelligence engine
 * Powers the "AI kitchen" experience:
 *   - spoken/typed ingredient lists -> normalized canonical ingredients
 *   - weighted recipe matching (what can I cook with what I have?)
 *   - missing-ingredient substitution ("no parmesan?" -> cheddar swap)
 *   - a small in-memory pantry that remembers consumed ingredients
 *
 * UMD bundle: works as a CommonJS module (Node tests / Alexa skill) and
 * as `window.CookalongIngredients` in the Fire TV Web App.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.CookalongIngredients = factory();
  }
})(typeof self !== "undefined" ? self : (typeof globalThis !== "undefined" ? globalThis : this), function () {

  /* ------------------------------------------------------------------ *
   * 1. Canonical ingredient catalogue + spoken-language aliases
   * ------------------------------------------------------------------ */

  // alias (lowercase) -> canonical id. Multi-word aliases are matched first.
  const ALIASES = {
    // pasta & grains
    "spaghetti": "pasta", "pasta": "pasta", "penne": "pasta", "linguine": "pasta",
    "noodle": "pasta", "noodles": "pasta", "意面": "pasta", "意大利面": "pasta", "面条": "pasta",
    "rice": "rice", "steamed rice": "rice", "white rice": "rice", "arborio rice": "rice",
    "米饭": "rice", "大米": "rice", "米": "rice",
    "oat": "oats", "oats": "oats", "rolled oats": "oats", "oatmeal": "oats", "燕麦": "oats",
    "bread": "bread", "white bread": "bread", "toast": "bread", "sliced bread": "bread",
    "面包": "bread", "吐司": "bread",

    // vegetables
    "tomato": "tomato", "tomatoes": "tomato", "crushed tomatoes": "tomato",
    "diced tomatoes": "tomato", "cherry tomatoes": "tomato", "番茄": "tomato", "西红柿": "tomato",
    "garlic": "garlic", "garlic clove": "garlic", "garlic cloves": "garlic",
    "minced garlic": "garlic", "大蒜": "garlic", "蒜瓣": "garlic", "蒜": "garlic",
    "basil": "basil", "fresh basil": "basil", "basil leaves": "basil", "罗勒": "basil",
    "bell pepper": "bell-pepper", "bell peppers": "bell-pepper", "red pepper": "bell-pepper",
    "green pepper": "bell-pepper", "sweet pepper": "bell-pepper", "peppers": "bell-pepper",
    "彩椒": "bell-pepper", "青椒": "bell-pepper",
    "carrot": "carrot", "carrots": "carrot", "胡萝卜": "carrot",
    "broccoli": "broccoli", "broccoli florets": "broccoli", "西兰花": "broccoli",
    "mushroom": "mushroom", "mushrooms": "mushroom", "cremini mushroom": "mushroom",
    "button mushroom": "mushroom", "蘑菇": "mushroom",
    "onion": "onion", "onions": "onion", "yellow onion": "onion", "white onion": "onion", "洋葱": "onion",
    "spinach": "spinach", "baby spinach": "spinach", "spinach leaves": "spinach", "菠菜": "spinach",
    "scallion": "scallion", "scallions": "scallion", "green onion": "scallion",
    "green onions": "scallion", "spring onion": "scallion", "小葱": "scallion", "葱": "scallion",
    "potato": "potato", "potatoes": "potato", "土豆": "potato", "马铃薯": "potato",
    "ginger": "ginger", "ginger root": "ginger", "fresh ginger": "ginger", "姜": "ginger", "生姜": "ginger",

    // proteins & dairy
    "chicken": "chicken", "chicken breast": "chicken", "chicken breasts": "chicken",
    "chicken thigh": "chicken", "chicken thighs": "chicken", "鸡胸肉": "chicken",
    "鸡腿": "chicken", "鸡肉": "chicken",
    "beef": "beef", "beef steak": "beef", "flank steak": "beef", "sirloin": "beef",
    "steak": "beef", "牛肉": "beef",
    "shrimp": "shrimp", "prawn": "shrimp", "prawns": "shrimp", "虾": "shrimp", "虾仁": "shrimp",
    "tofu": "tofu", "firm tofu": "tofu", "extra firm tofu": "tofu", "豆腐": "tofu",
    "egg": "egg", "eggs": "egg", "鸡蛋": "egg",
    "milk": "milk", "whole milk": "milk", "牛奶": "milk",
    "butter": "butter", "unsalted butter": "butter", "黄油": "butter",
    "parmesan": "cheese", "parmesan cheese": "cheese", "grated parmesan": "cheese",
    "cheddar": "cheese", "cheddar cheese": "cheese", "cheese": "cheese",
    "奶酪": "cheese", "芝士": "cheese", "帕玛森": "cheese",

    // fruit
    "banana": "banana", "bananas": "banana", "ripe banana": "banana", "香蕉": "banana",
    "lemon": "lemon", "lemon juice": "lemon", "fresh lemon": "lemon", "柠檬": "lemon",

    // stocks / liquids
    "chicken stock": "chicken-stock", "chicken broth": "chicken-stock", "鸡汤": "chicken-stock", "高汤": "chicken-stock",
    "vegetable stock": "vegetable-stock", "vegetable broth": "vegetable-stock",
    "veggie stock": "vegetable-stock", "蔬菜汤": "vegetable-stock",
    "olive oil": "olive-oil", "橄榄油": "olive-oil",
    "sesame oil": "sesame-oil", "toasted sesame oil": "sesame-oil", "香油": "sesame-oil",
    "soy sauce": "soy-sauce", "酱油": "soy-sauce",
    "rice vinegar": "rice-vinegar", "rice wine vinegar": "rice-vinegar", "米醋": "rice-vinegar",
    "maple syrup": "maple-syrup", "枫糖浆": "maple-syrup",
    "honey": "honey", "蜂蜜": "honey",

    // pantry seasonings (assumed on hand; low weight)
    "salt": "salt", "sea salt": "salt", "盐": "salt",
    "black pepper": "black-pepper", "pepper": "black-pepper", "ground pepper": "black-pepper",
    "黑胡椒": "black-pepper", "胡椒": "black-pepper",
    "sugar": "sugar", "white sugar": "sugar", "糖": "sugar",
    "paprika": "paprika", "smoked paprika": "paprika", "甜椒粉": "paprika",
    "cinnamon": "cinnamon", "ground cinnamon": "cinnamon", "cinnamon powder": "cinnamon", "肉桂": "cinnamon",
    "turmeric": "turmeric", "turmeric powder": "turmeric", "姜黄": "turmeric",
    "cumin": "cumin", "ground cumin": "cumin", "孜然": "cumin"
  };

  // Longest aliases first so "chicken thighs" wins over "chicken".
  const ALIAS_KEYS = Object.keys(ALIASES).sort((a, b) => b.length - a.length);

  // Leading quantities/units to strip from a spoken fragment.
  const LEAD_QTY = /^(?:a|an|some|a bit of|一点|一些|两个?|二个?|[0-9]+(?:\.[0-9]+)?)\s*(?:g|gram|grams|kg|ml|l|litre|liter|liters|cup|cups|tbsp|tablespoon|tablespoons|tsp|teaspoon|teaspoons|oz|ounce|ounces|片|个|克|毫升|勺|把)?\s*(?:of)?\s*/i;

  /**
   * Normalize one spoken/typed ingredient fragment to a canonical id.
   * @param {string} raw
   * @returns {string|null} canonical id, or null when unrecognized
   */
  function normalizeIngredient(raw) {
    if (!raw) return null;
    let text = String(raw).toLowerCase().trim();
    text = text.replace(/[.?!，。！？]/g, " ").replace(/\s+/g, " ").trim();
    text = text.replace(LEAD_QTY, "").trim();
    if (!text) return null;
    if (ALIASES[text]) return ALIASES[text];

    // Whole-phrase alias contained with word boundaries (longest first).
    for (const key of ALIAS_KEYS) {
      if (key.includes(" ")) {
        const re = new RegExp(`(^|[^a-z])${escapeRegExp(key)}([^a-z]|$)`, "i");
        if (re.test(text)) return ALIASES[key];
      }
    }
    // Singular fallback ("tomatos" / typos ending in s).
    const singular = text.replace(/s$/, "");
    if (ALIASES[singular]) return ALIASES[singular];
    // Single-token direct match.
    const token = text.split(/\s+/)[0];
    if (ALIASES[token]) return ALIASES[token];
    if (ALIASES[token.replace(/s$/, "")]) return ALIASES[token.replace(/s$/, "")];
    return null;
  }

  const SPLITTERS = /\s*(?:,|、|，|;|；|\/|&|\band\b|\bplus\b|\bwith\b|和|跟|还有|以及)\s*/i;
  const LEADIN = /^(?:i have|i have got|i'?ve got|my fridge has|fridge has|i got|have got|what can i make with|what can i cook with|make with|cook with|我有|我家里有|冰箱里有|家里有|有)\s*/i;

  /**
   * Parse a free-form ingredient list ("chicken, tomatoes and onion").
   * @param {string} text
   * @returns {{recognized: string[], unknown: string[]}} de-duplicated
   */
  function parseIngredientList(text) {
    const recognized = [];
    const unknown = [];
    if (!text) return { recognized, unknown };
    let cleaned = String(text).toLowerCase().replace(/[\n\r]+/g, " ").trim();
    cleaned = cleaned.replace(LEADIN, "").trim();
    const fragments = cleaned.split(SPLITTERS).map(s => s.trim()).filter(Boolean);
    for (const frag of fragments) {
      const canon = normalizeIngredient(frag);
      if (canon) {
        if (!recognized.includes(canon)) recognized.push(canon);
      } else if (frag && !/^(please|thanks?|thank you)$/.test(frag)) {
        unknown.push(frag);
      }
    }
    return { recognized, unknown };
  }

  /** Human-friendly label for a canonical id. */
  function displayName(canonical) {
    return String(canonical || "").split("-").join(" ");
  }

  /* ------------------------------------------------------------------ *
   * 2. Global substitution knowledge (recipe-level overrides win)
   * ------------------------------------------------------------------ */

  const GLOBAL_SUBSTITUTIONS = {
    "cheese": { name: "cheddar cheese", note: "Use half the amount; cheddar is saltier than parmesan." },
    "chicken-stock": { name: "vegetable stock", note: "A direct 1:1 swap." },
    "vegetable-stock": { name: "chicken stock", note: "A direct 1:1 swap." },
    "butter": { name: "olive oil", note: "Use about three quarters of the amount." },
    "maple-syrup": { name: "honey", note: "Same amount, slightly sweeter." },
    "honey": { name: "maple syrup", note: "Same amount." },
    "milk": { name: "water", note: "Works for savoury cooking; add a little extra fat if possible." },
    "lemon": { name: "rice vinegar", note: "Start with half the amount to keep the bright tang." },
    "basil": { name: "spinach", note: "Stir in at the very end for colour and freshness." },
    "beef": { name: "chicken", note: "Same weight; shorten the browning time slightly." },
    "shrimp": { name: "chicken", note: "Same weight, cut into bite-size pieces." },
    "sesame-oil": { name: "olive oil", note: "Same amount, milder aroma." },
    "rice-vinegar": { name: "lemon juice", note: "Start with half the amount." }
  };

  /**
   * Find a substitution for a missing ingredient.
   * @param {object} recipe full recipe (may carry recipe.substitutions map)
   * @param {string} canonical missing ingredient canonical id
   * @returns {{name:string,note:string}|null}
   */
  function findSubstitute(recipe, canonical) {
    if (recipe && recipe.substitutions && recipe.substitutions[canonical]) {
      return recipe.substitutions[canonical];
    }
    return GLOBAL_SUBSTITUTIONS[canonical] || null;
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function matchCase(original, replacement) {
    if (/^[A-Z]/.test(original)) {
      return replacement.charAt(0).toUpperCase() + replacement.slice(1);
    }
    return replacement;
  }

  /**
   * Replace target ingredient names inside step text, preserving capitalization.
   * @param {string[]} steps original step strings
   * @param {string[]} targetNames names/aliases as written in the recipe
   * @param {string} replacementName
   * @returns {{steps: string[], changedIndexes: number[]}}
   */
  function substituteInSteps(steps, targetNames, replacementName) {
    // One combined regex (longest alternative first) so each position is
    // scanned once — replacing name A must not let name B re-match inside
    // the freshly inserted replacement text.
    const names = [...new Set((targetNames || []).filter(Boolean))]
      .sort((a, b) => b.length - a.length);
    const out = [];
    const changedIndexes = [];
    if (!names.length) return { steps: [...steps], changedIndexes };
    const combined = new RegExp(`\\b(?:${names.map(escapeRegExp).join("|")})\\b`, "gi");
    steps.forEach((step, i) => {
      let changed = false;
      const text = step.replace(combined, m => { changed = true; return matchCase(m, replacementName); });
      if (changed) changedIndexes.push(i);
      out.push(text);
    });
    return { steps: out, changedIndexes };
  }

  /* ------------------------------------------------------------------ *
   * 3. Weighted recipe matching
   * ------------------------------------------------------------------ */

  const ROLE_WEIGHT = { main: 3, secondary: 1, seasoning: 0.5 };

  function ingredientWeight(ing) {
    return ROLE_WEIGHT[ing.role] || 1;
  }

  /**
   * Score every recipe against the ingredients the cook has.
   * Pantry staples (ing.pantry === true) are assumed on hand and never
   * count as "missing". A substitutable missing ingredient earns half
   * credit, because a smart swap keeps the dish cookable.
   *
   * @param {string[]} haveCanonicals canonical ids the cook owns
   * @param {Array<object>} recipes full recipe objects
   * @returns {Array<object>} matches sorted best-first:
   *   { recipe, score(0-100), matched[], missingHard[],
   *     missingSubstitutable[], staplesAssumed[] }
   */
  function matchRecipes(haveCanonicals, recipes) {
    const have = new Set(haveCanonicals || []);
    const matches = (recipes || []).map(recipe => {
      let total = 0;
      let earned = 0;
      const matched = [];
      const missingHard = [];
      const missingSubstitutable = [];
      const staplesAssumed = [];

      (recipe.ingredients || []).forEach(ing => {
        const w = ingredientWeight(ing);
        total += w;
        if (ing.pantry) {
          earned += w;
          staplesAssumed.push(ing.canonical);
        } else if (have.has(ing.canonical)) {
          earned += w;
          matched.push(ing.canonical);
        } else if (findSubstitute(recipe, ing.canonical)) {
          earned += w * 0.5;
          missingSubstitutable.push(ing.canonical);
        } else {
          missingHard.push(ing.canonical);
        }
      });

      const score = total === 0 ? 0 : Math.round((earned / total) * 100);
      return { recipe, score, matched, missingHard, missingSubstitutable, staplesAssumed };
    });

    return matches.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.missingHard.length !== b.missingHard.length) {
        return a.missingHard.length - b.missingHard.length;
      }
      return a.recipe.name.localeCompare(b.recipe.name);
    });
  }

  /** Top matches worth recommending (score above floor). */
  function topMatches(haveCanonicals, recipes, floor = 30, limit = 5) {
    return matchRecipes(haveCanonicals, recipes)
      .filter(m => m.score >= floor)
      .slice(0, limit);
  }

  /* ------------------------------------------------------------------ *
   * 4. Pantry memory ("mark the chicken as used")
   * ------------------------------------------------------------------ */

  class Pantry {
    constructor(initial = []) {
      this._items = new Set();
      (initial || []).forEach(x => this.add(x));
    }

    add(rawOrCanonical) {
      const c = ALIASES[String(rawOrCanonical || "").toLowerCase()] || normalizeIngredient(rawOrCanonical);
      if (c) { this._items.add(c); return c; }
      return null;
    }

    remove(rawOrCanonical) {
      const c = ALIASES[String(rawOrCanonical || "").toLowerCase()] || normalizeIngredient(rawOrCanonical);
      if (c) this._items.delete(c);
      return c;
    }

    // Consuming an ingredient removes it so future matches exclude it.
    consume(rawOrCanonical) { return this.remove(rawOrCanonical); }
    restock(rawOrCanonical) { return this.add(rawOrCanonical); }

    has(canonical) { return this._items.has(canonical); }
    all() { return Array.from(this._items); }
    get size() { return this._items.size; }

    toJSON() { return this.all(); }
    static fromJSON(arr) { return new Pantry(arr || []); }
  }

  return {
    ALIASES,
    GLOBAL_SUBSTITUTIONS,
    ROLE_WEIGHT,
    normalizeIngredient,
    parseIngredientList,
    displayName,
    findSubstitute,
    substituteInSteps,
    matchRecipes,
    topMatches,
    ingredientWeight,
    Pantry
  };
});
