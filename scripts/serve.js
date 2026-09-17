"use strict";

/**
 * Zero-dependency static server for the Fire TV Web App.
 *
 * Replaces the old `python3 -m http.server`, which does not exist on Windows
 * and made `npm start` fail out of the box on that platform.
 *
 * Usage:  npm start            -> http://localhost:8080
 *         npm start -- 9000    -> custom port
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "public");
const PORT = Number(process.argv[2] || process.env.PORT || 8080);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || "/").split("?")[0]);
  const rel = url === "/" ? "index.html" : url.replace(/^\/+/, "");
  const file = path.join(ROOT, rel);

  // never serve outside public/
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 Not Found: " + rel);
      return;
    }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(buf);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`CookAlong TV web app running at http://localhost:${PORT}`);
  console.log("Press Ctrl+C to stop.");
});
