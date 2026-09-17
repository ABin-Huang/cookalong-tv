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
│  src/servings.js     — rescaling a recipe to a new yield  │
└─────────────────────────────────────────────────────────┘
```

Every engine is written once and consumed by three callers: the Fire TV web
app, the Alexa skill on Lambda, and the Node test suite. That is why the
engines are UMD rather than plain modules — a swap offered on the TV and a swap
offered by Alexa come from the same function, so they cannot disagree.

## Components

### Fire TV Web App (`public/`)

- `index.html` — home (recipe grid, diet chips, allergy chips, resume card,
  kitchen panel) and recipe view (servings stepper, ingredient list, step card,
  timer panel), plus the global timer section and the Device check dialog. The
  timer lives outside both views because it is state you set so you could walk
  away.
- `app.js` — rendering, filtering, step navigation, live swaps, yield scaling,
  progress persistence, capability probing, and D-pad focus handling (all four
  arrows, plus Back).

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
- `servings.js` — rescaling a recipe to a different yield. `scaleIngredients`
  handles the list, `scaleStepText` rewrites amounts inside step prose,
  `totalNutrition` multiplies the per-serving figures out, and `factorFor` /
  `clampServings` own the yields a cook can pick.

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
