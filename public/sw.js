"use strict";

/**
 * CookAlong TV service worker.
 *
 * Pre-caches the whole app shell so a Fire TV (or a phone propped up in the
 * kitchen) keeps working when the network drops. Bump CACHE_VERSION whenever
 * the shell changes — the old cache is deleted on activate.
 */

const CACHE_VERSION = "cookalong-v6";

const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "recipes-data.js",
  "ingredients-engine.js",
  "timer-engine.js",
  "capabilities-engine.js",
  "progress-engine.js",
  "servings-engine.js",
  "manifest.json",
  "icon.svg",
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Network-first with the pre-cache as an offline fallback. Serving the cache
  // first here would make every edit invisible until the cache version changed,
  // which is a trap during development; the app still opens with no network.
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then(hit => {
          if (hit) return hit;
          if (request.mode === "navigate") return caches.match("index.html");
          return new Response("Offline and not cached", { status: 503, statusText: "Offline" });
        })
      )
  );
});
