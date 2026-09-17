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
│  src/timer.js        — duration parsing, stateful timer  │
│  src/capabilities.js — what this device can actually do  │
│  src/progress.js     — resume-where-you-left-off snapshots│
└─────────────────────────────────────────────────────────┘
```

Every engine is written once and consumed by three callers: the Fire TV web
app, the Alexa skill on Lambda, and the Node test suite. That is why the
engines are UMD rather than plain modules — a swap offered on the TV and a swap
offered by Alexa come from the same function, so they cannot disagree.

## Components

### Fire TV Web App (`public/`)

- `index.html` — home (recipe grid, diet chips, allergy chips, resume card,
  kitchen panel) and recipe view (ingredient list, step card, timer panel), plus
  the global timer section and the Device check dialog. The timer lives outside
  both views because it is state you set so you could walk away.
- `app.js` — rendering, filtering, step navigation, live swaps, progress
  persistence, capability probing, and D-pad focus handling (all four arrows,
  plus Back).
- `styles.css` — 10-foot UI theme (large type, high contrast, focus states).
  `body.screen-first` enlarges step text on devices that cannot speak.
- `manifest.json` / `icon.svg` — PWA manifest for Fire TV Web App packaging.

The web app runs standalone; in the full product it is hosted on AWS (static
hosting, e.g. S3 + CloudFront). It deliberately shares no session state with the
skill: both call the same engines, so both give the same answers, which is a
claim the code can back up without a device-linking backend.

### Alexa skill (`skill/`)

- `index.js` — request routing only; every handler delegates to `responses.js`.
  Handles all eighteen declared intents plus `PreviousStepIntent`:
  Launch, StartCooking, WhatDoIHave, NextMatch, Substitute, ExcludeIngredient,
  NextStep, PreviousStep, RepeatStep, SetTimer, CancelTimer, DietFilter,
  SetProfile, ClearProfile, Yes, No, Help, CancelAndStop, Fallback, SessionEnded.
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
  and allergens is never offered.
- `timer.js` — `parseDuration("1 hour 30 minutes") -> 5400`, a stateful `Timer`
  class (start / pause / resume / stop, `format()` MM:SS, `speak()`), and
  `stepDurationSeconds(stepText)` which reads a step's own cooking time so the
  timer can follow the recipe instead of a fixed default.
- `capabilities.js` — runtime probes for speech output, speech input, wake lock
  and storage, plus `summarize()` collapsing them into "is voice a real channel
  or is the screen the only one?" and `formatReport()` for bug reports.
- `progress.js` — `serialize`/`deserialize` for the cooking position (recipe,
  step, applied swaps), tolerant of junk because it runs in the boot path.

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
  `index.html`, an engine missing from the service-worker shell, or a
  capability guard regressing to a bare API check all fail here rather than at
  runtime. No unit test loads `app.js`, which is exactly how a redeclared
  identifier broke the whole web app while 71 tests stayed green.

Both are cheap, and both encode a specific incident rather than a general
principle. `npm run check:syntax` is the floor beneath them.
