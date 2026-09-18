# CookAlong TV — Architecture

## Overview

CookAlong TV is a two-surface voice-first cooking product:

1. **Fire TV Web App** (client) — a 10-foot UI rendered on the TV, showing the
   recipe grid, step-by-step view and an on-screen smart timer. Optimized for
   high contrast, large type and remote D-pad navigation.
2. **Alexa skill** (voice) — an Alexa Skills Kit custom skill that drives the
   same recipe engine by voice: start a recipe, advance steps, set timers and
   filter by diet.

Both surfaces share the core engines in `src/` (recipes + timer), which keeps
behavior consistent and easy to test.

```
┌────────────────────┐      ┌──────────────────────────────┐
│  Fire TV Web App   │      │  Alexa skill (ASK SDK)       │
│  public/*          │      │  skill/index.js              │
└────────┬───────────┘      └──────────────┬───────────────┘
         │  recipes.json / timer state     │  intents
         ▼                                 ▼
┌─────────────────────────────────────────────────────────┐
│  Core engines (UMD: CommonJS in Node, window.* in the app)│
│  src/recipes.js      — recipes, dietary filters, steps   │
│  src/ingredients.js  — matching, swaps, allergen profiles│
│  src/timer.js        — duration parsing, timers, and a rack│
│  src/capabilities.js — what this device can actually do  │
│  src/progress.js     — resume-where-you-left-off snapshots│
│  src/servings.js     — rescaling a recipe to a new yield  │
│  src/plan.js         — which steps name a time, and which │
│                        one to start first                 │
│  src/shopping.js     — what to buy: the recipe minus the  │
│                        staples, the pantry and the swaps  │
└─────────────────────────────────────────────────────────┘
```

Every engine is written once and consumed by three callers: the Fire TV web
app, the Alexa skill on Lambda, and the Node test suite. That is why the
engines are UMD rather than plain modules — a swap offered on the TV and a swap
offered by Alexa come from the same function, so they cannot disagree.

## Components

### Fire TV Web App (`public/`)

- `index.html` — home (recipe grid, diet chips, allergy chips, resume card,
  kitchen panel) and recipe view (servings stepper, ingredient list, cook plan,
  step card, timer hint), plus the global timer list, the global shopping list and
  the Device check dialog. Timers and the shopping list both live outside the two
  views because neither belongs to one recipe: you set a timer so you could walk
  away, and you build a shopping list across whatever you plan to cook.
- `app.js` — rendering, filtering, step navigation, live swaps, yield scaling,
  the cook plan, the shopping list, the timer rack, progress persistence,
  capability probing, and D-pad focus handling (all four arrows, plus Back).

The chosen yield is stored once for the whole kitchen rather than per recipe:
how many people you are cooking for is a property of the evening, not of the
dish, so it follows you from recipe to recipe and says so in the header when it
differs from the written yield.
- `styles.css` — 10-foot UI theme (large type, high contrast, focus states).
  `body.screen-first` enlarges step text on devices that cannot speak.
- `manifest.json` / `icon.svg` — PWA manifest for Fire TV Web App packaging.

The web app runs standalone; in the full product it is hosted on AWS (static
hosting, e.g. S3 + CloudFront). It deliberately shares no session state with the
skill: both call the same engines, so both give the same answers, which is a
claim the code can back up without a device-linking backend.

### Alexa skill (`skill/`)

- `index.js` — request routing only; every handler delegates to `responses.js`.
  Routes the **twenty-three** intents declared in the interaction model —
  StartCooking, WhatDoIHave, NextMatch, Substitute, ExcludeIngredient, NextStep,
  PreviousStep, RepeatStep, CookPlan, ShoppingList, AddToShoppingList,
  ClearShoppingList, SetTimer, CancelTimer, DietFilter, SetProfile,
  ClearProfile, plus the six `AMAZON.*` built-ins — and adds LaunchRequest and
  SessionEndedRequest.
- `responses.js` — every speech/reprompt/APL/session decision, with no ASK
  dependency, so the whole conversation is unit-testable in plain Node.
- `skill.json` — skill manifest for the Alexa Developer Console.
- `models/en-US.json` — interaction model (invocation name **cook along**).

### Core engines (`src/`)

- `recipes.js` — in-memory recipe store, `listRecipes(diet)`, `getRecipe(id)`,
  `formatStep(recipe, n)` producing voice-friendly step text.
