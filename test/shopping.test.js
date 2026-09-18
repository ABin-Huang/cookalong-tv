"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

const S = require("../src/shopping");
const SERV = require("../src/servings");
const { RECIPES } = require("../src/recipes");

const byId = id => RECIPES.find(r => r.id === id);

/** ["200g spaghetti", ...] — the shape a list is judged on. */
const lines = list => list.map(i => (i.asNeeded ? `${i.name}=${i.qty}` : `${i.qty} ${i.name}`));

const buyFor = (id, opts) => S.itemsToBuy(byId(id), opts).items;

// ---------------------------------------------------------------------------
// what does and does not belong on a shopping list
// ---------------------------------------------------------------------------

test("seasoning the recipe treats as pantry stock is not on the shopping list", () => {
  // The recipe file marks salt, pepper and olive oil as on hand, and the matcher
  // scores them as on hand. A list that sent you out to buy salt for a dish whose
  // own card said you had everything would contradict itself.
  const out = S.itemsToBuy(byId("tomato-basil-pasta"));
  assert.deepStrictEqual(lines(out.items), [
    "200g spaghetti", "400g crushed tomatoes", "3 garlic cloves", "fresh basil leaves=a handful",
  ]);
  assert.deepStrictEqual(out.staples, ["olive-oil", "salt", "black-pepper"]);
  assert.ok(!out.items.some(i => i.staple), "no staple may reach the list by default");
});

test("what the cook already has is not on the list, and is reported instead", () => {
  const out = S.itemsToBuy(byId("tomato-basil-pasta"), { have: ["pasta", "garlic"] });
  assert.deepStrictEqual(lines(out.items), ["400g crushed tomatoes", "fresh basil leaves=a handful"]);
  assert.deepStrictEqual(out.have, ["pasta", "garlic"]);
});

test("a cook stocking an empty kitchen can ask for the staples too", () => {
  const out = S.itemsToBuy(byId("tomato-basil-pasta"), { includeStaples: true });
  const names = out.items.map(i => i.canonical);
  ["olive-oil", "salt", "black-pepper"].forEach(c => assert.ok(names.includes(c), `${c} should be listed`));
  assert.strictEqual(out.staples.length, 3, "they are still reported as staples, not as ordinary needs");
});

test("the recipe's own staple counts as on hand for substitution advice", () => {
  // Risotto stocks olive oil as a staple and wants parmesan. Olive oil is also
  // the documented swap for butter elsewhere, so the staple set is what lets the
  // list reason about what the cook owns without being told.
  const out = S.itemsToBuy(byId("mushroom-risotto"));
  assert.ok(!out.items.some(i => i.canonical === "olive-oil"), "a staple must not be a purchase");
  assert.ok(out.items.some(i => i.canonical === "cheese"), "parmesan is a real purchase");
});

// ---------------------------------------------------------------------------
// amounts
// ---------------------------------------------------------------------------

test("the list is scaled to the yield being cooked, not to the recipe's own", () => {
  const asWritten = buyFor("garlic-chicken-rice");
  assert.deepStrictEqual(lines(asWritten), ["400g chicken thighs", "300g rice", "600ml chicken stock", "4 garlic cloves"]);

  const doubled = S.itemsToBuy(byId("garlic-chicken-rice"), { servings: 6 });
  assert.strictEqual(doubled.factor, 2);
  assert.deepStrictEqual(lines(doubled.items), ["800g chicken thighs", "600g rice", "1200ml chicken stock", "8 garlic cloves"]);
});

