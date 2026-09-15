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
- **Live missing-ingredient swaps** — "no parmesan?" → cheddar, and the
  cooking steps rewrite themselves instantly, with an undo path.
- **Pantry memory** — mark ingredients as used; the kitchen persists locally
  and future matches exclude them.
- **10 structured recipes** (up from 4), each with role-weighted ingredients,
  quantities and recipe-level substitution overrides.
- **Voice that never depends on the cloud for the demo** — the Web App uses
  the Web Speech API when available and always falls back to tap/type; the
  Alexa skill mirrors the same engine on AWS Lambda.

## What's inside

| Path | What it is |
|---|---|
| `public/` | Fire TV Web App (HTML/CSS/JS 10-foot UI, PWA manifest) |
| `skill/` | Alexa Skills Kit skill (Node.js, deployable to AWS Lambda) |
| `src/recipes.js` | Recipe engine: 10 structured recipes, dietary filters, voice-friendly steps |
| `src/ingredients.js` | Ingredient intelligence: normalization, weighted matching, substitutions, pantry (UMD — shared by browser & skill) |
| `src/timer.js` | Smart timer engine (natural-language durations, stateful timer) |
| `test/` | Unit tests for the recipe, ingredient & timer engines |

## Quick start (web app)

```bash
npm start          # serves public/ at http://localhost:8080
# or
npm run serve      # requires npx
```

Open http://localhost:8080 in a browser (or load `public/index.html` directly).
Try the **"What's in my kitchen"** tab: add `mushrooms, rice, onion, garlic`,
open the top match, and hit **Swap** on the missing ingredients.

## Running tests

```bash
npm test           # runs all unit tests (node --test), 31 tests
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

1. "I have mushrooms, rice, onion and garlic" → best match at 88%, every
   missing item flagged as swappable.
2. "cook it" → step-by-step guidance begins.
3. At the cheese step: "I don't have parmesan" → cheddar swap with guidance;
   the TV step text updates live.
4. "set a timer for 18 minutes" → smart timer.
5. Close on "hands never touched the screen".

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the system design and
[docs/DEV_SETUP.md](docs/DEV_SETUP.md) for the development environment.

## License

MIT — see [LICENSE](LICENSE).
