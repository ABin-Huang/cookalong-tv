# Architecture

## Overview

CookAlong TV is a three-part system:

1. **Fire TV App** (`app/`) — a Web App for Fire TV (HTML5) presenting recipe cards, timers and navigation, optimized for DPAD remote control and 10-foot viewing.
2. **Recipe Engine** (`server/`) — a Node.js service exposing the recipe state machine and dietary adaptation logic over REST.
3. **Alexa Skill** (`skill/`) — an Alexa Skills Kit skill with intents for voice navigation; session state is shared with the app so voice and screen stay in sync.

## State machine

Each recipe session is a state machine:

```
READY ──start──▶ STEP 1 ──next──▶ STEP 2 ──…──▶ PLATED
  ▲                │ ▲            │
  └──repeat/replay─┘ └──previous──┘
```

States: `READY`, `STEP_N`, `TIMER_RUNNING`, `PLATED`.

Transitions (voice or DPAD): `next`, `previous`, `repeat`, `start_timer`, `stop_timer`.

## Voice intents (Alexa)

| Intent | Example utterance | Effect |
|---|---|---|
| `NEXT_STEP` | "Alexa, next step" | Advance to next recipe step |
| `PREVIOUS_STEP` | "Alexa, go back" | Return to previous step |
| `REPEAT_STEP` | "Alexa, repeat that" | Re-read the current step |
| `SET_TIMER` | "Alexa, set a timer for 5 minutes" | Start a step timer |
| `WHAT_IS_NEXT` | "Alexa, what's next?" | Preview the next step |

## Dietary adaptation

Recipes store structured ingredient/step data with tags. The engine filters and substitutes ingredients based on the active profile's dietary rules (vegetarian, gluten-free, allergies), so one recipe serves many diets.

## Session sync

The app and the skill share a session key. The engine is the single source of truth for step index and timer state; both clients render from its responses.
