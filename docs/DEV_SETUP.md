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
npm start          # zero-dependency static server (scripts/serve.js) on :8080
```

Then open http://localhost:8080.

`npm start -- 9000` picks a different port. The old implementation shelled out
to `python3 -m http.server`, which does not exist on Windows.

Or, to test the UI as a local file: open `public/index.html` directly in a
browser (data is bundled in `public/recipes-data.js`, so no server is strictly
required).

### What to try

- Filter recipes by **Vegetarian / Vegan / Gluten-free** chips.
- Navigate with the **arrow keys** (Fire TV remote), press **Enter/Space** to
  select, **Escape** to go back — the same bindings a remote sends.
- Open a recipe → follow steps with **Previous / Next**.
- Use the **swap panel** under the controls to substitute a missing ingredient;
  the step text rewrites itself and **Undo** puts it back.
- Open a match card's **Why N%?** to see the weighted scoring breakdown.
- Click **Set timer** → Start / Pause / Reset. The timer keeps counting while
  you browse other screens, survives a reload, and alerts you when it lands.
- Toggle **Voice on/off** in the header to silence spoken guidance.

## Editing the shared engines

`public/ingredients-engine.js`, `public/timer-engine.js` and
`public/recipes-data.js` are **generated** from `src/`. Edit `src/` only, then:

```bash
npm run build:web    # write the public/ artifacts
npm run check:web    # verify they match src/ — runs before npm test and in CI
```

## Run the tests

```bash
npm install --prefix skill   # once: skill integration tests need ask-sdk-core
npm test
```

Covers the recipe engine (listing, filtering, step formatting), the ingredient
intelligence engine (matching, substitutions, pantry) and the timer engine
(duration parsing, drift-free ticking, persistence round-trips).

## Service worker

`public/sw.js` pre-caches the app shell and serves **network-first**, so edits
show up on reload while the app still opens with no network. If you ever need a
clean slate, unregister the worker and clear caches from DevTools →
Application. Bump `CACHE_VERSION` in `sw.js` when the shell file list changes.

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
