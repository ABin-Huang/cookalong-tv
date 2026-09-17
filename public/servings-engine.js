"use strict";

/**
 * CookAlong TV - serving scaling
 *
 * Scaling a recipe is arithmetic on the numbers and a grammar problem on the
 * words. Two rules keep it honest:
 *
 *   "200g of spaghetti"  -> a measurement: scale the number, leave the words
 *   "1 bell pepper"      -> a count: the noun has to agree, "2 bell peppers"
 *
 * The grammar is what makes a scaled recipe read as written by a person rather
 * than find-and-replaced, so it is worth the care. Three details decide whether
 * it works:
 *
 *   1. Countability is decided by the *quantity*, not the name. "1 small piece
 *      of ginger" counts pieces, not gingers.
 *   2. Agreement only happens for bare counts. "300g rolled oats" needs no
 *      agreement at any size, which is exactly what keeps uncountables like
 *      rice and oil out of reach of a pluraliser.
 *   3. Step prose is rewritten in a single pass that matches either a unit or a
 *      noun this recipe actually uses. Two passes would scale "2 garlic cloves"
 *      twice, once as a unit and once as a noun.
 *
 * Time is never touched: "cook for 18 minutes" means eighteen minutes whether
 * you are feeding two people or four. `scaleStepText` is tested against every
 * step in the recipe set for exactly that reason.
 *
 * Deliberately out of reach, because scaling them would be guessing:
 *   - amounts written as words ("half a teaspoon") — "one cup at a time" is a
 *     technique, not a quantity, and the two read identically
 *   - vague amounts ("to taste", "to serve", "a little", "a handful")
 * These render unchanged at every yield.
 *
 * UMD bundle: works as a CommonJS module (Node tests / Alexa skill) and as
 * `window.CookalongServings` in the Fire TV Web App.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.CookalongServings = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {

  const MIN_SERVINGS = 1;
  const MAX_SERVINGS = 12;

  /** Units a cook would scale. Time units are deliberately absent. */
  const SCALABLE_UNITS = [
    "kg", "g", "ml", "l", "oz", "lb", "lbs",
    "litre", "litres", "liter", "liters", "kilogram", "kilograms",
    "pound", "pounds", "ounce", "ounces", "quart", "quarts",
    "pint", "pints", "gallon", "gallons",
    "tbsp", "tbsps", "tablespoon", "tablespoons",
    "tsp", "tsps", "teaspoon", "teaspoons",
    "cup", "cups", "clove", "cloves", "can", "cans",
    "slice", "slices", "sprig", "sprigs", "stick", "sticks",
    "sheet", "sheets", "pinch", "pinches", "handful", "handfuls",
    "bunch", "bunches", "head", "heads", "stalk", "stalks",
    "ear", "ears", "bulb", "bulbs", "piece", "pieces", "packet", "packets",
  ];
  const TIME_UNITS = [
    "second", "seconds", "sec", "secs",
    "minute", "minutes", "min", "mins",
    "hour", "hours", "hr", "hrs",
  ];

  /**
   * Units written as words, where a cook expects the plural to appear.
   * Symbols are deliberately absent: a kitchen writes "2 tbsp", never "2 tbsps",
   * and "500 g", never "500 gs" — so those stay invariant at every size.
   */
  const AGREEMENT_UNITS = new Set([
    "clove", "slice", "cup", "can", "sprig", "stick", "sheet",
    "pinch", "handful", "bunch", "head", "stalk", "ear", "bulb",
    "piece", "packet", "tablespoon", "teaspoon",
    "litre", "liter", "kilogram", "pound", "ounce", "quart", "pint", "gallon",
  ]);

  /** Foods where a plural is always wrong, so the noun is left alone. */
  const MASS_NOUNS = new Set([
    "rice", "oil", "salt", "water", "stock", "sugar", "flour", "honey",
    "milk", "cheese", "butter", "spinach", "bread", "spaghetti", "pasta",
    "oats", "tofu", "beef", "chicken", "shrimp", "broccoli", "mushroom",
    "mushrooms", "basil", "cinnamon", "turmeric", "paprika", "ginger",
    "parmesan", "vinegar", "sauce", "yogurt", "cream",
  ]);

  /** Spoon-sized and countable amounts read as fractions; weights do not. */
  const SPOON_OR_COUNT = /^(tbsps?|tablespoons?|tsps?|teaspoons?|cups?|cloves?|cans?|slices?|sprigs?|sticks?|sheets?|pinches?|handfuls?|bunch(es)?|heads?|stalks?|ears?|bulbs?|pieces?|packets?)$/i;
  const MASS_OR_VOLUME = /^(kg|g|ml|l|oz|lbs?|litres?|liters?|kilograms?|pounds?|ounces?|quarts?|pints?|gallons?)$/i;

  /** Descriptors that can sit between an amount and its noun. */
  const ADJECTIVES = [
    "small", "medium", "large", "big", "little", "ripe", "thick", "thin",
    "fresh", "whole", "baby", "extra", "light", "heavy", "fine", "coarse",
    "chopped", "minced", "grated", "crushed", "dried", "ground", "frozen",
    "sliced", "cubed", "halved", "diced", "shredded", "julienned", "quartered",
    "mashed", "beaten", "melted", "softened", "torn", "trimmed", "deveined",
    "deseeded", "boneless", "skinless", "lean", "firm",
    "soft", "warm", "cold", "hot", "raw", "cooked", "toasted", "peeled",
    "seeded", "drained", "rinsed", "packed", "heaping", "level", "thick-cut",
  ];

  const IRREGULAR_PLURALS = { leaf: "leaves", potato: "potatoes", tomato: "tomatoes", half: "halves" };
  const IRREGULAR_SINGULARS = { leaves: "leaf", potatoes: "potato", tomatoes: "tomato", halves: "half" };

  const NUMBER = String.raw`\d+(?:[.,]\d+)?`;
  const FRACTION = String.raw`\d+\s*\/\s*\d+`;
  const MIXED = String.raw`\d+\s+\d+\s*\/\s*\d+`;
  const AMOUNT = `(?:${MIXED}|${FRACTION}|${NUMBER})`;

  const HEAD_RE = new RegExp(`^(${AMOUNT})(?:\\s*(?:-|–|to)\\s*(${AMOUNT}))?(\\s*)(.*)$`);

  const escapeRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const byLengthDesc = (a, b) => b.length - a.length;

  function toNumber(token) {
    const t = String(token).trim().replace(",", ".");
    // `Number("")` is 0, and a blank amount is not zero worth of anything.
    if (!t) return NaN;
    const mixed = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(t);
    if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
    const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
    if (frac) return Number(frac[1]) / Number(frac[2]);
    const n = Number(t);
    return Number.isFinite(n) ? n : NaN;
  }

  const FRACTION_LABELS = { 0.25: "1/4", 0.5: "1/2", 0.75: "3/4" };
  /** Denominators a kitchen actually has. A third of a cup is a real measure. */
  const FRACTION_DENOMS = [2, 3, 4, 6, 8, 12];

  /**
   * Render a number the way a recipe writes it. An exact fraction wins, so
   * doubling "1/3 cup" gives "2/3 cup" and halving "1/4 tsp" gives "1/8 tsp"
   * rather than something rounded into a different dish. Only when nothing fits
   * does it fall back to quarters — and a trace too small to measure is refused
   * outright, so the caller can leave the line alone instead of printing "0".
   */
  function asFraction(value) {
    if (!Number.isFinite(value) || value <= 0) return "";
    const whole = Math.floor(value + 1e-9);
    const frac = value - whole;
    if (frac < 1e-9) return String(whole);

    for (const denom of FRACTION_DENOMS) {
      const n = frac * denom;
      const rounded = Math.round(n);
      if (Math.abs(n - rounded) < 1e-9 && rounded < denom) {
        const label = `${rounded}/${denom}`;
        return whole === 0 ? label : `${whole} ${label}`;
      }
    }

    const quarters = Math.round(frac * 4) / 4;
    if (quarters >= 1) return String(whole + quarters);
    if (quarters > 0) {
      const label = FRACTION_LABELS[quarters];
      return whole === 0 ? label : `${whole} ${label}`;
    }
    return "";
  }

  const roundTo = (value, step) => Math.round(value / step) * step;

  /**
   * Plural only above one. Half a cup is "1/2 cup", not "1/2 cups", and the
   * same reading fixes "0.5 tomatoes" to "0.5 tomato".
   */
  const agreementForm = value => (Number(value) > 1 ? 2 : 1);

  function formatAmount(value, unit) {
    if (!Number.isFinite(value) || value <= 0) return "";
    if (SPOON_OR_COUNT.test(unit)) return asFraction(value);
    if (MASS_OR_VOLUME.test(unit)) {
      // 266.66667g is not a kitchen instruction, but neither is rounding a
      // litre of stock up by a tenth: small volumes keep a tenth of a unit.
      const step = value >= 50 ? 5 : value >= 10 ? 1 : value >= 3 ? 0.5 : 0.1;
      const rounded = roundTo(value, step);
      return Number.isInteger(rounded) ? String(rounded) : String(Math.round(rounded * 10) / 10);
    }
    return asFraction(value);
  }

  function pluralize(word) {
    const w = String(word || "");
    if (!w) return w;
    const irregular = IRREGULAR_PLURALS[w.toLowerCase()];
    if (irregular) return irregular;
    if (/(s|sh|ch|x|z)$/i.test(w)) return `${w}es`;
    if (/[^aeiou]y$/i.test(w)) return `${w.slice(0, -1)}ies`;
    return `${w}s`;
  }

  function singularize(word) {
    const w = String(word || "");
    if (!w) return w;
    const irregular = IRREGULAR_SINGULARS[w.toLowerCase()];
    if (irregular) return irregular;
    if (/ies$/i.test(w)) return `${w.slice(0, -3)}y`;
    if (/(ses|shes|ches|xes|zes)$/i.test(w)) return w.slice(0, -2);
    if (/s$/i.test(w) && !/ss$/i.test(w)) return w.slice(0, -1);
    return w;
  }

  /**
   * Put a word in the form the amount demands. Normalising to the singular
   * first is what makes this idempotent: agreeing an already-plural "cloves"
   * must not produce "cloveses".
   */
  function agree(word, form) {
    const w = String(word || "");
    if (!w) return w;
    const base = singularize(w);
    return form === 1 ? base : pluralize(base);
  }

  /**
   * Agree the unit inside a quantity. "1 cup rice" is not "2 cup rice": the
   * counted thing is the cup. Only word-units do this — "500 g" stays "500 g".
   */
  function agreeUnit(rest, unit, form) {
    if (!AGREEMENT_UNITS.has(singularize(unit).toLowerCase())) return rest;
    const m = /^(\s*)(\S+)([\s\S]*)$/.exec(String(rest || ""));
    if (!m) return rest;
    return `${m[1]}${agree(m[2], form)}${m[3]}`;
  }

  /** The noun a quantity counts: "1 small piece" counts pieces, not ginger. */
  function headInQuantity(text) {
    const words = String(text || "").split(/\s+/).filter(Boolean);
    for (let i = words.length - 1; i >= 0; i -= 1) {
      const bare = words[i].replace(/[^A-Za-z-]/g, "").toLowerCase();
      if (bare && !ADJECTIVES.includes(bare)) return words[i];
    }
    return null;
  }

  /**
   * Split a quantity into its parts. A `unit` that is really an adjective means
   * the amount is a bare count ("2 ripe" bananas).
   */
  function parseQty(qty) {
    const text = String(qty == null ? "" : qty).trim();
    if (!text) return null;
    const m = HEAD_RE.exec(text);
    if (!m) return null;                       // "to taste", "a handful", "a pinch"

    const amount = toNumber(m[1]);
    if (!Number.isFinite(amount)) return null;

    const max = m[2] ? toNumber(m[2]) : null;
    const unit = ((m[4] || "").split(/\s+/)[0] || "").toLowerCase();

    return {
      amount,
      max: Number.isFinite(max) ? max : null,
      gap: m[3] || "",
      rest: m[4] || "",
      unit,
      hasUnit: SCALABLE_UNITS.includes(unit),
      scalable: !TIME_UNITS.includes(unit),
    };
  }

  function factorFor(baseServes, servings) {
    const base = Number(baseServes);
    const want = Number(servings);
    if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(want) || want <= 0) return 1;
    return want / base;
  }

  function clampServings(servings) {
    const n = Math.round(Number(servings));
    if (!Number.isFinite(n)) return MIN_SERVINGS;
    return Math.max(MIN_SERVINGS, Math.min(MAX_SERVINGS, n));
  }

  /**
   * Scale one quantity string, preserving its original spacing — "40g" stays
   * "80g" and "2 tbsp" stays "4 tbsp", because a list that rewrites its own
   * punctuation looks machine-edited.
   */
  function scaleQty(qty, factor) {
    const original = String(qty == null ? "" : qty).trim();
    const parsed = parseQty(qty);
    if (!parsed || !parsed.scalable) return original;
    if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return original;

    const start = formatAmount(parsed.amount * factor, parsed.unit);
    if (!start) return original;

    if (parsed.max === null) {
      const rest = agreeUnit(parsed.rest, parsed.unit, agreementForm(toNumber(start)));
      return `${start}${parsed.gap}${rest}`.trimEnd();
    }

    const end = formatAmount(parsed.max * factor, parsed.unit);
    // Keep the range written the way the author wrote it.
    const sep = /\s+to\s+/i.test(original) ? " to " : /–/.test(original) ? "–" : "-";
    // The upper bound governs agreement: "1-2 cups", never "1-2 cup".
    const rest = agreeUnit(parsed.rest, parsed.unit, agreementForm(toNumber(end)));
    return `${start}${sep}${end}${parsed.gap}${rest}`.trimEnd();
  }

  /**
   * The ingredient list at a new yield: numbers scaled, and for bare counts the
   * countable noun made to agree — in the quantity when the quantity names it
   * ("2 small pieces"), otherwise in the ingredient name ("2 bell peppers").
   */
  function scaleIngredients(ingredients, factor) {
    return (ingredients || []).map(ing => {
      const next = { ...ing, qty: scaleQty(ing.qty, factor) };
      const parsed = parseQty(ing.qty);

      if (!parsed || parsed.hasUnit || parsed.max !== null) return next;
      if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return next;

      const rendered = formatAmount(parsed.amount * factor, parsed.unit);
      const scaled = toNumber(rendered);
      if (!Number.isFinite(scaled) || scaled <= 0) return next;
      const form = agreementForm(scaled);

      const inQty = headInQuantity(parsed.rest);
      if (inQty) {
        const key = singularize(inQty).toLowerCase();
        if (!AGREEMENT_UNITS.has(key)) return next;
        const words = parsed.rest.split(/\s+/);
        words[words.indexOf(inQty)] = agree(inQty, form);
        next.qty = `${rendered}${parsed.gap}${words.join(" ")}`;
        return next;
      }

      const words = String(ing.name || "").split(/\s+/).filter(Boolean);
      if (!words.length) return next;
      const last = words[words.length - 1];
      if (MASS_NOUNS.has(singularize(last).toLowerCase()) && !AGREEMENT_UNITS.has(singularize(last).toLowerCase())) {
        return next;                            // uncountable: leave the noun alone
      }
      words[words.length - 1] = agree(last, form);
      next.name = words.join(" ");
      return next;
    });
  }

  /**
   * Every noun form this recipe could mention in prose. Only the *last* word of
   * each name is offered as a head, plus the full name — including "garlic" on
   * its own would let "3 crushed garlic cloves" agree the wrong word.
   */
  function ingredientHeads(ingredients) {
    const heads = new Set();
    (ingredients || []).forEach(ing => {
      const name = String(ing.name || "").trim().toLowerCase();
      if (!name) return;
      const words = name.split(/\s+/).filter(Boolean);
      const last = words[words.length - 1].replace(/[^a-z-]/g, "");
      if (!last) return;
      if (words.length > 1) heads.add(name);
      [last, singularize(last), pluralize(last)].forEach(form => {
        if (form.length > 2) heads.add(form);
      });
    });
    return heads;
  }

  /**
   * Rescale the amounts inside a step.
   *
   * One pass, matching either a scalable unit or a noun this recipe uses. The
   * words between the number and that word must all be descriptors, and that
   * single constraint is what keeps "cook for 18 minutes" and "3 crushed
   * garlic cloves" from being confused for each other.
   */
  function scaleStepText(text, factor, heads) {
    const out = String(text == null ? "" : text);
    if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return out;

    const phrases = [...(heads instanceof Set ? heads : new Set(heads || []))]
      .map(h => String(h || "").toLowerCase().trim())
      .filter(h => h.length > 1)
      .sort(byLengthDesc);

    const unitAlt = SCALABLE_UNITS.slice().sort(byLengthDesc).map(escapeRe).join("|");
    // `(?!)` never matches, so a recipe with no named ingredients still scales
    // its measurements instead of silently scaling nothing.
    const headAlt = phrases.length ? phrases.map(escapeRe).join("|") : "(?!)";
    const adjAlt = ADJECTIVES.slice().sort(byLengthDesc).map(escapeRe).join("|");

    const re = new RegExp(
      `\\b(${AMOUNT})(?:\\s*(-|–|to)\\s*(${AMOUNT}))?` +
        `((?:\\s+(?:${adjAlt})){0,2})(\\s*)(?:(${unitAlt})|(${headAlt}))\\b`,
      "gi"
    );

    return out.replace(re, (match, amount, rangeSep, upper, descriptors, gap, unit, head) => {
      const value = toNumber(amount);
      if (!Number.isFinite(value)) return match;

      // A head is scaled as a bare count, so its number is never given a unit;
      // a unit is a measurement, and measurements round.
      const phrase = unit || head || "";
      const unitFor = unit ? phrase : "";
      const rendered = formatAmount(value * factor, unitFor);
      if (!rendered) return match;

      let scaled = rendered;
      let governs = toNumber(rendered);
      if (upper != null) {
        const bounded = formatAmount(toNumber(upper) * factor, unitFor);
        if (!bounded) return match;
        // The regex eats the spaces around the separator, so "to" needs them back.
        const sep = /^to$/i.test(rangeSep) ? " to " : rangeSep;
        scaled = `${rendered}${sep}${bounded}`;
        governs = toNumber(bounded);               // "1-2 cups", never "1-2 cup"
      }
      const form = agreementForm(governs);

      let fixed = phrase;
      if (unit) {
        if (AGREEMENT_UNITS.has(singularize(phrase).toLowerCase())) fixed = agree(phrase, form);
      } else if (!MASS_NOUNS.has(singularize(headInQuantity(phrase) || phrase).toLowerCase())) {
        const words = phrase.split(/\s+/);
        words[words.length - 1] = agree(words[words.length - 1], form);
        fixed = words.join(" ");
      }

      return `${scaled}${descriptors}${gap}${fixed}`;
    });
  }

  /** Per-serving figures multiplied out for the chosen yield. */
  function totalNutrition(nutrition, servings) {
    if (!nutrition || !Number.isFinite(Number(servings)) || Number(servings) <= 0) return null;
    const out = {};
    ["kcal", "protein", "carbs", "fat"].forEach(key => {
      const value = Number(nutrition[key]);
      if (Number.isFinite(value)) out[key] = Math.round(value * Number(servings));
    });
    return Object.keys(out).length ? out : null;
  }

  return {
    MIN_SERVINGS,
    MAX_SERVINGS,
    SCALABLE_UNITS,
    TIME_UNITS,
    AGREEMENT_UNITS,
    MASS_NOUNS,
    toNumber,
    formatAmount,
    pluralize,
    singularize,
    agree,
    agreeUnit,
    agreementForm,
    parseQty,
    factorFor,
    clampServings,
    scaleQty,
    scaleIngredients,
    scaleStepText,
    ingredientHeads,
    totalNutrition,
  };
});
