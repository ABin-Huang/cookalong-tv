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
│  Core engines                                            │
│  src/recipes.js   — recipes, dietary filters, steps     │
│  src/timer.js     — duration parsing, stateful timer    │
└─────────────────────────────────────────────────────────┘
```

## Components

### Fire TV Web App (`public/`)

- `index.html` — home (recipe grid + diet chips) and recipe view (step card,
  prev/next, timer panel).
- `app.js` — rendering, diet filtering, step navigation, client-side timer,
  remote key handling (ArrowLeft/ArrowRight).
- `styles.css` — 10-foot UI theme (large type, high contrast, focus states).
- `manifest.json` / `icon.svg` — PWA manifest for Fire TV Web App packaging.

The web app can run standalone; in the full product it is hosted on AWS
(static hosting, e.g. S3 + CloudFront) and communicates with the skill's
Lambda backend for shared state.

### Alexa skill (`skill/`)

- `index.js` — request handlers:
  - `LaunchRequest` — welcome + recipe list
  - `StartCookingIntent` — start a named recipe (slot: RECIPE)
  - `NextStepIntent` / `RepeatStepIntent` — step navigation
  - `SetTimerIntent` / `CancelTimerIntent` — voice timers (slot: AMAZON.DURATION)
  - `DietFilterIntent` — filter recipes (slot: DIET)
  - Help / Cancel / Stop / Fallback
- `skill.json` — skill manifest for the Alexa Developer Console.
- `models/en-US.json` — interaction model (invocation name **cook along**).

### Core engines (`src/`)

- `recipes.js` — in-memory recipe store, `listRecipes(diet)`, `getRecipe(id)`,
  `formatStep(recipe, n)` producing voice-friendly step text.
- `timer.js` — `parseDuration("1 hour 30 minutes") -> 5400` and a stateful
  `Timer` class (start / pause / resume / stop, `format()` MM:SS, `speak()`).

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

The Fire TV app mirrors this experience visually with the same engine.
