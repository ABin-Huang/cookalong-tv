# CookAlong TV — Development Setup

## Prerequisites

- Node.js **>= 18** (for the engines, tests and skill)
- A modern browser for the web app (Chrome / Firefox / Edge)
- (Optional) `npx` for the `serve` script

## Install

```bash
git clone https://github.com/ABin-Huang/cookalong-tv.git
cd cookalong-tv
npm install        # optional: no runtime deps for core; installs tooling if added
```

There are **no runtime dependencies** for the core engines and the web app —
everything runs on plain Node.js and the browser. The only dependency package
(`ask-sdk-core`) is used when deploying the Alexa skill.

## Run the web app

```bash
npm start          # python3 -m http.server 8080 --directory public
```

Then open http://localhost:8080.

Or, to test the UI as a local file: open `public/index.html` directly in a
browser (data is bundled in `public/recipes-data.js`, so no server is strictly
required).

### What to try

- Filter recipes by **Vegetarian / Vegan / Gluten-free** chips.
- Open a recipe → follow steps with **Previous / Next** (or Arrow keys).
- Click **Set timer** → Start / Pause / Reset.

## Run the tests

```bash
npm test
```

Covers the recipe engine (listing, filtering, step formatting) and the timer
engine (duration parsing, timer lifecycle).

## Alexa skill (optional, for device testing)

1. Install dependencies in `skill/`:

   ```bash
   cd skill && npm install
   ```

2. In the **Alexa Developer Console**, create a custom skill and import
   `skill/skill.json`; upload `skill/models/en-US.json` as the interaction
   model (invocation name **cook along**).

3. Create a Lambda function (Node.js 18), upload `skill/` as the code, and set
   the skill endpoint to the Lambda ARN.

4. Test in the console simulator:

   - "open cook along"
   - "cook tomato basil pasta"
   - "next step"
   - "set a timer for 5 minutes"

## Project layout

```
cookalong-tv/
├── public/            # Fire TV Web App (front-end)
├── skill/             # Alexa skill (back-end / Lambda)
├── src/               # shared engines (recipes, timer)
├── test/              # unit tests
├── docs/              # architecture & setup docs
└── README.md
```

## Troubleshooting

- **Port 8080 busy**: change the port in `package.json` (`npm start`) or use
  `npm run serve` with `-l <port>`.
- **Tests not found**: run `node --test` from the repo root (auto-discovers
  `test/`).
- **Skill won't deploy**: ensure `ask-sdk-core` is installed inside `skill/`
  and the Lambda runtime is Node.js 18+.