test("the same amount twice adds up, and reads the way the scaler would write it", () => {
  // The composite case is the point: the *number* and the *noun* both have to
  // come out right, which is why the addition runs through the serving scaler
  // rather than rendering a total here.
  assert.deepStrictEqual(S.addQty("3", "2", "garlic cloves"), { qty: "5", name: "garlic cloves" });
  assert.deepStrictEqual(S.addQty("1", "1", "bell pepper"), { qty: "2", name: "bell peppers" });
  assert.deepStrictEqual(S.addQty("400g", "300g", "rice"), { qty: "700g", name: "rice" });
  assert.deepStrictEqual(S.addQty("1/2 tsp", "1/2 tsp", "turmeric"), { qty: "1 tsp", name: "turmeric" });
  assert.deepStrictEqual(S.addQty("2 tbsp", "1 tbsp", "olive oil"), { qty: "3 tbsp", name: "olive oil" });
  assert.deepStrictEqual(S.addQty("4 thick slices", "4 thick slices", "bread"), { qty: "8 thick slices", name: "bread" });
});

test("amounts in different units are never added together", () => {
  // 400g of tomatoes plus 2 tomatoes is not 402 of anything. Two lines that are
  // both true beat one line that is not.
  assert.strictEqual(S.addQty("200g", "2", "tomato"), null);
  assert.strictEqual(S.addQty("600ml", "1.2 L", "chicken stock"), null, "a prefix is still a different unit");

  const twoDishes = S.addItems(buyFor("tomato-basil-pasta"), buyFor("tofu-scramble"));
  const tomatoes = twoDishes.filter(i => i.canonical === "tomato");
  assert.strictEqual(tomatoes.length, 2, "the pasta wants 400g and the scramble wants 1 — two separate needs");
  assert.deepStrictEqual(tomatoes.map(i => i.qty).sort(), ["1", "400g"]);
});

test("an amount that is not a number is carried in the recipe's own words and never summed", () => {
  ["a handful", "to taste", "to serve", "a little", "to drizzle", "a pinch"].forEach(qty => {
    assert.strictEqual(S.addQty(qty, qty, "basil"), null, `"${qty}" is not a purchasable quantity`);
  });
  const pasta = buyFor("tomato-basil-pasta");
  const basil = pasta.find(i => i.canonical === "basil");
  assert.strictEqual(basil.asNeeded, true);
  assert.strictEqual(basil.qty, "a handful", "the recipe's words survive");

  const both = S.addItems(pasta, buyFor("banana-oat-pancakes"));
  const asNeeded = both.filter(i => i.asNeeded).map(i => i.canonical);
  assert.deepStrictEqual(asNeeded.sort(), ["basil", "butter", "honey"], "one line each, never a total");
});

test("what a quantity counts is read the same way the scaler reads it", () => {
  // "4 thick slices" counts slices; the unit slot holds a descriptor, so a naive
  // reading would call two bunches of bread a different kind of thing.
  const slices = SERV.parseQty("4 thick slices");
  assert.strictEqual(S.unitKeyOf(slices), "slice");
  assert.strictEqual(S.itemKey("bread", slices), "bread|slice");
  assert.strictEqual(S.itemKey("garlic", SERV.parseQty("3")), "garlic|", "a bare count counts its name");
  assert.strictEqual(S.itemKey("basil", SERV.parseQty("a handful")), "basil|~asneeded");
});

// ---------------------------------------------------------------------------
// adding a dish to the list, twice, and again later
// ---------------------------------------------------------------------------

test("adding the same recipe twice does not double the shopping", () => {
  // The button says "add what's missing", not "add another one". Pressing it
  // twice is the commonest thing a cook will do with it.
  const once = S.addItems([], buyFor("garlic-chicken-rice"));
  const twice = S.addItems(once, buyFor("garlic-chicken-rice"));
  assert.deepStrictEqual(lines(twice), lines(once));
  assert.strictEqual(twice.length, once.length);
});

test("re-adding a dish does not un-tick a list you have already shopped", () => {
  let list = S.addItems([], buyFor("garlic-chicken-rice"));
  const key = list[0].key;
  list = S.setBought(list, key, true);
  list = S.addItems(list, buyFor("garlic-chicken-rice"));
  assert.strictEqual(list.find(i => i.key === key).bought, true, "nothing changed, so nothing new to buy");
});

