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
- Open a recipe and press **🥘 Cook plan · Show steps** — every step that names a
  time, with its own duration and a **⏱ Start** on each row. Press Start on the
  long one and note that the step on screen never moved: that is how two pots get
  going before you have left step 1.
- Click **Set timer** on a step → Start / Pause / Stop per timer, several at
  once, each named after its step. Timers keep counting while you browse other
  screens, survive a reload, and alert you by name when they land.
- Walk **Cooking for** up to 6 — amounts and step prose rewrite themselves, and
  every duration in the cook plan stays exactly where it was.
- Toggle **Voice on/off** in the header to silence spoken guidance.
- Tap an allergy chip (**Leave out:**) to hide recipes that carry it.
- Click **Device check** in the footer to see what this browser reports it can
  do. On a desktop it will list installed voices; on a Fire TV it will not.

## Editing the shared engines

`public/ingredients-engine.js`, `public/timer-engine.js`,
`public/capabilities-engine.js`, `public/progress-engine.js`,
`public/servings-engine.js`, `public/plan-engine.js`,
`public/shopping-engine.js` and `public/recipes-data.js`
are **generated** from `src/`. Edit `src/` only, then:

```bash
npm run build:web    # write the public/ artifacts
npm run check:web    # verify they match src/ — runs before npm test and in CI
```

## Adding a generated engine

Five places keep their own list of engines and **none are derived from the
others**, so adding one means touching all five:

1. `scripts/build-web.js` — add the `src/` → `public/` pair.
2. `package.json` `check:syntax` — add the new `src/` file.
3. `public/index.html` — add the `<script>` tag.
4. `public/sw.js` — add it to `SHELL` and bump `CACHE_VERSION`.
5. `test/web-contract.test.js` — add it to `ENGINE_SCRIPTS` and to the
   byte-identical pairs.

If the new engine resolves another one at load time, its `<script>` tag must come
*after* that engine's, and the contract test should assert it. Two engines already
do this: `plan.js` resolves `timer.js`, and `shopping.js` resolves both
`servings.js` and `ingredients.js`. Get the order wrong and the dependent engine
silently loads with a null dependency instead of failing loudly — the plan goes
empty, and the shopping list loses its amounts.

`test/web-contract.test.js` fails if you miss step 3, 4 or 5, and
`npm run check:web` fails if you forget to run the build.

## Run the tests

```bash
npm install --prefix skill   # once: skill integration tests need ask-sdk-core
npm test
```

Covers the recipe engine (listing, filtering, step formatting), the ingredient
intelligence engine (matching, substitutions, pantry), the timer engine
(duration parsing, drift-free ticking, the multi-timer rack, persistence
round-trips), the capability probes, the serving scaler, the cook plan and the
shopping list.

The two engines whose behaviour is a *promise to the cook* rather than a
calculation are held to it by sweeping the whole recipe corpus instead of
spot-checking strings: `test/plan.test.js` checks that neither rescaling nor
swapping ever moves a planned duration, and `test/shopping.test.js` checks that
no merge ever mixes two units, invents a total, or doubles a list when the same
dish is added twice.

### Browser checks (opt-in)

Unit tests run the engines in Node, but the web app is a DOM, a stylesheet and a
remote-control focus model, and **nothing in `npm test` ever loads
`public/app.js`**. A 10-point font, a button that pushes the step card below the
fold on a 1080p screen, focus that lands outside the panel so the D-pad cannot
reach it — none of that shows up in a unit test. So it is checked in a real
browser:

```bash
npm start                 # terminal 1 — serves public/ on :8080
npm run verify:browser    # terminal 2 — drives Chromium at 1920x1080
```

It presses the real buttons and reads the real DOM: the shopping panel lists and
ticks, the badge counts down, the step card stays on screen, focus lands in the
panel, the list survives a reload, and there are no console errors. It exits
non-zero on failure, so it works as a pre-demo gate.

It needs `playwright`, which is deliberately **not** a dependency — CI runs on a
bare Ubuntu runner with no browser, and a test that cannot run is worse than no
test. Install it only if you want the browser checks:

```bash
npm i -D playwright && npx playwright install chromium
```

If a playwright install already exists somewhere else on the machine, point
`NODE_PATH` at its `node_modules` rather than downloading a second browser:

```bash
NODE_PATH=C:\path\to\node_modules npm run verify:browser
```

Use the native path separator. Node on Windows ignores a POSIX-style `NODE_PATH`
without complaining, and the harness then reports playwright as missing — which
reads like a broken install rather than a path that was never seen.

`scripts/verify-browser.js` lives in `scripts/` rather than `test/` on purpose:
`node --test` treats every `.js` file under a `test/` directory as a test file,
so a harness parked there would be picked up by `npm test` and fail wherever
there is no browser.

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
├── src/               # shared engines (recipes, ingredients, timer, plan, …)
├── test/              # unit tests (plain Node — `node --test` picks up everything here)
├── scripts/           # build-web.js, serve.js, verify-browser.js (opt-in browser checks)
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