- `ingredients.js` — canonical ingredient catalogue and aliases, weighted
  matching (`topMatches`, `matchRecipesWithExclusions`), substitution chains,
  allergen-aware profiles (`COMMON_ALLERGENS`, `recipeAllergens`,
  `recipeMatchesProfile`) and pantry memory. Substitution selection is
  fail-closed: an option that is not *proven* compatible with the cook's diets
  and allergens is never offered. It also owns the two facts that turn a ranking
  into an answer — `isReadyNow` / `readyNow` (the strict reading: nothing missing
  at all) and `suggest` (the cookable head of the ranking) — plus the single
  `SUGGEST_FLOOR` the two surfaces share. See
  [One decision, not a ranked list](#one-decision-not-a-ranked-list).
- `timer.js` — `parseDuration("1 hour 30 minutes") -> 5400`, a stateful `Timer`
  class (start / pause / resume / stop, `format()` MM:SS, `speak()`), and
  `stepDurationSeconds(stepText)` which reads a step's own cooking time so the
  timer can follow the recipe instead of a fixed default. `TimerRack` holds
  several timers at once — see below.

### Cooking is parallel, so timers are too

The rice simmers for 18 minutes while the chicken rests for 5 and the oven
counts down from 20. A single timer forces the cook to choose which thing to
forget, so `TimerRack` keeps them all, each named, each finishing on its own
schedule.

Three decisions make a rack usable rather than just a list:

- **Naming is the feature.** "Timer done" is useless when three are running. Every
  timer carries the dish and step it belongs to, so the alert says "Rice — time
  to check your food". Ask by voice — "what timers are running" answers.
- **Asking twice restarts, it does not duplicate.** Pressing "Set timer" twice on
  one step wants one timer, restarted, not two racing each other. The rack
  matches on label and replaces; the button relabels itself to "Restart timer".
- **Redrawing must not steal focus.** A rack ticks every second, so the list is
  *reconciled* — rows and buttons are updated in place, never rebuilt — or the
  remote's focus would jump to nowhere once a second while a cook is reaching
  for Pause.

Finished timers stay visible until dismissed, because "which pot rang?" is a
question the screen should answer. A rack restored from storage comes back
paused, timed from its recorded deadline: the minutes the app spent closed are
accounted for, not handed back.
- `capabilities.js` — runtime probes for speech output, speech input, wake lock
  and storage, plus `summarize()` collapsing them into "is voice a real channel
  or is the screen the only one?" and `formatReport()` for bug reports.
- `progress.js` — `serialize`/`deserialize` for the cooking position (recipe,
  step, applied swaps), tolerant of junk because it runs in the boot path.
- `servings.js` — rescaling a recipe to a different yield. `scaleIngredients`
  handles the list, `scaleStepText` rewrites amounts inside step prose,
  `totalNutrition` multiplies the per-serving figures out, and `factorFor` /
  `clampServings` own the yields a cook can pick.
- `plan.js` — the cook plan: `timedSteps(steps)` returns every step that names a
  duration with the index it came from, `longest(steps)` picks the single wait
  worth pointing at, and `summary(steps)` counts and sums them. It reads
  durations *through* `timer.js` rather than re-implementing the parser, so the
  plan and the ⏱ button cannot disagree; `test/web-contract.test.js` holds
  `index.html` to loading `plan-engine.js` after `timer-engine.js` for that
  reason.
- `shopping.js` — what to buy. `itemsToBuy(recipe, {servings, have, profile})`
  returns the lines worth a trip to the shop, `addItems` folds a second dish's
  needs into the list already built, and `speak` turns the whole thing into one
  sentence with the units expanded ("400 grams"), because a shopping list gets
  read aloud more often than it gets read. It resolves `servings.js` and
  `ingredients.js` at load time, so `test/web-contract.test.js` holds the script
  order for it too.

### Scaling is a grammar problem, not just arithmetic

Reading "1 bell pepper" at four servings is arithmetic; writing it back as
"2 bell peppers" rather than "2 bell pepper" is grammar, and that difference is
what makes a scaled recipe look written instead of find-and-replaced. Three
rules carry it:

1. **Countability comes from the quantity, not the name.** "1 small piece of
   ginger" counts *pieces* — the ginger itself is uncountable. So the scaler
   agrees whichever word the amount actually counts.
2. **Only bare counts agree.** A measurement never pluralises its noun, which is
   exactly what keeps "300g rice" and "2 tbsp oil" away from a pluraliser.
   Word-units do agree ("1 cup" → "2 cups"); symbols never do ("500 g" stays
   "500 g", "2 tbsp" never becomes "2 tbsps").
3. **Step prose is rewritten in a single pass** matching either a unit or a noun
   this recipe actually names. Two passes would scale "2 garlic cloves" twice:
   once as a unit and once as a noun.

Fractions are preserved exactly when they can be — "1/3 cup" doubles to "2/3
cup" and "1/4 tsp" halves to "1/8 tsp", because a recipe that answers "0.67 cup"
is a recipe nobody trusts. When nothing fits, the line is left alone rather than
rounded into a different dish.

Cooking times are never touched. `test/servings.test.js` runs every step of
every recipe through the scaler at ×0.5, ×2 and ×3 and fails if any time
changes, if any amount that should have scaled did not, or if a scaled line
contains `NaN`, `undefined` or a zero measure.

## A plan before the step, not one at a time

A timer rack makes parallel cooking possible; it does not make it obvious. The
knowledge that step 6 wants 18 minutes used to arrive only when the cook walked
to step 6 — by which point the rice was already in the pan and the pot that
needed the head start had lost it. `plan.js` moves that knowledge to the top of
the recipe screen: every step that names a time, how long it wants, and which
step is the longest single wait.

Three rules keep it honest:

- **One parser, not two.** The plan asks `timer.js` for every duration. A second
  reading of "what time is this step asking for" would eventually disagree with
  the button, and the one that disagreed would be the one on screen.
- **It reports, it does not interpret.** A step naming two times reports the
  longest — the timer engine's documented behaviour. The sum of the named times
  is called `namedSeconds` and is never presented as how long the dish takes:
  chopping and plating are not timed, and two steps can run at once.
- **Only the steps that name a time appear.** A plan row that guessed would be
  worse than no row, because the cook would start a timer the recipe never asked
  for.

The rows start any step's timer without navigating there, which is the point:
two pots going before the cook has left step 1, with focus left where the cook
put it.

The panel opens on a summary line and folds its rows away. Measured at
1920×1080, five open rows push the step card 344px down the page — from 945 to
1289, past the bottom of the screen — and the step card is the thing the cook is
actually reading. The summary alone carries the insight ("5 of 7 steps name a
time · longest 18 min (step 6)"), so it stays; the rows are a setup tool, so
they wait to be asked for.

Both surfaces answer the same question from the same engine: "what's the cook
plan" on the TV, "which step takes longest" on the skill. That matters more on
the skill than on the TV, because a Lambda invocation cannot ring later — a
spoken timer there is a note to self at best, so knowing which step is the long
one before the pan is hot is most of what voice can honestly deliver.

## A shopping list is not an ingredient list

The ingredient list and the shopping list look alike and are computed almost
oppositely, which is why they are two engines rather than one function with a
flag. Turning one into the other means subtracting three things and surviving one
that cannot be subtracted at all.

**The staples go first.** A recipe marks salt, pepper and cooking oil as on hand,
and the matcher already scores them as on hand ("pantry staples are assumed on
hand"). A list that told you to buy salt for a dish whose own card said you had
everything would contradict the score that sent you there, so `pantry: true`
ingredients are dropped — unless the cook asks for them by saying they are
shopping for an empty kitchen.

**Then the pantry.** What the cook has saved, plus the ingredient set of the match
they came in from, is subtracted. That set is also what makes the third
subtraction possible:

**Then the swaps they already own.** For each missing ingredient the engine asks
`ingredients.js` for the compatible substitutions and checks whether the cook owns
one. This is the link between the two halves of the app: the swap panel says a
missing ingredient *can* be replaced, and this says whether it already has been.
"Buy parmesan" and "skip the parmesan, you own nutritional yeast" are different
errands. The check goes through the same fail-closed option list as the panel, so
the advice can never cross an allergen — there is a test for exactly that.

**And what cannot be subtracted is the amount.** The corpus is full of amounts
that are not numbers: "to taste", "to serve", "a handful", "to drizzle". Adding
those up would produce a figure nobody could shop from, so they are carried
through in the recipe's own words, labelled "as needed", and never summed. The
same rule governs units: 400g of tomatoes plus 2 tomatoes stays two lines, because
402 of nothing is not a shopping list. Merging happens only when the unit matches,
and the test sweeps all ten recipes to hold that.

The one addition that is real is a scaling. `addQty("3 cloves", "2 cloves")` grows
the first amount by `(3 + 2) / 3` and hands it to `servings.js`, so a merged line
renders through the same rounding and the same noun agreement as a recipe scaled
to a new yield — "5 garlic cloves", not "5 garlic clove". That is why
`headInQuantity` is exported from `servings.js`: the shopping list has to answer
"what does this amount count?" with the same answer the scaler does.

Adding a dish is therefore idempotent by construction rather than by a
de-duplication pass. Each line stores what each dish asks for rather than a
running total, and re-derives its own amount from those sources. Press "add what's
missing" twice and nothing doubles; turn the servings up and press it again and
the amount is *corrected* rather than piled on, and the line goes back to un-bought
because there is now more to buy. A running total cannot do either — it was the
first version of this engine, and the test that caught it is still there.

Both surfaces call the same engine with the same inputs, so the list the skill
reads out cannot disagree with the list the TV draws. On the skill, the list lives
in session attributes and lasts the conversation — an honest limit, and the same
one the spoken timer has. When the skill is asked what is missing and has not been
told what is in the kitchen, it asks instead of assuming: a list built on an
invented kitchen sends someone out to buy what they already own.

## One decision, not a ranked list

The matcher has always returned a good ranking, and a ranking is not an answer.
Twenty-something scored cards hand the deciding back to the cook, which is the
one thing they asked the app to do. So the kitchen panel answers with a single
dish — *Tonight, cook this* — and folds everything else away. The interesting
part is not the card; it is the three rules that keep the card honest.

**A decision is a dish you can cook.** The first version promoted the top-ranked
match, which meant an empty kitchen got an announcement: *Tonight, cook Lemon
Garlic Shrimp — 41%*, needing three trips to the shop. A decision is therefore
`missingHard.length === 0` **and** `score >= SUGGEST_FLOOR`, and the test sweeps
real kitchens to hold it to that. Where the ranking can be generous, the
decision cannot, which is also why `SUGGEST_FLOOR` lives in the engine: the web
app used to carry 25 and the skill 40, and two surfaces disagreeing about whether
there is an answer at all is worse than either number being wrong.

**It is the head of the ranking, never a second opinion.** `suggest(matches)`
returns `matches` filtered, not re-scored, so the dish the banner names is by
construction the dish the list beneath it contains. Everything on both surfaces
reads from that one object — the web banner, its folds, the skill's spoken lead
and its APL list. A second scoring function is how the TV and the Echo end up
disagreeing about dinner, and there is no test that can catch that after the
fact. `'Another one'` walks *down* the same ranking rather than re-rolling, so
the runner-up is stable, and the avoided ids persist per kitchen signature — the
dish you moved past does not come back after a reload.

**Zero shopping is a strict claim, so it gets its own word.** `isReadyNow` means
nothing is missing at all — not even something with a substitution. That reading
is deliberately narrow, because a swap is still a decision to make and usually a
thing to buy, so a swap-only dish is described as a swap and never as *ready*.
In a ten-recipe corpus the strict set is empty for most real kitchens, which is
the honest answer to "what can I make without going shopping" and is why the
skill says *nothing is fully stocked, but X is one swap away* instead of quietly
promoting X. `isReadyNow` is also fail-closed: absent bookkeeping is not "you
have everything", because that is the one claim that must never be made by
default.

Two failures here were layout, not logic, and both are now asserted. The kitchen
section originally sat *below* the recipe grid, so the decision rendered roughly
1200px down a 1080p page — you scrolled past ten recipes to read the single line
the feature exists to say. Moving it up after the diet and allergy chips (which
scope the decision, so they are read first) fixed the order, and a markup-order
test keeps it fixed. The second was smaller: on a 1280×720 Fire TV viewport the
preamble of hint, chips and pantry ran to ~705px, so the card began below the
fold and a 720p cook saw none of it. The hint and the quick chips are aids for
*asking* the question, so once there is an answer they hide — decided by whether
the input still matches the kitchen last answered, not by focus, so pressing
Enter to re-ask the same kitchen does not push the answer back off the screen.
That is worth ~145px, enough to put the ribbon, the dish and the cost badge on
the first screen of a 720p TV.

## AWS deployment (hackathon target)

- Alexa skill backend: **AWS Lambda** (Node.js 18) + ASK SDK; role with
  CloudWatch Logs. The skill can call out to the recipe engine directly
  (bundled) — no external DB needed for the MVP.
- Web app hosting: S3 static website + CloudFront (optional for the demo),
  with the same Lambda APIs available for shared state.
- Alexa+ voice control routes through the same skill backend.

## Data flow example

User: "Alexa, cook tomato basil pasta"
1. Skill resolves `StartCookingIntent` with slot `recipe = tomato basil pasta`.
2. `getRecipe(id)` loads the recipe; session state stores `{ recipeId, step }`.
3. Skill speaks "Step 1 of 7: Boil salted water…".
4. User: "next step" → `NextStepIntent` increments step and speaks it.
5. User: "set a timer for 8 minutes" → `parseDuration` → `Timer(480).start()`
   → "Timer set for 8 minutes."
6. User: "which step takes longest" → `CookPlanIntent` → `plan.js` over the same
   swap-rewritten steps the step flow uses → "The longest single wait is step 6,
   18 minutes."
7. User: "I have garlic and spaghetti" → `WhatDoIHaveIntent` →
   `ingredients.js` scores every recipe; the owned set is stored on the session.
   (Naming tomatoes too is also a valid kitchen — it just leaves less to buy,
   which is the point: the list answers to what you actually have.)
8. User: "add what's missing" → `AddToShoppingListIntent` → `shopping.js` over
   that same session state, minus the recipe's pantry staples → "Added 2 items
   for Tomato Basil Pasta. 2 things to buy: 400 grams crushed tomatoes, fresh
   basil leaves, a handful."
9. User: "read my shopping list" → `ShoppingListIntent` → the same
   `shopping.js` list, read aloud — "2 things to buy: 400 grams crushed
   tomatoes, fresh basil leaves, a handful." Asking again does not buy twice:
   re-adding a dish corrects the amount rather than doubling it.

Note the amounts in 8 and 9: `400 grams` came from the recipe scaled by the
servings, and `a handful` is kept in the recipe's own words because it is not a
number. The list never sums across units and never invents a total for an
amount nobody could measure.

The Fire TV app mirrors this experience visually with the same engine, and step 8
is literally the same call: the panel's **🛒 Add what's missing** button passes the
same recipe, the same servings and the same owned set to the same function.

## Device capability: measured, not assumed

The app's headline feature is spoken, hands-free guidance, and the target device
is the one place that feature is least reliable. Amazon Silk exposes
`speechSynthesis` and installs no voices, so `speak()` resolves successfully and
produces silence — there is no error to catch. Silk also has no
`SpeechRecognition`, so an in-page microphone button can only ever fail.

`capabilities.js` therefore treats the *voice list* as the evidence that speech
is real, not the API's existence, and `app.js` routes its UI off the resulting
verdict:

| Probe result | What the app does |
|---|---|
| voices > 0 | spoken guidance on; mic button offered if `SpeechRecognition` exists |
| voices == 0 (a Fire TV) | `body.screen-first` (larger step text), header states the limitation, mic button repurposed to open Device check |
| no `speechSynthesis` | same as above, and the Device check says so |

This is deliberately not user-agent sniffing: the same Silk build behaves
differently across device generations, and a string is a guess where a
measurement is available. `looksLikeTv()` exists only to annotate the report.

The probes are also the product-feedback mechanism. **Copy report** produces a
paste-ready block (user agent, voice count, each probe's status, the resulting
channel) generated on the misbehaving device, so nobody has to describe their
environment from memory.

## Guards against drift

Two contract tests exist because the same class of bug shipped twice:

- `test/skill-contract.test.js` — the interaction model declared eighteen
  intents while seven had no Lambda handler, so "what do I have?" answered
  "Sorry, something went wrong." The test now invokes every declared intent
  against the real handler and fails if any reaches the error path.
- `test/web-contract.test.js` — a renamed element id, a script tag left out of
  `index.html`, a load order that puts `plan-engine.js` before the
  `timer-engine.js` it resolves at load time (or `shopping-engine.js` before the
  `servings-engine.js` and `ingredients-engine.js` it does the same with), an
  engine missing from the service-worker shell, a capability guard regressing
  to a bare API check, or the kitchen section drifting back below the recipe grid
  all fail here rather than at runtime. No unit test loads
  `app.js`, which is exactly how a redeclared identifier broke the whole web app
  while 71 tests stayed green.

Both are cheap, and both encode a specific incident rather than a general
principle. `npm run check:syntax` is the floor beneath them.