test("raising the servings corrects the amount and puts the line back in play", () => {
  // This is the case the running-total design got wrong: 400g + 800g is not the
  // 800g the cook now needs, it is a second lot of chicken.
  let list = S.addItems([], buyFor("garlic-chicken-rice"));
  const key = list[0].key;
  list = S.setBought(list, key, true);
  list = S.addItems(list, S.itemsToBuy(byId("garlic-chicken-rice"), { servings: 6 }).items);
  const chicken = list.find(i => i.key === key);
  assert.strictEqual(chicken.qty, "800g", "the corrected amount, not 1200g");
  assert.strictEqual(chicken.bought, false, "there is more to buy now");
  assert.strictEqual(chicken.dishes, 1, "still one dish asking for it");
});

test("two different dishes add their needs up and say who wants them", () => {
  const list = S.addItems(buyFor("vegetable-stir-fry"), buyFor("hearty-chicken-soup"));
  const carrot = list.find(i => i.canonical === "carrot");
  assert.strictEqual(carrot.qty, "3", "1 from the stir-fry plus 2 from the soup");
  assert.strictEqual(carrot.name, "carrots", "and the noun agrees, because the scaler agreed it");
  assert.strictEqual(`${carrot.qty} ${carrot.name}`, "3 carrots");
  assert.strictEqual(carrot.dishes, 2);
  assert.deepStrictEqual(carrot.forRecipeNames, ["Vegetable Stir Fry", "Hearty Chicken Soup"]);
  assert.strictEqual(carrot.bought, false);
});

test("the list is pure, so the caller can keep the previous one for an undo", () => {
  const input = buyFor("garlic-chicken-rice");
  const snapshot = JSON.stringify(input);
  S.addItems(input, buyFor("hearty-chicken-soup"));
  assert.strictEqual(JSON.stringify(input), snapshot, "addItems must not touch the list it was given");

  const original = byId("garlic-chicken-rice");
  const recipeSnapshot = JSON.stringify(original);
  S.itemsToBuy(original, { servings: 8, have: ["rice"], includeStaples: true });
  assert.strictEqual(JSON.stringify(original), recipeSnapshot, "and must not touch the recipe either");
});

test("ticking off, removing and clearing behave like list operations", () => {
  const list = S.addItems([], buyFor("garlic-chicken-rice"));
  const [first, second] = list;

  assert.strictEqual(S.summary(list).remaining, 4);
  const ticked = S.setBought(list, first.key, true);
  assert.strictEqual(S.summary(ticked).bought, 1);
  assert.strictEqual(S.summary(ticked).remaining, 3);

  assert.strictEqual(S.removeItem(ticked, second.key).length, 3);
  assert.deepStrictEqual(lines(S.clearBought(ticked)), lines(list.slice(1)), "only the un-bought survive");
  assert.deepStrictEqual(S.clearAll(), []);
  assert.strictEqual(S.summary(null).total, 0);
});

test("an ingredient named by the cook is a want, not a measurement", () => {
  // "Add garlic to my shopping list" has no recipe and no amount behind it, so
  // it is labelled as wanted rather than measured — and that label is also what
  // stops it being added to a recipe's numbered need, because four cloves and
  // "garlic" are not the same purchase to add up.
  const manual = S.manualItem("garlic");
  assert.strictEqual(manual.asNeeded, true);
  assert.strictEqual(manual.qty, "", "there is no amount to pretend about");
  assert.strictEqual(manual.canonical, "garlic", "the spoken name resolves through the same alias table");

  const list = S.addItems(S.addItems([], buyFor("garlic-chicken-rice")), [manual]);
  const garlic = list.filter(i => i.canonical === "garlic");
  assert.strictEqual(garlic.length, 2, "the recipe's 4 cloves and the cook's garlic stay two lines");
  assert.strictEqual(garlic.find(i => i.asNeeded).qty, "");
  assert.strictEqual(garlic.find(i => !i.asNeeded).qty, "4");
  assert.ok(S.speak(list).includes("garlic"), "and both are still read out");
});

