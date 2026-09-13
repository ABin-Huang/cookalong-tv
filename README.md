# CookAlong TV

Voice-first interactive cooking companion for **Amazon Fire TV** with **Alexa+** integration.

CookAlong TV turns your living-room TV into a hands-free cooking companion:
step-by-step recipes, smart timers and dietary filters — controlled by voice
or the remote, so you never touch the screen with messy hands.

Built for the **Build, Ship, Shape: Amazon Developer Hackathon**.

## What's inside

| Path | What it is |
|---|---|
| `public/` | Fire TV Web App (HTML/CSS/JS 10-foot UI, PWA manifest) |
| `skill/` | Alexa Skills Kit skill (Node.js, deployable to AWS Lambda) |
| `src/recipes.js` | Recipe engine (data, dietary filters, voice-friendly steps) |
| `src/timer.js` | Smart timer engine (natural-language durations, stateful timer) |
| `test/` | Unit tests for the recipe & timer engines |

## Quick start (web app)

```bash
npm start          # serves public/ at http://localhost:8080
# or
npm run serve      # requires npx
```

Open http://localhost:8080 in a browser (or load `public/index.html` directly).
Browse recipes, filter by diet, follow steps, and start a smart timer.

## Running tests

```bash
npm test           # runs all unit tests (node --test)
```

## Alexa skill

The skill lives in `skill/`. Deploy `skill/index.js` as an AWS Lambda function
with the `ask-sdk-core` dependency, then import `skill/skill.json` in the Alexa
Developer Console with the interaction model in `skill/models/en-US.json`.

Invocation name: **cook along**

Example utterances:

- "Alexa, open cook along"
- "cook tomato basil pasta"
- "next step" / "repeat step"
- "set a timer for 5 minutes"
- "what can I make that is vegan"

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the system design and
[docs/DEV_SETUP.md](docs/DEV_SETUP.md) for the development environment.

## License

MIT — see [LICENSE](LICENSE).
