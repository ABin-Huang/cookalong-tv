# CookAlong TV

**Voice-first interactive cooking companion for Amazon Fire TV with Alexa+ integration.**

CookAlong TV turns your Fire TV into an interactive cooking companion: step-by-step guided recipes with large, high-contrast cards built for 10-foot viewing distance, fully controlled by voice through Alexa+.

Built for the [Build, Ship, Shape: Amazon Developer Hackathon](https://amazonappdev2026.devpost.com/).

## Inspiration

Cooking while following a recipe on a phone or tablet is a mess: flour-covered fingers on a touchscreen, eyes darting between a tiny screen and a hot pan, hands too busy to scroll. We wanted to bring the recipe INTO the kitchen — on the biggest screen in the house — and make it fully hands-free with Alexa+.

## Features

- **Step-by-step guided recipes** — large, high-contrast cards built for 10-foot viewing distance. No squinting while your hands are full.
- **Alexa+ voice control** — "Alexa, next step", "Alexa, go back", "Alexa, repeat", "Alexa, set a timer for 5 minutes". Voice is the primary input, not a gimmick.
- **Smart timers** — sync with recipe steps and announce through the TV when time is up.
- **Dietary filters** — vegetarian, gluten-free, allergy-aware; adapts every recipe automatically.
- **Family profiles** — each member gets their own favorites, dietary needs, and difficulty level.

## Architecture

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│  Fire TV App    │      │  Recipe Engine   │      │  Alexa Skill    │
│  (Web App for   │◄────►│  (Node.js)       │◄────►│  (ASK / Alexa   │
│   Fire TV)      │ REST │  state machine   │ NLU  │   Conversations)│
└─────────────────┘      └──────────────────┘      └─────────────────┘
```

- **Fire TV app**: Web App for Fire TV (HTML5), optimized for the Fire TV remote (DPAD navigation) and a 10-foot UI.
- **Alexa+ integration**: Alexa Skills Kit mapping natural-language commands to recipe navigation intents (`NEXT_STEP`, `PREVIOUS_STEP`, `REPEAT`, `SET_TIMER`).
- **Recipe engine**: Node.js service that parses structured recipe data (ingredients, steps, timers), applies dietary adaptations, and drives the UI state machine.
- **Voice-UI state sync**: the Fire TV app and the Alexa skill share session state so the screen and the voice assistant always agree on the current step.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for details.

## Getting Started

### Prerequisites

- Node.js 18+
- Amazon Developer account with Alexa Skills Kit and Fire TV App Tester

### Install

```bash
git clone https://github.com/ABin-Huang/cookalong-tv.git
cd cookalong-tv
npm install
```

### Run the recipe engine (local dev)

```bash
npm start
```

The engine serves the recipe state machine API on `http://localhost:3000`.

### Load the Fire TV app

1. Open the Fire TV App Tester and load `app/` as a Web App.
2. Enable the Alexa skill (see `skill/` for the interaction model and handlers).

See [docs/DEV_SETUP.md](docs/DEV_SETUP.md) for the full walkthrough.

## Roadmap

- Multi-language support and regional cuisines
- Integration with Amazon shopping lists ("Alexa, add the ingredients to my cart")
- Community recipes, ratings, and adaptive difficulty based on cooking history

## Built With

- Amazon Fire TV / Fire TV Web App
- Alexa Skills Kit / Alexa+
- Node.js
- HTML / CSS / JavaScript

## License

[MIT](LICENSE)
