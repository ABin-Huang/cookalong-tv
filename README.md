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
- **A shopping list that knows what you already own** — a recipe's ingredient
  list is not a shopping list. It includes the salt sitting in your cupboard, it
  is written for the recipe's own yield rather than the pot in front of you, and
  two dishes that both want garlic want one amount of garlic between them. Press
  **🛒 Add what's missing** on a recipe, or on any card in the kitchen panel, and
  you get the purchase rather than the ingredient list: the staples the recipe
  assumes you have are left off, whatever is in your pantry is left off, the
  amounts follow the servings stepper, and a second dish adds to the first
  instead of starting again. Press it twice and nothing doubles. Amounts are only
  ever added up when the unit matches — 400g of tomatoes plus 2 tomatoes stays
  two lines, because 402 of nothing is not a shopping list — and an amount that
  is not a number is labelled "as needed" instead of being given an invented
  total. Every line also names the swap you already own ("or use your olive
  oil"), so a missing ingredient can be skipped rather than bought. The list is
  global state like the timers, and persists across reloads.
- **One decision, not a list of options** — "what can I cook?" is not a browsing
  question, and a grid of twenty-something cards makes the cook do the deciding.
  The kitchen panel now answers with a single dish — *Tonight, cook this* — and
  folds everything else behind one line: **Also ready right now**, and **Needs
  shopping**. The answer is the head of the same ranking the list is drawn from,
  so the banner and the list cannot disagree, and it is only ever a dish with no
  hard miss — an empty kitchen is told the truth rather than handed a 41%
  "best match" needing three trips to the shop. **Another one** walks down that
  ranking instead of re-rolling, so the runner-up is the same runner-up every
  time, and the choice sticks across a reload. By voice, "what can I make
  without going shopping" answers the zero-shopping question directly — the
  strict reading (nothing missing at all, not even something swappable) when it
  can, and "nothing is fully stocked, but X is one swap away" when it cannot,
  because a swap is still a decision and usually a purchase. Two layout failures
  are worth recording: the decision first rendered *below* the recipe grid —
  ~1200px down a 1080p screen and entirely off a 720p one — so the markup order
  is now asserted by a test; and the aids that asked the question (the hint, the
  quick chips) hide once there is an answer, which is what lifted the decision
  onto the first screen of a 1280×720 Fire TV.
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
- **A conversation you can see, in a top bar that stops lying** — pressing the
  microphone used to print "Listening… speak a command" and leave it there
  forever, because a browser can expose `SpeechRecognition`, accept `start()`,
  and then emit *nothing at all*: no start, no result, no error. That is what
  Chromium does when its speech service is unreachable, and it was measured,
  not assumed — 3.5 seconds of driving a live recognition produced zero events.
  The top bar is now a real state machine (idle → listening → thinking →
  answered), the dot is a state light rather than a permanently pulsing green
  lie, five bars move only while the microphone is genuinely open, and the
  cook's own words appear on screen while they are still being said. Every way
  a listen can end now ends in words: a result, a named error in the cook's
  language ("this browser could not reach its speech service"), or a timeout.
  There is no path left that leaves the screen claiming to listen — including
  the timeout paths themselves, which clear the session rather than trusting
  the `end` event to arrive.
- **The answer is on screen even when the voice is not** — every reply goes
  through one funnel that writes the top bar, the transcript and the voice
  together. Before, a reply was handed to `speak()` and on a Fire TV — which
  has the API and no installed voice — that is a deliberate no-op, so the
  answer to a spoken command was thrown away on the exact device the app is
  built for.
- **One table of what you can say, not three that disagree** — the commands
  used to be taught in the cheatsheet markup, matched by a hand-written
  if/else chain, and hinted at in the top bar. They had already drifted, in
  both directions: the cheatsheet offered *"I'm allergic to dairy"* and no
  branch in the chain answered it, so the one list a new cook is handed
  contained a phrase that did nothing; *"add to my shopping list"* was claimed
  by the read-the-list rule sitting above it, so adding read the list back; and
  *"I have a timer running"* was claimed by the kitchen matcher. All three now
  live in `src/voice-commands.js`, and a test feeds every entry its own
  examples, so a phrase the app teaches is a phrase the app answers by
  construction. Press **💬** in the top bar for the full transcript of what you
  said and what was answered — it persists like the shopping list does — and
  say *"what can I say"* to have the list read out.
- **A spoken list is a list** — a recogniser hands back one sentence with
  nothing in it to split on, and the parser used to answer it with its first
  word: saying "chicken beef rice pasta tomato onion garlic carrot and potato"
  matched **one** ingredient. It now walks the words and takes the longest
  alias at each position, so "chicken thighs" and "extra firm tofu" stay whole
  while "chicken beef" reads as two — and a run of Chinese, which has neither
  spaces nor commas, is scanned the same way. Saying that list now reaches
  *Tonight, cook Garlic Chicken Rice*, where before it could reach nothing.
- **It listens in the language you speak** — a recognition session takes exactly
  one language, so the microphone used to be opened in English no matter what was
  said into it. A Chinese-speaking cook was therefore not *partly* understood,
  they were not understood at all, and every phrase the screen taught them was a
  phrase that could not work. The microphone now opens in the browser's own
  language, the command table answers in both, and **💬 → 🎙** switches between
  them — taking the taught list with it, because teaching English phrases to a
  Chinese microphone is how a working feature looks broken. Every command carries
  its Chinese phrase, its Chinese description, and Chinese examples that are
  tested the same way the English ones are.
- **The microphone is closed before the app speaks** — the app used to give up on
  a microphone that never opened by forgetting the recogniser rather than closing
  it. The recogniser kept running, kept returning results, and each result was
  answered *out loud* — into the microphone that was still open. It heard its own
  answer, treated it as a command, and answered again: in a 14-second
  reproduction it spoke **65 times** and was still going. Both give-up paths now
  close the microphone, a finished session refuses further results, and `speak()`
  closes the microphone before it says anything — so no future call path can
  reach the same loop.

## What's new in 2.1 — the hands-free / agent layer

- **The microphone comes back by itself** — every voice app until now needed a
  press per question, which is a design that assumes the cook has a free hand.
  They do not; that is the entire problem. **🙌 Hands-free** re-opens the
  microphone after every answer, so a whole dish runs with no button, no remote,
  no touch. The honest part is what it took: the re-arm wants to know *when the
  app stopped talking*, and the obvious signal is a lie. A recorded probe of this
  browser's `speechSynthesis` shows `onstart` firing, `onend` **never** firing,
  and `speaking` stuck `true` forever — so a mode hung on `onend` would silently
  stop listening and never say why. `onend` is therefore a fast path, not the only
  path: the re-arm is also bounded by what the sentence costs to read (≈3 units a
  second, counted by character for Chinese, because it has no spaces to count) and
  re-checks the flag itself. Past that bound it stops believing the flag and hands
  the turn back. A word or two read early is a nuisance; never listening again is
  a broken app. On a Fire TV, which has no installed voice at all, there was never
  going to be an utterance to wait for and it re-opens immediately. And a mode
  that re-opens a microphone unconditionally will, on a device whose microphone
  never really opens, fail → apologise → re-open → fail for as long as the app is
  on: two consecutive silent listens switch it off and say so. The browser harness
  asserts both halves — the re-open with **no second press**, and the shutdown
  after exactly two silent opens.
- **One request, a finished job** (`src/agent.js`) — the app could already rank
  recipes, plan a cook and build a shopping list; what it could not do was any of
  that without the cook driving. Say **"sort out dinner"** and a conductor
  composes all three engines in a single turn: here is the dish, here is what to
  buy, here is that the longest wait is 18 minutes on step 6, and here is the one
  question it needs answered. The load-bearing part is that `compose()` **has no
  side effects at all** — it returns a plan, and the app only executes it after
  the cook says yes. Opening a recipe is free (Back undoes it); editing the global
  shopping list is not, so the agent proposes and waits. That is the difference
  between an agent you can put in a kitchen and one you have to supervise.
- **"Use up my kitchen" is a different question from "sort out dinner"** — they
  look like the same request and they are not. "Sort out dinner" wants the best
  decision; "use up what's in my kitchen" wants a dish that needs **zero
  shopping**, which is a different objective and often has no answer. When nothing
  clears that bar the agent says so and names the dish that is *one swap away* —
  it does not quietly promote it to "ready" and send you to the shop you just
  asked to avoid. Two jobs, two refusals, and a test asserting the two refusal
  wordings are never conflated, because the failure mode is an app that sounds
  helpful while answering the wrong question.
- **It remembers where you were** (`skill/persistence.js`) — an Alexa session
  ends the moment the conversation pauses, and cooking is nothing but pauses.
  Check the oven, come back, say **"keep cooking"**, and you are on step 3 of 7
  with your swaps still applied. Six facts cross the gap and nothing else: the
  diet, the allergies, what is in the kitchen, and the dish/step/swaps you were
  on. The exchange tail — `matchIds`, `awaitingCook` — deliberately does not, or
  "cook it" tomorrow would start a dish nobody just discussed. Two design
  decisions carry the weight: an empty session **writes nothing**, so a cook who
  opens the skill and says nothing cannot erase the profile the last session
  saved; and every persistence failure is logged and swallowed, because losing
  memory degrades the skill while throwing on every request would kill it.
  Opt-in via `DYNAMODB_TABLE`; without it the skill is session-only and unchanged.
- **A command table that cannot advertise a phrase it cannot answer** — voice
  commands are data, not `if` statements. One table generates the on-screen
  cheatsheet, the 💬 help panel and the utterance matcher, so the three cannot
  drift. The conductor's jobs are generated from its own goal list and injected
  **above** the kitchen matcher, because *"use up what's in my kitchen"* contains
  *"what's in my kitchen"* — ordering is load-bearing, so a test asserts it.

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
| `src/voice-commands.js` | The one table of what can be said to this screen: the phrase the app teaches, the rule that recognises it, and where it works (UMD) |
| `src/shopping.js` | Shopping list: what a recipe still needs bought, scaled to the yield, minus the staples and the pantry, with the amounts added up only when the units match (UMD) |
| `src/agent.js` | The conductor: composes the match, the plan and the shopping list into one job and one question, with no side effects until the cook says yes (UMD) |
| `skill/persistence.js` | What crosses the gap between two sessions, and what deliberately does not |
| `scripts/` | `build-web.js` syncs `src/` into `public/`; `serve.js` is the dev server; `verify-browser.js` drives a real Chromium at TV resolution |
| `test/` | Unit tests for the recipe, ingredient, timer, capability, progress, servings, plan, shopping, agent & voice-command engines, plus three contract tests |
| `docs/DEVPOST_SUBMISSION.md` | Track declaration, the submission story, and the demo video script |

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
`public/servings-engine.js`, `public/plan-engine.js`,
`public/shopping-engine.js` and
`public/recipes-data.js` are generated from `src/`. Never edit them by hand —
change `src/` and re-sync:

```bash
npm run build:web    # write the public/ artifacts
npm run check:web    # verify they match src/ (also runs before npm test and in CI)
```

## Running tests

```bash
npm install --prefix skill   # once: the skill integration tests need ask-sdk-core
npm test                     # syntax-checks the entry points, verifies src/public sync, then runs 289 tests
```

Two of those tests exist to catch drift rather than logic, because both places
have already been burned by it once:

- `test/skill-contract.test.js` invokes every intent declared in the interaction
  model and fails if any reaches the error handler.
- `test/web-contract.test.js` checks that every element `app.js` looks up is
  declared in `index.html`, that the page loads every engine the script
  consumes, that `plan-engine.js` loads *after* the `timer-engine.js` it reads
  durations through and that `shopping-engine.js` loads *after* both engines it
  resolves at load time, that the service worker pre-caches them, that the
  capability guard is actually present rather than the bare API check it
  replaced, and that the list of commands the app teaches is *generated* from
  the table rather than typed into the markup — the drift that put an
  unimplemented phrase in front of every new cook.

`test/voice-commands.test.js` holds the command table to its own promise: every
phrase the app teaches is fed back through the matcher and must reach the
command that taught it, on the screen that command is scoped to and nowhere
else. The ordering traps are pinned individually, because precedence is
invisible in review and each of them was a real mis-claim — adding to the list
reading it back, declaring a gluten allergy filtering the catalogue, and a
timer question being answered with a recipe search.

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

`test/shopping.test.js` is where the promises that make a shopping list worth
trusting are kept, and every one of them is a refusal: no line is ever both a
number and "as needed", no merge across all ten recipes ever mixes two units or
invents a total, and adding a dish twice never doubles the shopping. It also pins
each recipe's list as a table the way the cook plan is pinned, holds the merge to
being order-independent, and checks that the substitution advice it offers can
never cross an allergen.

None of that loads `public/app.js`, though — the unit tests run the engines in
Node, and the web app is a DOM, a stylesheet and a remote-control focus model. So
the parts a person would actually notice are checked in a real browser, on demand:

```bash
npm start                 # terminal 1 — serves public/ on :8080
npm run verify:browser    # terminal 2 — drives Chromium at 1920x1080, 72 checks
npm run verify:voice      # terminal 2 — the voice layer, against a real recogniser
```

It presses the real buttons and reads the real DOM: the panel lists and ticks, the
badge counts down, the step card stays on screen at 1080p, focus lands inside the
panel so a D-pad can reach it, the list survives a reload, and the console stays
clean. The voice block covers the states only a browser can produce: a microphone
that never really opens has to end in words *and* hand over the list that does
work, a listen ended by the timeout has to leave the button usable, the transcript
has to show both sides of the exchange, the help list on screen has to be the
command table rather than a copy of it, and the line telling a new cook how to talk
has to survive a 1280×720 screen uncut.

`verify:voice` exists because the checks above are not enough for voice, and the
reason is worth stating plainly. Every voice test in this repo used to replace
`SpeechRecognition` with a stub that called the callbacks on cue, so they all
passed while the real thing was dead: a recogniser that accepts `start()` and then
emits nothing at all — no start, no result, no error — which is exactly what
Chromium does in headless mode. A stub that always calls back cannot fail the way a
component fails when the callback never arrives. So the voice harness drives the
real app in a real browser and asserts on the real failure, by injecting the one
thing that is broken on the target device — a recogniser that never reports
starting — and then checking that the app notices, stops claiming to listen, stops
offering a microphone it has proved it does not have, and hands over the list of
phrases that can be selected instead. It also checks barge-in, and that a browser
whose recogniser *does* work is never mistaken for a dead one.

Playwright is deliberately not a dependency — CI has no browser, and a test that
cannot run is worse than no test. See `docs/DEV_SETUP.md`.

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

1. Type "mushrooms, rice, onion and garlic" (or say it). The panel answers with
   **one dish**, not a grid — *Tonight, cook this*, what it would cost you ("1 to
   swap"), and the reason underneath. Everything else folds into a single line
   each: **Also ready right now**, **Needs shopping**. Hit **Another one** and
   the runner-up takes its place — the same runner-up every time. Then ask
   **"what can I make without going shopping"**: it answers honestly that nothing
   is fully stocked with this kitchen, and names the dish that is one swap away.
   Hit **Why 96%?** on any card to show the weighted breakdown behind the score.
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
8. Still at six servings, press **🛒 Add what's missing** → the shopping list
   appears with the purchase and nothing else: no salt, no olive oil, no pantry
   items, and every amount written for six people. Open the stir-fry and press it
   again — the garlic becomes one line of 5 cloves for two dishes, not two lines.
   Point at the line marked **as needed** and at the one offering "or use your
   olive oil": the list says what to buy, and where you need not buy anything.
9. Reload the page. Both timers come back (paused, with the time they had left)
   *and* the home screen offers "You were on step 6 of 7" → **Resume cooking**
   puts you back on that step with the swap still applied. The shopping list is
   still there too: it outlives the recipe it was built from.
10. Open **Device check** → the probes for this device, and **Copy report** for
    a bug report anyone can paste.
11. Say **"sort out dinner"** — the agent answers with a dish, the shopping it
    would add, and the longest wait, and *then* asks one question. Say **"yes"**
    and the recipe opens on step 1 with the list already filled in — it waited,
    because opening a recipe is free and editing your shopping list is not. Now
    say **"use up what's in my kitchen"** and watch it answer the *other*
    question: nothing here needs zero shopping, and here is the one dish that is
    a single swap away.
12. Press **🙌 Hands-free** and then put the remote down and leave it down. Say
    "next step", "next step", "set a timer for 18 minutes" — the microphone
    re-opens by itself after every answer.
13. Drive the whole thing with the remote: arrows move, OK selects, Back
    returns. Turn the network off and reload — it still opens.
14. Close on "hands never touched the screen".

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the system design,
[docs/DEV_SETUP.md](docs/DEV_SETUP.md) for the development environment, and
[docs/DEVPOST_SUBMISSION.md](docs/DEVPOST_SUBMISSION.md) for the submission
story and the 2:45 demo video shot list.

## License

MIT — see [LICENSE](LICENSE).
