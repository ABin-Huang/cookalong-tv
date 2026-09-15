# CookAlong TV — Alexa skill deployment guide

This skill is **Lambda-ready ASK SDK v2** code with three **APL** screens
(match results, live cooking step, smart-swap confirmation) and optional
DynamoDB persistence of diet/allergen profiles.

## What is in this folder

| Path | Purpose |
| --- | --- |
| `index.js` | ASK SDK handlers, interceptors, APL directives (thin glue) |
| `responses.js` | Pure conversation logic + SSML + APL datasources (unit-tested) |
| `apl/*.json` | APL 1.9 documents, self-contained (no external package imports) |
| `models/en-US.json` | Interaction model: intents, slots, sample utterances |
| `skill.json` | Skill manifest, declares the `ALEXA_PRESENTATION_APL` interface |
| `scripts/bundle.js` | Builds a self-contained Lambda package in `dist/` |

Shared cooking engines live in `../src` (`recipes.js`, `ingredients.js`,
`timer.js`) and are reused verbatim by the web app and the skill.

## Option A — ASK CLI (recommended)

1. Install & authenticate: `npm i -g ask-sdk-controls || npm i -g ask-cli` then `ask init`.
2. From the repo root, build the self-contained bundle:
   ```bash
   cd skill && npm install && npm run bundle
   ```
3. Point the manifest endpoint at the bundle: in `skill.json`, set
   `apis.custom.endpoint.sourceDir` to `"./dist"` (or create the skill in the
   Alexa Developer Console and upload `dist` as the Lambda code package).
4. `ask deploy` — this uploads the interaction model from `models/en-US.json`
   and the Lambda function. Handler name: **`index.handler`**, runtime
   **Node.js 20.x**.
5. Open the Alexa Developer Console → **Test** tab and try the script below.

## Option B — Manual Lambda + Console

1. `cd skill && npm install && npm run bundle && cd dist && npm install --production`.
2. Zip the **contents** of `dist/` (so `index.js` is at the zip root) and
   upload to an AWS Lambda function (Node.js 20.x, handler `index.handler`).
3. Add an **Alexa Skills Kit** trigger; copy the Lambda ARN into the Console
   skill endpoint. Paste `models/en-US.json` into **JSON Editor** under
   Interaction Model, and enable the **Alexa Presentation Language**
   interface under Interfaces.

## Optional: cross-session profile memory (DynamoDB)

Set environment variable `DYNAMODB_TABLE=cookalong-profiles` on the Lambda and
grant the role `dynamodb:CreateTable/Select/GetItem/PutItem`. Without it the
skill still works, profile is session-only.

## Voice test script (Test tab, type or speak)

1. `open cook along`
2. `I'm vegan` → profile acknowledged
3. `I have pasta, tomato and garlic` → scored matches rendered as APL list,
   no dairy/meat dish appears
4. `cook it` → starts the best match, cooking screen shows Step 1
5. `I don't have basil` → swap-confirmation screen, plant-based swap only
6. `next step` → cooking screen advances and progress bar updates
7. `set a timer for 5 minutes` → spoken confirmation
8. `help`, then `stop`

## APL testing

In the Console Test tab switch the simulated device to **Fire TV (1920×1080)**
or an **Echo Show**; every response from flows 3, 4, 5, 6 renders a screen.
The documents intentionally avoid external style packages so they render
with no network dependency.
