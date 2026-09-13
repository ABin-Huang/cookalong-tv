# Dev Setup

## Prerequisites

- Node.js 18+ (or 20 LTS)
- Amazon Developer account (https://developer.amazon.com)
- Fire TV device or Fire TV App Tester

## 1. Recipe engine

```bash
npm install
npm start
```

Serves `http://localhost:3000`. Endpoints:

- `GET /recipes` — list recipes
- `GET /recipes/:id` — recipe detail with steps
- `POST /sessions` — start a cooking session
- `POST /sessions/:id/transition` — `{ action: "next" | "previous" | "repeat" | "start_timer" | "stop_timer" }`

## 2. Fire TV app

Open **Fire TV App Tester** → load `app/index.html` as a Web App. The app reads session state from the engine and renders the current step card. Remote DPAD: up/down to navigate within a step, Select to advance.

## 3. Alexa skill

- Use the ASK CLI or the Alexa Developer Console to deploy `skill/`.
- Link the skill to the same recipe-engine endpoint via the skill backend (`skill/handlers.js`).
- Test with the Alexa simulator: "Alexa, open cook along" then "Alexa, next step".

## Notes

- Voice-first means every screen element must also be reachable by voice; keep labels short and unambiguous.
- 10-foot UI: minimum readable font size ≈ 24px at 1080p, high contrast, minimal chrome.