test("a blank name is refused rather than becoming an unnameable line", () => {
  [null, undefined, "", "   ", 42].forEach(value => {
    const item = S.manualItem(value);
    if (value === 42) assert.strictEqual(item.name, "42", "a number is still a name someone could read out");
    else assert.strictEqual(item, null);
  });
  assert.strictEqual(S.manualItem("Parmesan").canonical, "cheese", "resolved through the alias table");
});

// ---------------------------------------------------------------------------
// the link to the swap panel
// ---------------------------------------------------------------------------

test("the list offers to skip a purchase only when the substitute is already owned", () => {
  const without = buyFor("mushroom-risotto").find(i => i.canonical === "cheese");
  assert.strictEqual(without.skipWith, null, "owning nothing means there is nothing to skip with");

  const owned = S.itemsToBuy(byId("mushroom-risotto"), { have: ["nutritional-yeast"] })
    .items.find(i => i.canonical === "cheese");
  assert.strictEqual(owned.skipWith.name, "nutritional yeast");
  assert.ok(owned.skipWith.note, "the advice carries the note the swap panel would show");
});

test("substitution advice never crosses an allergen, because the engine is fail-closed", () => {
  // Beef and broccoli will take chicken, mushrooms or tofu in place of the beef,
  // and a cook holding all three should be offered chicken — unless the kitchen is
  // vegan, when the same cupboard has to answer with something else. The advice
  // changing with the profile, and never towards the forbidden option, is the
  // fail-closed rule showing through on this surface. Getting it wrong here would
  // send someone to the shop for something they cannot eat.
  const owns = ["chicken", "mushroom", "tofu"];
  const advice = profile => S.itemsToBuy(byId("beef-broccoli"), { have: owns, profile })
    .items.find(i => i.canonical === "beef").skipWith;

  assert.strictEqual(advice(undefined).name, "chicken", "with nothing to avoid, the first choice stands");
  assert.strictEqual(advice({ diets: ["vegan"] }).name, "portobello mushrooms", "a vegan kitchen must not be sent to chicken");
  assert.strictEqual(advice({ allergens: ["soy"] }).name, "chicken", "and a soy allergy rules the tofu out");
});

// ---------------------------------------------------------------------------
// saying it out loud
// ---------------------------------------------------------------------------

test("a list is read aloud with its units expanded, and stops before it becomes a recitation", () => {
  assert.strictEqual(S.speakQty("200g"), "200 grams");
  assert.strictEqual(S.speakQty("600ml"), "600 milliliters");
  assert.strictEqual(S.speakQty("1.2 L"), "1.2 liters");
  assert.strictEqual(S.speakQty("2 tbsp"), "2 tablespoons");
  assert.strictEqual(S.speakQty("1/2 tsp"), "1/2 teaspoon");
  assert.strictEqual(S.speakQty("3"), "3", "a bare count needs no unit invented for it");
  assert.strictEqual(S.speakQty("a handful"), "a handful", "and a vague amount keeps its own words");

  const four = S.speak(buyFor("garlic-chicken-rice"));
  assert.strictEqual(four, "4 things to buy: 400 grams chicken thighs, 300 grams rice, 600 milliliters chicken stock, 4 garlic cloves.");

  const stirFry = buyFor("vegetable-stir-fry");
  const soup = buyFor("hearty-chicken-soup");
  const merged = S.addItems(stirFry, soup);
  assert.ok(merged.length < stirFry.length + soup.length,
    "carrot and garlic are one purchase each, not two, so the list is shorter than the sum");

  const many = S.speak(merged, 2);
  assert.strictEqual(many, `9 things to buy: 1 bell pepper, 3 carrots, and 7 more.`);
  assert.ok(!/12 things/.test(S.speak(merged)), "the count is of lines to buy, not of ingredients listed");
});

