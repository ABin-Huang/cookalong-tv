"use strict";

/**
 * CookAlong TV - Ingredient intelligence engine
 * Powers the "AI kitchen" experience:
 *   - spoken/typed ingredient lists -> normalized canonical ingredients
 *   - weighted recipe matching (what can I cook with what I have?)
 *   - diet/allergen-aware substitution chains ("no parmesan, and I'm vegan"
 *     -> nutritional yeast, never an animal/dairy product)
 *   - a small pantry that remembers consumed ingredients
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
    "button mushroom": "mushroom", "portobello mushroom": "mushroom", "portobello mushrooms": "mushroom",
    "蘑菇": "mushroom",
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
    "milk": "milk", "whole milk": "milk", "oat milk": "oat-milk", "牛奶": "milk",
    "butter": "butter", "unsalted butter": "butter", "黄油": "butter",
    "coconut oil": "coconut-oil",
    "nutritional yeast": "nutritional-yeast",
    "parmesan": "cheese", "parmesan cheese": "cheese", "grated parmesan": "cheese",
    "cheddar": "cheese", "cheddar cheese": "cheese", "cheese": "cheese",
    "奶酪": "cheese", "芝士": "cheese", "帕玛森": "cheese",

    // fruit
    "banana": "banana", "bananas": "banana", "ripe banana": "banana", "香蕉": "banana",
    "lemon": "lemon", "lemon juice": "lemon", "fresh lemon": "lemon", "柠檬": "lemon",

    // stocks / liquids / sweeteners
    "chicken stock": "chicken-stock", "chicken broth": "chicken-stock", "鸡汤": "chicken-stock", "高汤": "chicken-stock",
    "vegetable stock": "vegetable-stock", "vegetable broth": "vegetable-stock",
    "veggie stock": "vegetable-stock", "mushroom stock": "mushroom-stock", "蔬菜汤": "vegetable-stock",
    "olive oil": "olive-oil", "橄榄油": "olive-oil",
    "sesame oil": "sesame-oil", "toasted sesame oil": "sesame-oil", "香油": "sesame-oil",
    "soy sauce": "soy-sauce", "酱油": "soy-sauce",
    "rice vinegar": "rice-vinegar", "rice wine vinegar": "rice-vinegar", "米醋": "rice-vinegar",
    "maple syrup": "maple-syrup", "枫糖浆": "maple-syrup",
    "agave syrup": "agave-syrup", "agave": "agave-syrup",
    "honey": "honey", "蜂蜜": "honey",

    // pantry seasonings (assumed on hand; low weight)
    "salt": "salt", "sea salt": "salt", "盐": "salt",
    "black pepper": "black-pepper", "pepper": "black-pepper", "ground pepper": "black-pepper",
    "黑胡椒": "black-pepper", "胡椒": "black-pepper",
    "sugar": "sugar", "white sugar": "sugar", "糖": "sugar",
    "paprika": "paprika", "smoked paprika": "paprika", "甜椒粉": "paprika",
    "cinnamon": "cinnamon", "ground cinnamon": "cinnamon", "cinnamon powder": "cinnamon", "肉桂": "cinnamon",
    "turmeric": "turmeric", "turmeric powder": "turmeric", "姜黄": "turmeric",
    "cumin": "cumin", "ground cumin": "cumin", "孜然": "cumin",
    "oregano": "oregano", "dried oregano": "oregano"
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
   * 2. Dietary profiles, ingredient attributes and substitution chains
   *
   * Every substitution option is explicitly tagged with the diets it
   * satisfies and the allergens it carries. Selection is fail-closed:
   * an option that is not PROVEN compatible is never recommended, so a
   * vegan dish can never be swapped onto chicken stock, and a dairy-
   * allergic cook is never offered cheese.
   * ------------------------------------------------------------------ */

  const SUPPORTED_DIETS = ["vegetarian", "vegan", "gluten-free", "dairy-free"];
  const COMMON_ALLERGENS = ["dairy", "egg", "gluten", "shellfish", "fish", "soy", "nuts", "peanut", "sesame"];

  // Reusable diet tag groups.
  const PLANT = ["vegan", "vegetarian", "gluten-free", "dairy-free"];       // whole plant foods
  const VEGGIE_DAIRY = ["vegetarian", "gluten-free"];                       // vegetarian but contains dairy
  const VEGGIE_EGG = ["vegetarian", "gluten-free", "dairy-free"];           // vegetarian, egg, no dairy
  const ANIMAL = ["gluten-free", "dairy-free"];                             // meat/fish, no dairy/gluten

  // Diet/allergens each canonical ingredient carries. Used to filter whole
  // recipes against a cook's profile (e.g. a shellfish allergy hides the
  // shrimp recipe). Ingredients not listed are plant staples.
  const INGREDIENT_PROFILES = {
    "pasta": { diet: ["vegan", "vegetarian", "dairy-free"], allergens: ["gluten"] },
    "bread": { diet: ["vegetarian", "dairy-free"], allergens: ["gluten", "egg"] },
    "chicken": { diet: ANIMAL, allergens: [] },
    "beef": { diet: ANIMAL, allergens: [] },
    "shrimp": { diet: ANIMAL, allergens: ["shellfish"] },
    "egg": { diet: VEGGIE_EGG, allergens: ["egg"] },
    "milk": { diet: VEGGIE_DAIRY, allergens: ["dairy"] },
    "butter": { diet: VEGGIE_DAIRY, allergens: ["dairy"] },
    "cheese": { diet: VEGGIE_DAIRY, allergens: ["dairy"] },
    "honey": { diet: VEGGIE_EGG, allergens: [] },
    "chicken-stock": { diet: ANIMAL, allergens: [] },
    "tofu": { diet: PLANT, allergens: ["soy"] },
    "soy-sauce": { diet: PLANT, allergens: ["soy"] },
    "sesame-oil": { diet: PLANT, allergens: ["sesame"] }
  };
  const PLANT_BY_DEFAULT = { diet: PLANT, allergens: [] };

  function profileOf(canonical) {
    return INGREDIENT_PROFILES[canonical] || PLANT_BY_DEFAULT;
  }

  /** Normalize an untrusted profile argument. */
  function normalizeProfile(profile) {
    const p = profile || {};
    const diets = [...new Set((p.diets || p.diet || []).map(x => String(x || "").toLowerCase().trim()).filter(Boolean))]
      .filter(d => SUPPORTED_DIETS.includes(d));
    const allergens = [...new Set((p.allergens || p.allergen || []).map(x => String(x || "").toLowerCase().trim()).filter(Boolean))]
      .filter(a => COMMON_ALLERGENS.includes(a));
    return { diets, allergens };
  }

  /** A recipe satisfies a diet only when its own diet tag claims it. */
  function recipeSatisfiesDiets(recipe, diets) {
    const tags = (recipe && recipe.diet) || [];
    return (diets || []).every(d => tags.includes(d));
  }

  /** Allergens carried by a recipe across its ingredients. */
  function recipeAllergens(recipe) {
    const set = new Set();
    ((recipe && recipe.ingredients) || []).forEach(ing => {
      (profileOf(ing.canonical).allergens || []).forEach(a => set.add(a));
    });
    return [...set];
  }

  /**
   * Whether a whole recipe is compatible with a cook's profile:
   * every requested diet is claimed by the recipe and no forbidden
   * allergen appears in any ingredient.
   */
  function recipeMatchesProfile(recipe, profile) {
    const p = normalizeProfile(profile);
    if (!recipeSatisfiesDiets(recipe, p.diets)) return false;
    const carried = new Set(recipeAllergens(recipe));
    return !p.allergens.some(a => carried.has(a));
  }

  /**
   * Substitution chains, best-first. Recipe-level overrides win over these.
   * Each option: { name, note, diet[], allergens[] }.
   */
  const SUBSTITUTION_CHAINS = {
    "cheese": [
      { name: "cheddar cheese", note: "Use half the amount; cheddar is saltier than parmesan.", diet: VEGGIE_DAIRY, allergens: ["dairy"] },
      { name: "nutritional yeast", note: "Vegan swap with the same savoury, cheesy depth; use about the same amount.", diet: PLANT, allergens: [] }
    ],
    "chicken-stock": [
      { name: "vegetable stock", note: "A direct 1:1 swap.", diet: PLANT, allergens: [] },
      { name: "mushroom stock", note: "1:1 swap with deeper umami.", diet: PLANT, allergens: [] }
    ],
    "vegetable-stock": [
      { name: "mushroom stock", note: "Plant-based 1:1 swap with deep umami.", diet: PLANT, allergens: [] },
      { name: "chicken stock", note: "Same amount; it works beautifully in risotto.", diet: ANIMAL, allergens: [] },
      { name: "water with a pinch of salt", note: "Last-resort 1:1 liquid swap.", diet: PLANT, allergens: [] }
    ],
    "butter": [
      { name: "olive oil", note: "Use about three quarters of the amount.", diet: PLANT, allergens: [] },
      { name: "coconut oil", note: "Plant-based solid-fat swap, same amount; pick refined for a neutral flavour.", diet: PLANT, allergens: [] }
    ],
    "maple-syrup": [
      { name: "agave syrup", note: "Same amount, mild and plant-based.", diet: PLANT, allergens: [] },
      { name: "honey", note: "Same amount, slightly sweeter.", diet: VEGGIE_EGG, allergens: [] }
    ],
    "honey": [
      { name: "maple syrup", note: "Same amount.", diet: PLANT, allergens: [] },
      { name: "agave syrup", note: "Same amount.", diet: PLANT, allergens: [] }
    ],
    "milk": [
      { name: "oat milk", note: "Closest neutral swap; use the same amount.", diet: PLANT, allergens: [] },
      { name: "water", note: "Works for savoury cooking; add a little extra fat if possible.", diet: PLANT, allergens: [] }
    ],
    "lemon": [
      { name: "rice vinegar", note: "Start with half the amount to keep the bright tang.", diet: PLANT, allergens: [] }
    ],
    "basil": [
      { name: "spinach", note: "Stir in at the very end for colour and freshness.", diet: PLANT, allergens: [] },
      { name: "oregano", note: "Use half as much dried oregano for a similar herbal note.", diet: PLANT, allergens: [] }
    ],
    "beef": [
      { name: "chicken", note: "Same weight; shorten the browning time slightly.", diet: ANIMAL, allergens: [] },
      { name: "portobello mushrooms", note: "Plant-based swap with a meaty texture; same weight, seared hard.", diet: PLANT, allergens: [] },
      { name: "firm tofu", note: "Plant-based swap: press well, tear into chunks and pan-fry until crisp.", diet: PLANT, allergens: ["soy"] }
    ],
    "shrimp": [
      { name: "chicken", note: "Same weight, cut into bite-size pieces.", diet: ANIMAL, allergens: [] },
      { name: "king oyster mushroom", note: "Plant-based swap; slice and sear for a springy bite.", diet: PLANT, allergens: [] },
      { name: "firm tofu", note: "Vegan swap, same weight, cubed and pan-fried.", diet: PLANT, allergens: ["soy"] }
    ],
    "sesame-oil": [
      { name: "olive oil", note: "Same amount, milder aroma.", diet: PLANT, allergens: [] }
    ],
    "rice-vinegar": [
      { name: "lemon juice", note: "Start with half the amount.", diet: PLANT, allergens: [] }
    ]
  };

  // Backwards-compatible flat view: the first (default) option per ingredient.
  const GLOBAL_SUBSTITUTIONS = Object.fromEntries(
    Object.entries(SUBSTITUTION_CHAINS).map(([k, chain]) => [k, normalizeOption(chain[0])])
  );

  function normalizeOption(opt) {
    return {
      name: opt.name,
      note: opt.note || "",
      diet: Array.isArray(opt.diet) ? [...opt.diet] : [],
      allergens: Array.isArray(opt.allergens) ? [...opt.allergens] : []
    };
  }

  function optionsFor(recipe, canonical) {
    const override = recipe && recipe.substitutions && recipe.substitutions[canonical];
    if (override) return (Array.isArray(override) ? override : [override]).map(normalizeOption);
    return (SUBSTITUTION_CHAINS[canonical] || []).map(normalizeOption);
  }

  /**
   * Constraints a swap must satisfy: the recipe's own diets always apply
   * (a vegetarian dish stays vegetarian after swapping), layered with the
   * cook's personal diets and allergens.
   */
  function constraintsFor(recipe, profile) {
    const p = normalizeProfile(profile);
    const diets = [...new Set([...((recipe && recipe.diet) || []), ...p.diets])];
    return { diets, allergens: p.allergens };
  }

  function optionCompatible(option, constraints) {
    const dietsOk = (constraints.diets || []).every(d => option.diet.includes(d));
    const allergensOk = !(constraints.allergens || []).some(a => option.allergens.includes(a));
    return dietsOk && allergensOk;
  }

  /** Why each non-chosen option was filtered out (for transparent UI/speech). */
  function rejectedReason(option, constraints) {
    const missingDiet = (constraints.diets || []).find(d => !option.diet.includes(d));
    if (missingDiet) return `not ${missingDiet}`;
    const badAllergen = (constraints.allergens || []).find(a => option.allergens.includes(a));
    if (badAllergen) return `contains ${badAllergen}`;
    return null;
  }

  /**
   * Find the best compatible substitution for a missing ingredient.
   * @param {object} recipe full recipe (may carry recipe.substitutions)
   * @param {string} canonical missing ingredient canonical id
   * @param {object} [profile] { diets: [], allergens: [] }
   * @returns {{name:string,note:string,diet:string[],allergens:string[]}|null}
   */
  function findSubstitute(recipe, canonical, profile) {
    const constraints = constraintsFor(recipe, profile);
    for (const opt of optionsFor(recipe, canonical)) {
      if (optionCompatible(opt, constraints)) return opt;
    }
    return null;
  }

  /**
   * Full swap picture: the chosen compatible option plus every rejected
   * alternative with a reason. Powers transparent UI and voice lines.
   */
  function listSubstitutes(recipe, canonical, profile) {
    const constraints = constraintsFor(recipe, profile);
    const chosen = findSubstitute(recipe, canonical, profile);
    const rejected = [];
    optionsFor(recipe, canonical).forEach(opt => {
      if (chosen && opt.name === chosen.name) return;
      const reason = rejectedReason(opt, constraints);
      if (reason) rejected.push({ ...opt, reason });
    });
    return { chosen, rejected, constraints };
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
   * One combined regex (longest alternative first) so each position is
   * scanned once and replacements are never re-scanned.
   */
  function substituteInSteps(steps, targetNames, replacementName) {
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

  function scoreOne(recipe, haveSet, profile) {
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
      } else if (haveSet.has(ing.canonical)) {
        earned += w;
        matched.push(ing.canonical);
      } else if (findSubstitute(recipe, ing.canonical, profile)) {
        // A swap keeps the dish cookable only when it respects the
        // cook's diet/allergens; otherwise it is a true hard miss.
        earned += w * 0.5;
        missingSubstitutable.push(ing.canonical);
      } else {
        missingHard.push(ing.canonical);
      }
    });

    const score = total === 0 ? 0 : Math.round((earned / total) * 100);
    return { recipe, score, matched, missingHard, missingSubstitutable, staplesAssumed };
  }

  function sortMatches(matches) {
    return matches.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.missingHard.length !== b.missingHard.length) {
        return a.missingHard.length - b.missingHard.length;
      }
      return a.recipe.name.localeCompare(b.recipe.name);
    });
  }

  /**
   * Score every recipe against the ingredients the cook has.
   * Pantry staples (ing.pantry === true) are assumed on hand. A missing
   * ingredient with a COMPATIBLE swap earns half credit. Recipes that
   * violate the cook's diet/allergens are excluded from the returned
   * list (use matchRecipesWithExclusions to inspect them).
   *
   * @param {string[]} haveCanonicals
   * @param {Array<object>} recipes
   * @param {object} [profile] { diets: [], allergens: [] }
   */
  function matchRecipes(haveCanonicals, recipes, profile) {
    return matchRecipesWithExclusions(haveCanonicals, recipes, profile).matches;
  }

  function matchRecipesWithExclusions(haveCanonicals, recipes, profile) {
    const have = new Set(haveCanonicals || []);
    const p = normalizeProfile(profile);
    const matches = [];
    const excluded = [];
    (recipes || []).forEach(recipe => {
      const m = scoreOne(recipe, have, p);
      if (recipeMatchesProfile(recipe, p)) {
        matches.push(m);
      } else {
        const reasons = [];
        if (!recipeSatisfiesDiets(recipe, p.diets)) reasons.push(`needs a ${p.diets.find(d => !recipe.diet.includes(d))} recipe`);
        const carried = new Set(recipeAllergens(recipe));
        p.allergens.filter(a => carried.has(a)).forEach(a => reasons.push(`contains ${a}`));
        excluded.push({ ...m, excludedReasons: reasons });
      }
    });
    return { matches: sortMatches(matches), excluded };
  }

  /** Top matches worth recommending (score above floor). */
  function topMatches(haveCanonicals, recipes, floor = 30, limit = 5, profile) {
    return matchRecipes(haveCanonicals, recipes, profile)
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
    SUBSTITUTION_CHAINS,
    INGREDIENT_PROFILES,
    SUPPORTED_DIETS,
    COMMON_ALLERGENS,
    ROLE_WEIGHT,
    normalizeIngredient,
    parseIngredientList,
    displayName,
    normalizeProfile,
    profileOf,
    recipeSatisfiesDiets,
    recipeAllergens,
    recipeMatchesProfile,
    findSubstitute,
    listSubstitutes,
    substituteInSteps,
    matchRecipes,
    matchRecipesWithExclusions,
    topMatches,
    ingredientWeight,
    Pantry
  };
});
