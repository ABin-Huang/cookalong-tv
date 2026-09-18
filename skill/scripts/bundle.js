"use strict";

/**
 * Build a self-contained Lambda deployment bundle in skill/dist.
 *
 * The skill shares engines with the web app via ../../src/*.js, but a Lambda
 * package can only see files inside its own zip root. This script copies the
 * shared engines into dist/src and rewrites the require paths so the bundle
 * has no parent-directory references.
 *
 * Usage (from skill/):  npm run bundle
 * Then deploy skill/dist as the Lambda package (handler: index.handler).
 */

const fs = require("fs");
const path = require("path");

const SKILL_DIR = path.resolve(__dirname, "..");
const SRC_DIR = path.resolve(SKILL_DIR, "..", "src");
const DIST = path.join(SKILL_DIR, "dist");

function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true });
}
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

/**
 * The skill's own files. `persistence.js` belongs here for the same reason
 * `responses.js` does: index.js requires it, and a file that is required but not
 * copied is a Lambda that boots and then dies on the first request.
 */
const SKILL_FILES = ["index.js", "responses.js", "persistence.js", "package.json"];

rmrf(DIST);
fs.mkdirSync(DIST, { recursive: true });

// 1. skill code
for (const file of SKILL_FILES) {
  fs.copyFileSync(path.join(SKILL_DIR, file), path.join(DIST, file));
}
copyDir(path.join(SKILL_DIR, "apl"), path.join(DIST, "apl"));

// 2. shared engines
copyDir(SRC_DIR, path.join(DIST, "src"));

// 3. rewrite require("../src/x") -> require("./src/x") inside the bundle
for (const file of SKILL_FILES) {
  if (!file.endsWith(".js")) continue;
  const p = path.join(DIST, file);
  const fixed = fs.readFileSync(p, "utf8").replace(/require\("\.\.\/src\//g, 'require("./src/');
  fs.writeFileSync(p, fixed);
}

// 4. sanity: no parent-directory requires remain
const offenders = [];
for (const file of SKILL_FILES) {
  if (!file.endsWith(".js")) continue;
  if (fs.readFileSync(path.join(DIST, file), "utf8").includes('require("../')) offenders.push(file);
}
if (offenders.length) {
  console.error("Bundle still references parent dirs:", offenders);
  process.exit(1);
}
console.log("Lambda bundle ready at skill/dist (run npm install --production there, then zip).");