test("an empty or finished list says so instead of reading nothing", () => {
  assert.strictEqual(S.speak([]), "Your shopping list is empty.");
  assert.strictEqual(S.speak(null), "Your shopping list is empty.");
  const list = S.addItems([], buyFor("tomato-basil-pasta"));
  assert.strictEqual(S.speak(list.map(i => S.setBought([i], i.key, true)[0])), "Everything on your shopping list is already ticked off.");
});

test("a limit that is not a number still reads the list out", () => {
  const list = S.addItems([], buyFor("garlic-chicken-rice"));
  const expected = S.speak(list);
  // A garbage limit used to slice the list to nothing and recite an empty
  // sentence — the worst kind of bug, because it sounds like a real answer.
  for (const bad of [undefined, null, NaN, "garlic", {}]) {
    assert.strictEqual(S.speak(list, bad), expected, `limit ${String(bad)} still recites every line`);
  }
  assert.ok(expected.includes("chicken thighs"), "and the recursion it falls back to is the real list");
  // A real limit still caps, and still counts what it left out.
  assert.strictEqual(S.speak(list, 1), "4 things to buy: 400 grams chicken thighs, and 3 more.");
});

// ---------------------------------------------------------------------------
// the corpus
// ---------------------------------------------------------------------------

test("every shipped recipe produces a list, and no list contains a staple", () => {
  // Pinned as a table because this is what the panel puts on screen: if a recipe
  // is edited so an ingredient appears, moves or changes its amount, the list a
  // cook walks to the shop with changes, and that edit should say so on purpose.
  const expected = {
    "tomato-basil-pasta": ["200g spaghetti", "400g crushed tomatoes", "3 garlic cloves", "fresh basil leaves=a handful"],
    "vegetable-stir-fry": ["1 bell pepper", "1 carrot", "150g broccoli", "steamed rice=to serve", "2 garlic cloves"],
    "garlic-chicken-rice": ["400g chicken thighs", "300g rice", "600ml chicken stock", "4 garlic cloves"],
    "fluffy-french-toast": ["4 thick slices bread", "2 eggs", "120ml milk", "1 tbsp butter", "maple syrup=to drizzle"],
    "mushroom-risotto": ["250g rice", "250g mushrooms", "1 onion", "2 garlic cloves", "40g grated parmesan"],
    "tofu-scramble": ["300g firm tofu", "2 handfuls spinach", "1 tomato", "2 scallions"],
    "beef-broccoli": ["350g beef", "300g broccoli", "steamed rice=to serve", "2 garlic cloves", "1 small piece ginger"],
    "banana-oat-pancakes": ["2 ripe bananas", "150g rolled oats", "2 eggs", "60ml milk", "butter=a little", "honey=to drizzle"],
    "lemon-garlic-shrimp": ["400g shrimp", "1 lemon", "2 tbsp butter", "4 garlic cloves", "2 scallions", "rice=to serve"],
    "hearty-chicken-soup": ["500g chicken", "1.2 L chicken stock", "2 potatoes", "2 carrots", "1 onion", "2 garlic cloves"],
  };
  RECIPES.forEach(recipe => {
    assert.ok(expected[recipe.id], `${recipe.id} is not in the shopping table — add it, do not skip it`);
    const out = S.itemsToBuy(recipe);
    assert.deepStrictEqual(lines(out.items), expected[recipe.id], `${recipe.id} shopping list changed`);
    assert.ok(out.items.length > 0, `${recipe.id} has nothing to buy, so the button is dead UI`);
    assert.ok(!out.items.some(i => i.staple), `${recipe.id} leaked a pantry staple onto the list`);
  });
  assert.strictEqual(Object.keys(expected).length, RECIPES.length, "the table covers every recipe");
});

