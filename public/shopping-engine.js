"use strict";

/**
 * CookAlong TV - Shopping list engine
 *
 * The kitchen panel already answers "what can I cook with what I have?" and the
 * swap panel already answers "what do I do about the one thing I'm missing?".
 * Neither answers the question that actually sends someone to the shop: what do
 * I have to BUY?
 *
 * That is a different sum from "what does this recipe use", and the difference
 * is the whole engine. A recipe lists salt and olive oil; a shopping list does
 * not, because they are already in the cupboard. A recipe is written for its own
 * yield; a list has to be scaled to the pot in front of you. And two dishes that
 * both want garlic want one amount of garlic, not two lines.
 *
 * Three rules keep the arithmetic honest:
 *
 *   1. Amounts add up only when the unit is the same. 400g of rice plus 300g of
 *      rice is 500g of rice; 200g of tomatoes plus 2 tomatoes is not 202 of
 *      anything, and the second case is kept as two lines rather than guessed at.
 *   2. Amounts that are not numbers are never summed. "To taste", "to serve"
 *      and "a handful" are not purchasable quantities, so they are carried
 *      through in the recipe's own words and counted as "as needed" instead.
 *   3. Adding up two amounts is scaling one of them. `addQty` therefore returns
 *      the result of running the amount through the serving scaler rather than
 *      re-rendering it here — which is what keeps "3 garlic cloves" and
 *      "2 garlic cloves" reading as "5 garlic cloves" and not as "5 garlic clove".
 *
 * UMD bundle: works as a CommonJS module (Node tests / Alexa skill) and as
 * `window.CookalongShopping` in the Fire TV Web App.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./servings.js"), require("./ingredients.js"));
  } else {
    root.CookalongShopping = factory(root.CookalongServings, root.CookalongIngredients);
  }
})(typeof self !== "undefined" ? self : this, function (servingsEngine, ingredientsEngine) {

  /** How many lines a recitation reads before it counts the rest. */
  const DEFAULT_SPEAK_LIMIT = 4;

  const P = servingsEngine || null;

  /**
   * Units as a cook says them out loud. A shopping list gets read aloud, and
   * "400 g" is only "400 grams" if something expands it.
   */
  const SPOKEN_UNITS = {
    g: "gram", kg: "kilogram", mg: "milligram",
    ml: "milliliter", l: "liter", litre: "liter", liter: "liter",
    oz: "ounce", lb: "pound", lbs: "pound",
    tbsp: "tablespoon", tbsps: "tablespoon",
    tsp: "teaspoon", tsps: "teaspoon",
    cup: "cup", clove: "clove", can: "can", slice: "slice", sprig: "sprig",
    stick: "stick", sheet: "sheet", pinch: "pinch", handful: "handful",
    bunch: "bunch", head: "head", stalk: "stalk", ear: "ear", bulb: "bulb",
    piece: "piece", packet: "packet",
  };

  function singular(word) {
    const w = String(word == null ? "" : word).toLowerCase();
    return P ? P.singularize(w) : w;
  }

  /**
   * The thing an amount counts, so that equal things are recognised as equal.
   *
   * "2 tbsp" counts tablespoons. "4 thick slices" counts slices — the unit slot
   * holds "thick", which is a descriptor, so the counted noun has to be read off
   * the quantity the same way the scaler reads it. A bare "3" counts whatever the
   * ingredient name says, and is represented as the empty unit.
   */
  function unitKeyOf(parsed) {
    if (!parsed) return null;
    if (parsed.hasUnit) return singular(parsed.unit);
    const head = P ? P.headInQuantity(parsed.rest) : null;
    return head ? singular(head) : "";
  }

  /**
   * A stable identity for a line on the list. Two lines with the same key are
   * the same purchase; anything with a different key is deliberately kept apart.
   */
  function itemKey(canonical, parsed) {
    if (!parsed) return `${canonical}|~asneeded`;
    // A range is not a purchasable total, and neither is it equal to a
    // different range, so the bounds are part of the identity.
    if (parsed.max !== null) return `${canonical}|~range:${parsed.amount}-${parsed.max}`;
    return `${canonical}|${unitKeyOf(parsed)}`;
  }

  function clone(item) {
    const sources = {};
    Object.entries(item.sources || {}).forEach(([id, source]) => { sources[id] = { ...source }; });
    return {
      ...item,
      sources,
      forRecipeNames: [...(item.forRecipeNames || [])],
      skipWith: item.skipWith ? { ...item.skipWith } : null,
    };
  }

  /**
   * Add two quantities, or refuse.
   *
   * The addition is a scaling: `qtyA` grown by (a + b) / a. Handing that to the
   * serving scaler is what makes the result render exactly like a recipe scaled
   * to a new yield — the rounding, the unit agreement and the noun agreement all
   * come from the one implementation instead of a second one written here.
   *
   * @returns {{qty:string, name:string}|null} null when the two are not the same
   *   kind of thing, so the caller keeps two lines instead of inventing a total.
   */
  function addQty(qtyA, qtyB, name) {
    if (!P) return null;
    const a = P.parseQty(qtyA);
    const b = P.parseQty(qtyB);
    if (!a || !b) return null;
    if (a.max !== null || b.max !== null) return null;
    if (!a.scalable || !b.scalable) return null;
    if (!(a.amount > 0) || !(b.amount > 0)) return null;
    if (unitKeyOf(a) !== unitKeyOf(b)) return null;

    const factor = (a.amount + b.amount) / a.amount;
    // scaleIngredients, not scaleQty: a bare count agrees its noun, and that
    // noun can live in the quantity ("4 thick slices") or in the name ("bell
    // peppers") depending on how the recipe was written.
    const [merged] = P.scaleIngredients([{ name, qty: qtyA }], factor);
    if (!merged || !merged.qty) return null;
    return { qty: merged.qty, name: merged.name };
  }

  /**
   * A substitution the cook already owns, for an ingredient they do not.
   *
   * This is the link between the two halves of the app: the swap panel says a
   * missing ingredient can be replaced, and this says whether the replacement is
   * already in the cupboard — which is the difference between "buy parmesan" and
   * "skip the parmesan, you have nutritional yeast".
   */
  function skipWithFor(recipe, canonical, owned, profile) {
    if (!ingredientsEngine || !owned || !owned.size) return null;
    const info = ingredientsEngine.listSubstitutes(recipe, canonical, profile);
    for (const opt of (info && info.compatible) || []) {
      const asCanonical = ingredientsEngine.normalizeIngredient(opt.name);
      if (asCanonical && owned.has(asCanonical)) {
        return { canonical: asCanonical, name: opt.name, note: opt.note || "" };
      }
    }
    return null;
  }

  /**
   * Everything the cook is treated as already having: what they told us, plus
   * this recipe's own pantry staples.
   *
   * Staples count because the matcher already assumes them ("pantry staples are
   * assumed on hand"), and a list that told you to buy salt for a dish whose own
   * recipe file marks salt as a staple would contradict the score on the card
   * that sent you here.
   */
  function ownedSet(recipes, have) {
    const owned = new Set(have || []);
    (recipes || []).forEach(recipe => {
      ((recipe && recipe.ingredients) || []).forEach(ing => {
        if (ing && ing.pantry && ing.canonical) owned.add(ing.canonical);
      });
    });
    return owned;
  }

  /**
   * Whether an amount is one a cook can buy. A source recorded by hand may not
   * carry the flag, so it is read back off the words rather than trusted.
   */
  function isAsNeeded(qty) {
    return P ? P.parseQty(qty) === null : !String(qty == null ? "" : qty).trim();
  }

  function itemFor(recipe, ing, factor, owned, profile) {
    const scaled = P ? P.scaleIngredients([ing], factor)[0] : ing;
    const qty = scaled.qty;
    const parsed = P ? P.parseQty(qty) : null;
    const item = {
      key: itemKey(ing.canonical, parsed),
      canonical: ing.canonical,
      name: scaled.name,
      qty,
      // Not a number, so not a total: carried in the recipe's own words and
      // never added to anything.
      asNeeded: parsed === null,
      role: ing.role || "",
      staple: !!ing.pantry,
      bought: false,
      // What each dish asks for, kept apart so the total can be re-derived
      // instead of accumulated. See addItems().
      sources: { [recipe.id]: { qty, name: scaled.name, asNeeded: parsed === null, recipeName: recipe.name } },
      forRecipeNames: [recipe.name],
      dishes: 1,
      skipWith: skipWithFor(recipe, ing.canonical, owned, profile),
    };
    return item;
  }

  /**
   * What to buy for one recipe.
   *
   * @param {object} recipe a recipe with `ingredients` and `serves`
   * @param {object} [opts]
   * @param {number} [opts.servings] the yield being cooked; defaults to the
   *   recipe's own, so passing nothing lists the recipe as written
   * @param {string[]} [opts.have] canonical ids the cook already has
   * @param {boolean} [opts.includeStaples] also list the pantry staples, for a
   *   cook shopping for an empty kitchen rather than for tonight
   * @param {object} [opts.profile] { diets, allergens } for substitution safety
   * @returns {{items:object[], have:string[], staples:string[], servings:number, factor:number}}
   */
  function itemsToBuy(recipe, opts) {
    const o = opts || {};
    const empty = { items: [], have: [], staples: [], servings: 0, factor: 1 };
    if (!recipe || !Array.isArray(recipe.ingredients)) return empty;

    const servings = Number.isFinite(Number(o.servings)) && Number(o.servings) > 0
      ? Number(o.servings)
      : Number(recipe.serves) || 1;
    const factor = P ? P.factorFor(recipe.serves, servings) : 1;
    const have = new Set(o.have || []);
    const owned = ownedSet([recipe], o.have);
    const includeStaples = !!o.includeStaples;

    const items = [];
    const kept = [];
    const staples = [];

    recipe.ingredients.forEach(ing => {
      if (!ing || !ing.canonical) return;
      const isStaple = !!ing.pantry;
      if (isStaple) {
        staples.push(ing.canonical);
        // Seasoning is assumed on hand, but a cook stocking a kitchen needs it.
        if (!includeStaples) return;
      }
      if (have.has(ing.canonical)) { kept.push(ing.canonical); return; }
      items.push(itemFor(recipe, ing, factor, owned, o.profile));
    });

    return { items, have: kept, staples, servings, factor };
  }

  /**
   * Re-derive a line's amount from the dishes asking for it.
   *
   * The list keeps what each dish wants rather than a running total, because a
   * running total cannot answer the question a cook actually asks of it. Pressing
   * "add what's missing" twice for the same recipe must not double the shopping,
   * and re-adding it after turning the servings up must *correct* the amount
   * rather than pile a second lot on top. Both fall out of storing the sources
   * and adding them up again from scratch.
   *
   * Every source under one key is the same kind of thing by construction — the
   * key carries the unit, and an amount that is not a number gets a key of its
   * own — so the fold never has to reconcile a mismatch, and the one case it
   * cannot add up (a range) is left as the single figure it already is.
   */
  function recompute(item) {
    const sources = Object.values(item.sources || {});
    item.dishes = sources.length;
    item.forRecipeNames = sources.map(s => s.recipeName).filter(Boolean);
    if (!sources.length) return item;

    const first = sources[0];
    // Read the flag back off the words when a source does not carry one, so a
    // merge can never quietly promote "a handful" into a number it can add up.
    item.asNeeded = first.asNeeded === undefined ? isAsNeeded(first.qty) : !!first.asNeeded;
    item.name = first.name;
    item.qty = first.qty;
    if (item.asNeeded) return item;

    for (let i = 1; i < sources.length; i += 1) {
      const merged = addQty(item.qty, sources[i].qty, item.name);
      if (!merged) continue;
      item.qty = merged.qty;
      item.name = merged.name;
    }
    return item;
  }

  /**
   * A line the cook asked for by name — "add garlic to my shopping list".
   *
   * There is no recipe and no amount behind it, so it is honestly labelled as
   * wanted rather than measured. That labelling is also what keeps it from being
   * added to a recipe's numbered need: "3 cloves of garlic" and "garlic" are not
   * the same purchase, and the key says so, so they stay two lines rather than
   * becoming a total that means nothing.
   */
  function manualItem(name, canonical) {
    const label = String(name == null ? "" : name).trim();
    if (!label) return null;
    const id = canonical
      || (ingredientsEngine ? ingredientsEngine.normalizeIngredient(label) : null)
      || label.toLowerCase();
    return {
      key: `${id}|~asneeded`,
      canonical: id,
      name: label,
      qty: "",
      asNeeded: true,
      role: "",
      staple: false,
      bought: false,
      sources: { manual: { qty: "", name: label, asNeeded: true, recipeName: "you" } },
      forRecipeNames: ["you"],
      dishes: 1,
      skipWith: null,
    };
  }

  /** Fold a newly listed need into the line that already covers it. */
  function absorb(prev, item) {
    const next = clone(prev);
    const before = { qty: prev.qty, name: prev.name, asNeeded: !!prev.asNeeded };

    Object.entries(item.sources || {}).forEach(([id, source]) => { next.sources[id] = { ...source }; });
    recompute(next);

    // Re-adding a dish unchanged must not un-tick a list you have already
    // shopped. Only a changed amount puts the line back in play, because only
    // then is there something new to buy.
    if (next.qty !== before.qty || next.name !== before.name || next.asNeeded !== before.asNeeded) {
      next.bought = false;
    }
    if (!next.skipWith && item.skipWith) next.skipWith = item.skipWith;
    return next;
  }

  /**
   * Append items to a list, adding up what can be added up. Pure: the list passed
   * in is never touched, so the caller can keep the old one for an undo.
   */
  function addItems(list, incoming) {
    const out = (list || []).map(clone);
    (incoming || []).forEach(item => {
      if (!item || !item.key) return;
      const at = out.findIndex(x => x.key === item.key);
      if (at === -1) out.push(recompute(clone(item)));
      else out[at] = absorb(out[at], item);
    });
    return out;
  }

  function setBought(list, key, bought) {
    return (list || []).map(item => (item.key === key ? { ...clone(item), bought: !!bought } : clone(item)));
  }

  function removeItem(list, key) {
    return (list || []).filter(item => item.key !== key).map(clone);
  }

  function clearBought(list) {
    return (list || []).filter(item => !item.bought).map(clone);
  }

  function clearAll() {
    return [];
  }

  function summary(list) {
    const items = list || [];
    const bought = items.filter(i => i.bought).length;
    return {
      total: items.length,
      bought,
      remaining: items.length - bought,
      asNeeded: items.filter(i => i.asNeeded).length,
      skipable: items.filter(i => i.skipWith).length,
    };
  }

  /** One amount, phrased the way it would be said out loud. */
  function speakQty(qty) {
    const text = String(qty == null ? "" : qty).trim();
    if (!P) return text;
    const parsed = P.parseQty(text);
    if (!parsed || !parsed.hasUnit) return text;
    const spoken = SPOKEN_UNITS[singular(parsed.unit)];
    if (!spoken) return text;
    const amount = P.formatAmount(parsed.amount, parsed.unit);
    if (!amount) return text;
    const unit = P.agree(spoken, P.agreementForm(P.toNumber(amount)));
    const tail = parsed.rest.split(/\s+/).slice(1).join(" ").trim();
    return tail ? `${amount} ${unit} ${tail}` : `${amount} ${unit}`;
  }

  /** One line as it would be read aloud. */
  function speakItem(item) {
    if (!item) return "";
    if (!item.qty) return item.name;          // named by the cook, with no amount
    return item.asNeeded ? `${item.name}, ${item.qty}` : `${speakQty(item.qty)} ${item.name}`;
  }

  /**
   * The whole list in one breath, capped so it stays a sentence rather than a
   * recitation. Anything left over is named by count, which is enough because
   * the cook can ask to hear it again.
   */
  function speak(list, limit = DEFAULT_SPEAK_LIMIT) {
    const items = (list || []).filter(i => !i.bought);
    if (!items.length) {
      return (list || []).length
        ? "Everything on your shopping list is already ticked off."
        : "Your shopping list is empty.";
    }
    // A limit that is not a number would slice the list to nothing and read out
    // an empty recitation — a wrong answer delivered confidently. Fall back to
    // the default instead.
    const cap = Math.max(1, Number(limit) || DEFAULT_SPEAK_LIMIT);
    const shown = items.slice(0, cap).map(speakItem);
    const rest = items.length - shown.length;
    const head = items.length === 1 ? "One thing to buy" : `${items.length} things to buy`;
    const tail = rest > 0 ? `, and ${rest} more` : "";
    return `${head}: ${shown.join(", ")}${tail}.`;
  }

  /**
   * Read a spoken addition ("garlic", "400 g of chicken"). Returns the canonical
   * ingredients that were recognised, so the caller can say what it did not
   * understand instead of silently dropping it.
   */
  function parseAdditions(text) {
    if (!ingredientsEngine) return { recognized: [], unknown: [] };
    return ingredientsEngine.parseIngredientList(text);
  }

  return {
    SPOKEN_UNITS,
    unitKeyOf,
    itemKey,
    addQty,
    itemsToBuy,
    manualItem,
    addItems,
    setBought,
    removeItem,
    clearBought,
    clearAll,
    summary,
    speakQty,
    speakItem,
    speak,
    parseAdditions,
  };
});
