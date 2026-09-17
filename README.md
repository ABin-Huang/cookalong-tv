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
npm test                     # verifies src/public sync, then runs 71 tests
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
- "next step" / "repeat step"
- "I don't have parmesan" → smart substitution advice
- "without onion" → re-rank excluding an ingredient
- "set a timer for 5 minutes"
- "what can I make that is vegan"

### 3-minute demo script

1. "I have mushrooms, rice, onion and garlic" → best match at 96%, every
   missing item flagged as swappable. Hit **Why 96%?** to show the weighted
   breakdown behind the number.
2. "cook it" → step-by-step guidance begins.
3. At the cheese step, the swap panel offers cheddar or nutritional yeast →
   apply it and watch the step text change from "grated parmesan" to
   "cheddar cheese"; undo restores it.
4. "set a timer for 18 minutes" → the timer keeps counting while you browse
   back to the recipe list, and survives a page reload.
5. Show the timer badge in the header, then let it finish: chime + full-screen
   alert.
6. Drive the whole thing with the remote: arrows move, OK selects, Back
   returns. Turn the network off and reload — it still opens.
7. Close on "hands never touched the screen".

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the system design and
[docs/DEV_SETUP.md](docs/DEV_SETUP.md) for the development environment.

## License

MIT — see [LICENSE](LICENSE).
