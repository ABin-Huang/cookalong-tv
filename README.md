# CookAlong TV

Voice-first, **ingredient-aware** interactive cooking companion for **Amazon Fire TV**
with **Alexa+** integration.

CookAlong TV turns your living-room TV into a hands-free cooking companion:
tell it what is in your fridge and it ranks the recipes you can cook, walks you
through the steps, swaps missing ingredients on the fly, and runs smart timers
— controlled by voice or the remote, so you never touch the screen with messy
hands.

Built for the **Build, Ship, Shape: Amazon Developer Hackathon**.

## What's new in 2.0 — the "AI kitchen" layer

- **Smart ingredient matching** — say or tap what you have ("mushrooms, rice,
  onion, garlic"); a weighted scoring engine ranks recipes by fit (main /
  secondary / pantry-staple roles) and explains every score with
  have / swappable / missing tags.
- **Live missing-ingredient swaps** — the swap panel on the cooking screen
  lists what you're missing and every swap that still fits your diet, then
  rewrites the step text on the spot ("40g of grated parmesan" → "40g of
  cheddar cheese"). Every swap has an undo.
- **What you need, before you start** — every recipe opens with its full
  ingredient list and quantities, each row tagged 🍱 pantry staple / ✓ on hand /
  🔄 swap available / ✗ missing, with a "9 of 10 ready" summary on top. Opened
  from a kitchen match the tags come from that match; opened from the grid they
  come from your pantry, so the app never claims something is missing when it
  simply does not know.
- **The timer reads the recipe** — open the step that says "cover and cook on
  low for 18 minutes" and the ⏱ button offers 18:00 and the step card says so;
  steps that say "per side" are doubled. With no time of its own the button
  falls back to a sensible default for the dish.
- **Allergy profile** — mark any of nine common allergens (dairy, egg, gluten,
  shellfish, fish, soy, nuts, peanut, sesame) and those recipes disappear from
  the grid and the kitchen match, with a count of what was hidden and why. The
  swaps obey it too: a dairy-allergic cook is offered nutritional yeast, never
  cheddar. Every recipe also states what it carries, before you commit to it.
- **A Device check you can paste into a bug report** — the app probes what the
  device can actually do (voice in, voice out, wake lock, storage) and prints
  the result, because on a TV browser the honest answer is often "no" and a
  silent no is worse than a stated one.
- **Picks up where you left off** — the step you reached and the swaps you
  applied survive a reload, and the home screen offers to resume them next to
  the timer that is still counting.
- **Cooks for the number you actually have** — set the yield and the whole
  recipe is rewritten for it: quantities scale, countable nouns agree ("1 bell
  pepper" becomes "2 bell peppers", never "2 bell pepper"), fractions stay real
  ("1/3 cup" doubles to "2/3 cup", "1/4 tsp" halves to "1/8 tsp"), and
  uncountables are left alone ("300g rice" never becomes "rices"). Cooking times
  never move: 18 minutes is 18 minutes whether you are feeding two or eight. The
  header switches from per-serving to in-total figures so the number matches what
  is in the pan, and the choice follows you from recipe to recipe.
- **Pantry memory** — mark ingredients as used; the kitchen persists locally
  and future matches exclude them.
- **10 structured recipes** (up from 4), each with role-weighted ingredients,
  quantities and recipe-level substitution overrides.
- **Remote-first navigation** — arrow keys move focus, OK selects, Back
  returns. The whole app is drivable from a Fire TV remote, not just voice.
- **Timers that run at the same time, because cooking does** — the rice simmers
  for 18 minutes while the chicken rests for 5 and the oven counts down from 20.
  Each timer is named after the dish and step it belongs to, so the alert says
  "Rice — time to check your food" instead of the useless "Timer done". Starting
  a second timer no longer cancels the first, pressing "Set timer" twice on one
  step restarts that timer rather than stacking a duplicate, and the badge shows
  the most urgent one with a `+2` for the rest. Wall-clock based (no drift),
  survives a reload or the app being backgrounded, keeps counting while you
  browse other recipes, and ends with a chime plus a full-screen alert. Ask by
  voice — "what timers are running" answers.
- **A cook plan that answers "what goes on first?"** — parallel timers only help
  a cook who already knows which steps have a clock on them, and until now that
  arrived one step at a time behind a Next press. Which is exactly why the
  18-minute braise got discovered with everything else already going. The recipe
  screen now lists every step that names a time, with its own duration and a
  one-press **⏱ Start** on every row, so the long pot can be started from step 1.
  The summary line names the longest single wait and the rows fold away, because
  measured at 1920×1080 an open plan pushes the step card 344px down and off a
  ten-foot screen. `per side` is still doubled, a step naming two times still
  reports the longest, and the durations come from the same parser the ⏱ button
  uses — there is one answer to "what time is this step asking for", not two.
  Scaling the yield leaves every planned duration identical, and the plan's own
  tests hold it to that across all ten recipes.
- **Works offline** — a service worker pre-caches the app shell, so the kitchen
  UI still opens with no network.
- **Honest scoring** — every match can explain itself: which ingredients
  counted on hand, which earned half credit as a swap, and the weighted total
  behind the percentage.
- **Voice that tells you the truth about itself** — spoken guidance is only
  claimed when the device reports an installed voice, and the in-page
  microphone is only offered when the browser can actually listen. Where it
  cannot, the screen becomes the primary channel and says so. The Alexa skill
  mirrors the same engine on AWS Lambda.

## What's inside

| Path | What it is |
|---|---|
| `public/` | Fire TV Web App (HTML/CSS/JS 10-foot UI, PWA + service worker) |
| `skill/` | Alexa Skills Kit skill (Node.js, deployable to AWS Lambda) |
| `src/recipes.js` | Recipe engine: 10 structured recipes, dietary filters, voice-friendly steps |
| `src/ingredients.js` | Ingredient intelligence: normalization, weighted matching, substitutions, allergen-aware profiles, pantry (UMD — shared by browser & skill) |
| `src/timer.js` | Smart timer engine: natural-language durations, a drift-free `Timer`, and a `TimerRack` that runs several at once (step-linked durations, persistence snapshots) |
| `src/capabilities.js` | Device capability detection: can this device speak, listen, hold a wake lock, persist? (UMD) |
| `src/progress.js` | Cooking-progress snapshots so a reload does not lose your place (UMD) |
| `src/servings.js` | Serving scaling: amount arithmetic plus the noun agreement that makes a scaled recipe read as written (UMD) |
| `src/plan.js` | Cook plan: which steps of a recipe name a time, how long the longest wait is, and which step to start first (UMD) |
| `scripts/` | `build-web.js` syncs `src/` into `public/`; `serve.js` is the dev server |
| `test/` | Unit tests for the recipe, ingredient, timer, capability, progress, servings & plan engines, plus two contract tests |

## Quick start (web app)

```bash
npm start          # zero-dependency static server at http://localhost:8080
# or
npm run serve      # requires npx
```

Open http://localhost:8080 in a browser (or load `public/index.html` directly).
Try the **"What's in my kitchen"** panel: add `mushrooms, rice, onion, garlic`,
open the top match, and hit **Cook it** — every missing item is flagged as
swappable or missing on the match card, and the swap panel on the cooking
screen lets you apply the substitution so the step text updates live.

Then tap an allergy chip and watch the same list shrink with a reason attached,
and hit **Device check** in the footer to see what the current browser claims it
can do. If it reports no installed voices, that is not a bug in the app — it is
the app refusing to pretend.

## Editing the engines

`public/ingredients-engine.js`, `public/timer-engine.js`,
`public/capabilities-engine.js`, `public/progress-engine.js`,
`public/servings-engine.js`, `public/plan-engine.js` and
`public/recipes-data.js` are generated from `src/`. Never edit them by hand —
change `src/` and re-sync:

```bash
npm run build:web    # write the public/ artifacts
npm run check:web    # verify they match src/ (also runs before npm test and in CI)
```

## Running tests

```bash
npm install --prefix skill   # once: the skill integration tests need ask-sdk-core
npm test                     # syntax-checks the entry points, verifies src/public sync, then runs 212 tests
```

Four of those tests exist to catch drift rather than logic, because every place
has already been burned by it once:

- `test/skill-contract.test.js` invokes every intent declared in the interaction
  model and fails if any reaches the error handler.
- `test/web-contract.test.js` checks that every element `app.js` looks up is
  declared in `index.html`, that the page loads every engine the script
  consumes, that `plan-engine.js` loads *after* the `timer-engine.js` it reads
  durations through, that the service worker pre-caches them, and that the
  capability guard is actually present rather than the bare API check it
  replaced.

`test/servings.test.js` is the one to read if you want to know how far the
scaling is trusted: rather than spot-checking strings, it runs **every step of
every recipe** through the scaler at ×0.5, ×2 and ×3 and fails if any cooking
time moves, if any amount that should have scaled did not, or if a scaled line
ever contains `NaN`, `undefined` or a zero measure.

`test/plan.test.js` holds the cook plan to two promises that only a sweep can
check: that the plan of every shipped recipe is exactly the steps that name a
time (pinned as a table, so an edit that changes the cook-visible plan has to
say so), and that neither rescaling the yield nor swapping an ingredient ever
moves a single planned duration.

## What a Fire TV actually does

Worth knowing before you record a demo, because both failure modes are
invisible in a desktop browser:

- **Silk exposes `speechSynthesis` and installs no voices.** `speak()` resolves
  successfully and says nothing, so "hands-free spoken guidance" is silently
  dead on the target device. The app therefore treats a non-empty voice list —
  not the API's existence — as the thing that makes speech real, and switches
  to large on-screen text when it is not.
- **Silk has no `SpeechRecognition`.** The in-page microphone cannot work, so
  the button is repurposed to open the Device check instead of failing.
  Voice *input* on a Fire TV belongs to the remote's Alexa button, which is
  what the companion Alexa skill is for.

Both are measured at runtime rather than guessed from the user agent, and both
are reported on the Device check screen with a **Copy report** button so the
environment can be attached to a bug report instead of described from memory.
`test/capabilities.test.js` covers the silent-speech case directly.

## Alexa skill

The skill lives in `skill/`. Deploy `skill/index.js` as an AWS Lambda function
with the `ask-sdk-core` dependency, then import `skill/skill.json` in the Alexa
Developer Console with the interaction model in `skill/models/en-US.json`.

Invocation name: **cook along**

Example utterances:

- "Alexa, open cook along"
- "I have chicken, rice and garlic" → ranked recipe matches
- "what else" → cycle through matches; "cook it" → start the current match
- "cook tomato basil pasta"
- "next step" / "previous step" / "repeat step"
- "I don't have parmesan" → smart substitution advice, and the cooking screen
  comes back with the step text already rewritten
- "without onion" → re-rank excluding an ingredient
- "I am vegan" / "I'm allergic to dairy" → remembered for every match and swap
- "set a timer for 5 minutes", or just "set a timer" → uses the current step's
  own cooking time
- "which step takes longest" → the cook plan in words: how many steps name a
  time, what they add up to, and the one long wait worth putting a timer on
- "what can I make that is vegan"

> **Known limitation:** the skill's timer is acknowledged in speech, but a
> Lambda invocation cannot ring later — nothing fires when it ends, and
> `CancelTimerIntent` only clears the session. A real alert needs the Alexa
> Timers/Reminders API. The Fire TV web app's on-screen timer does ring, with a
> chime and a full-screen alert. This is logged as product friction rather than
> hidden — and it is why "which step takes longest" exists: on the skill the
> useful thing voice can do is tell you where the clock matters before the pan
> is hot, not ring for you afterwards.

### Where the response logic lives

`skill/responses.js` holds every speech/reprompt/APL/session decision with no
ASK dependency, so the whole conversation is unit-testable in plain Node;
`skill/index.js` is only request routing. **Every intent declared in
`models/en-US.json` must have a handler in `index.js`** —
`test/skill-contract.test.js` invokes each declared intent and fails if any of
them reaches the error handler, so the model and the code cannot drift apart
unnoticed.

### 3-minute demo script

1. "I have mushrooms, rice, onion and garlic" → best match at 96%, every
   missing item flagged as swappable. Hit **Why 96%?** to show the weighted
   breakdown behind the number.
2. Tap **dairy** in the allergy row → four recipes leave the grid and the line
   underneath says why. Open the risotto: the banner says it contains dairy and
   points at the swap panel. Clear the allergy.
3. "cook it" → the ingredient list opens with everything tagged (on hand /
   pantry staple / swap available), then step-by-step guidance begins.
4. At the cheese step, the swap panel offers cheddar or nutritional yeast →
   apply it and watch the step text change from "grated parmesan" to
   "cheddar cheese"; undo restores it.
5. Press **🥘 Cook plan · Show steps** and the whole cook is on one screen:
   every step that names a time, its duration, and a **⏱ Start** on each row —
   "5 of 7 steps name a time · longest 18 min (step 6)". Press Start on the
   18-minute row *without leaving step 1*: the pot is going and the step on
   screen never moved. Start the 5-minute rest too — two timers, two pots, and
   the corner badge reads "18:00 +1".
6. Walk to the step that says "stirring often, for about 18 minutes" — the ⏱
   button offers 18:00 because the timer read the step. Let the short one run out
   and the alert names it rather than saying "Timer done".
7. Press ＋ on **Cooking for** until it reads 6 — the whole recipe rewrites
   itself for the bigger pot: "1 onion" becomes "3 onions", "250g rice" becomes
   "750g rice", and the step prose scales in place, cook plan rows and all.
   Point out what does *not* move: "stirring often, for about 18 minutes" is
   still 18 minutes, every duration in the cook plan is identical, and the header
   now quotes in-total calories because that is what is in the pan.
8. Reload the page. Both timers come back (paused, with the time they had left)
   *and* the home screen offers "You were on step 6 of 7" → **Resume cooking**
   puts you back on that step with the swap still applied.
9. Open **Device check** → the probes for this device, and **Copy report** for
   a bug report anyone can paste.
10. Drive the whole thing with the remote: arrows move, OK selects, Back
    returns. Turn the network off and reload — it still opens.
11. Close on "hands never touched the screen".

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the system design and
[docs/DEV_SETUP.md](docs/DEV_SETUP.md) for the development environment.

## License

MIT — see [LICENSE](LICENSE).
