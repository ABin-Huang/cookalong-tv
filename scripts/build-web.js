"use strict";

/**
 * Sync the shared engines from src/ into public/ so the Fire TV Web App can
 * never drift away from the Node side (skill + tests).
 *
 *   src/ingredients.js  -> public/ingredients-engine.js    (verbatim; it is UMD)
 *   src/timer.js        -> public/timer-engine.js          (verbatim; it is UMD)
 *   src/capabilities.js -> public/capabilities-engine.js   (verbatim; it is UMD)
 *   src/progress.js     -> public/progress-engine.js       (verbatim; it is UMD)
 *   src/servings.js     -> public/servings-engine.js       (verbatim; it is UMD)
 *   src/plan.js         -> public/plan-engine.js           (verbatim; it is UMD)
 *   src/shopping.js     -> public/shopping-engine.js       (verbatim; it is UMD)
 *   src/recipes.js      -> public/recipes-data.js          (window.COOKALONG_RECIPES)
 *
 * Usage:
 *   node scripts/build-web.js           write the artifacts
 *   node scripts/build-web.js --check   verify only; exit 1 when out of sync
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CHECK = process.argv.includes("--check");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

// Git may hand us CRLF on Windows; compare on LF so the check is portable.
const normalize = s => s.replace(/\r\n/g, "\n");

const { RECIPES } = require(path.join(ROOT, "src", "recipes.js"));

const artifacts = [
  { out: "public/ingredients-engine.js", content: read("src/ingredients.js") },
  { out: "public/timer-engine.js", content: read("src/timer.js") },
  { out: "public/capabilities-engine.js", content: read("src/capabilities.js") },
  { out: "public/progress-engine.js", content: read("src/progress.js") },
  { out: "public/servings-engine.js", content: read("src/servings.js") },
  { out: "public/plan-engine.js", content: read("src/plan.js") },
  { out: "public/shopping-engine.js", content: read("src/shopping.js") },
  {
    out: "public/recipes-data.js",
    content: "// AUTO-SYNCED from src/recipes.js — do not edit by hand.\n" +
      "window.COOKALONG_RECIPES = " + JSON.stringify(RECIPES) + ";\n",
  },
];

const drifted = artifacts.filter(a => {
  const abs = path.join(ROOT, a.out);
  return !fs.existsSync(abs) || normalize(fs.readFileSync(abs, "utf8")) !== normalize(a.content);
});

if (CHECK) {
  if (drifted.length) {
    console.error(
      "Out of sync with src/: " + drifted.map(a => a.out).join(", ") +
      "\nRun: npm run build:web"
    );
    process.exit(1);
  }
  console.log("Web artifacts are in sync with src/.");
} else {
  drifted.forEach(a => {
    const abs = path.join(ROOT, a.out);
    // keep whatever line ending the working copy already uses (git autocrlf);
    // normalise to LF first so CRLF input never becomes CR CR LF
    const existing = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
    const lf = normalize(a.content);
    fs.writeFileSync(abs, existing.includes("\r\n") ? lf.replace(/\n/g, "\r\n") : lf);
  });
  console.log(drifted.length
    ? "Updated: " + drifted.map(a => a.out).join(", ")
    : "Already in sync — nothing to do.");
}
