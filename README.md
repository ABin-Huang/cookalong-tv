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
- **Pantry memory** — mark ingredients as used; the kitchen persists locally
  and future matches exclude them.
- **10 structured recipes** (up from 4), each with role-weighted ingredients,
  quantities and recipe-level substitution overrides.
- **Remote-first navigation** — arrow keys move focus, OK selects, Back
  returns. The whole app is drivable from a Fire TV remote, not just voice.
- **A timer you can walk away from** — wall-clock based (no drift), survives a
  reload or the app being backgrounded, keeps counting while you browse other
  recipes, and announces itself with a chime plus a full-screen alert when it
  finishes.
- **Works offline** — a service worker pre-caches the app shell, so the kitchen
  UI still opens with no network.
- **Honest scoring** — every match can explain itself: which ingredients
  counted on hand, which earned half credit as a swap, and the weighted total
  behind the percentage.
- **Voice that never depends on the cloud for the demo** — the Web App uses
  the Web Speech API when available and always falls back to tap/type; the
  Alexa skill mirrors the same engine on AWS Lambda.

## What's inside

| Path | What it is |
|---|---|
| `public/` | Fire TV Web App (HTML/CSS/JS 10-foot UI, PWA + service worker) |
| `skill/` | Alexa Skills Kit skill (Node.js, deployable to AWS Lambda) |
| `src/recipes.js` | Recipe engine: 10 structured recipes, dietary filters, voice-friendly steps |
| `src/ingredients.js` | Ingredient intelligence: normalization, weighted matching, substitutions, pantry (UMD — shared by browser & skill) |
| `src/timer.js` | Smart timer engine (natural-language durations, drift-free timer, persistence snapshots) |
| `scripts/` | `build-web.js` syncs `src/` into `public/`; `serve.js` is the dev server |
| `test/` | Unit tests for the recipe, ingredient & timer engines |

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

## Editing the engines

`public/ingredients-engine.js`, `public/timer-engine.js` and
`public/recipes-data.js` are generated from `src/`. Never edit them by hand —
change `src/` and re-sync:

```bash
npm run build:web    # write the public/ artifacts
npm run check:web    # verify they match src/ (also runs before npm test and in CI)
```

## Running tests

```bash
npm install --prefix skill   # once: the skill integration tests need ask-sdk-core
npm test                     # syntax-checks the entry points, verifies src/public sync, then runs 84 tests
```

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
- "what can I make that is vegan"

> **Known limitation:** the skill's timer is acknowledged in speech, but a
> Lambda invocation cannot ring later — nothing fires when it ends, and
> `CancelTimerIntent` only clears the session. A real alert needs the Alexa
> Timers/Reminders API. The Fire TV web app's on-screen timer does ring, with a
> chime and a full-screen alert. This is logged as product friction rather than
> hidden.

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
2. "cook it" → the ingredient list opens with everything tagged (on hand /
   pantry staple / swap available), then step-by-step guidance begins.
3. At the cheese step, the swap panel offers cheddar or nutritional yeast →
   apply it and watch the step text change from "grated parmesan" to
   "cheddar cheese"; undo restores it.
4. Walk to the step that says "cover and cook on low for 18 minutes" — the ⏱
   button now offers 18:00 because the timer read the step. Start it: it keeps
   counting while you browse back to the recipe list, and survives a reload.
5. Show the timer badge in the header, then let it finish: chime + full-screen
   alert.
6. Drive the whole thing with the remote: arrows move, OK selects, Back
   returns. Turn the network off and reload — it still opens.
7. Close on "hands never touched the screen".

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the system design and
[docs/DEV_SETUP.md](docs/DEV_SETUP.md) for the development environment.

## License

MIT — see [LICENSE](LICENSE).