test("every line is either a number or honestly labelled as needed — never both", () => {
  RECIPES.forEach(recipe => {
    S.itemsToBuy(recipe).items.forEach(item => {
      const parsed = SERV.parseQty(item.qty);
      assert.strictEqual(item.asNeeded, parsed === null,
        `${recipe.id}: "${item.qty}" is marked asNeeded=${item.asNeeded} but parses to ${parsed ? "a number" : "nothing"}`);
      assert.ok(item.key, `${recipe.id}: every line needs an identity to be tickable`);
      assert.ok(item.name && item.name.trim(), `${recipe.id}: a line with no name cannot be read out`);
    });
  });
});

test("no cross-recipe merge ever mixes two units or invents a number", () => {
  // Merge everything with everything and hold the result to the same promise the
  // single-recipe lists make: every line is still a unit its sources shared.
  const all = RECIPES.reduce((list, recipe) => S.addItems(list, S.itemsToBuy(recipe).items), []);
  assert.ok(all.length > 0);
  const keys = new Set(all.map(i => i.key));
  assert.strictEqual(keys.size, all.length, "two lines with one key means the merge did not merge");

  all.forEach(item => {
    const sources = Object.values(item.sources);
    assert.ok(sources.length >= 1, `${item.name} has no source dish`);
    if (item.asNeeded) {
      assert.strictEqual(item.qty, sources[0].qty, "a vague amount is never rewritten");
      return;
    }
    const units = new Set(sources.map(s => S.unitKeyOf(SERV.parseQty(s.qty))));
    assert.strictEqual(units.size, 1, `${item.name} merged ${[...units].join(" and ")}`);
    assert.notStrictEqual(SERV.parseQty(item.qty), null, `${item.name} lost its number in the merge`);
  });
});

test("merging the whole corpus in any order gives the same amounts", () => {
  // Addition of like amounts has to be order-independent, or the list a cook
  // sees would depend on which dish they opened first.
  const forward = RECIPES.reduce((l, r) => S.addItems(l, S.itemsToBuy(r).items), []);
  const backward = [...RECIPES].reverse().reduce((l, r) => S.addItems(l, S.itemsToBuy(r).items), []);
  const amounts = list => list.map(i => `${i.key}=${i.qty}`).sort();
  assert.deepStrictEqual(amounts(backward), amounts(forward));
});

// ---------------------------------------------------------------------------
// robustness
// ---------------------------------------------------------------------------

test("junk input produces an empty list instead of a crash", () => {
  [null, undefined, 42, "nope", {}, [], { ingredients: "no" }, { ingredients: [null, {}, 7] }].forEach(value => {
    const out = S.itemsToBuy(value);
    assert.deepStrictEqual(out.items, []);
    assert.strictEqual(out.factor, 1);
    assert.deepStrictEqual(out.staples, []);
  });
  assert.deepStrictEqual(S.addItems(null, null), []);
  assert.deepStrictEqual(S.addItems([], [null, undefined, {}, { noKey: true }]), []);
  assert.deepStrictEqual(S.clearBought(null), []);
  assert.strictEqual(S.speakQty(null), "");
});

test("a nonsensical yield falls back to the recipe's own rather than scaling by zero", () => {
  [0, -3, "six", null, undefined, NaN, Infinity].forEach(servings => {
    const out = S.itemsToBuy(byId("garlic-chicken-rice"), { servings });
    assert.strictEqual(out.factor, 1, `servings=${String(servings)} must not scale anything`);
    assert.deepStrictEqual(lines(out.items), lines(buyFor("garlic-chicken-rice")));
  });
});

test("the list hands back its own objects, so a caller cannot poison the next read", () => {
  const first = buyFor("garlic-chicken-rice");
  first[0].qty = "99kg";
  first[0].sources["garlic-chicken-rice"].qty = "99kg";
  assert.strictEqual(buyFor("garlic-chicken-rice")[0].qty, "400g",
    "a mutated line must not survive into the next call");
});
