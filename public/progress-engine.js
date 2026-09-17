"use strict";

/**
 * CookAlong TV - cooking progress
 *
 * The timer survives a reload, the pantry survives a reload, and the step you
 * were standing on did not. That mismatch is the worst kind of bug for a
 * living-room app: you walk away, the TV sleeps, you come back and the badge
 * offers to resume a countdown on a dish you are no longer looking at, because
 * the app dropped you back at step 1.
 *
 * Kept as a pure serialize/deserialize pair for two reasons: it can be tested
 * without a browser, and nothing in the boot path can throw on whatever junk is
 * sitting in localStorage.
 *
 * UMD bundle: works as a CommonJS module (Node tests) and as
 * `window.CookalongProgress` in the Fire TV Web App.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.CookalongProgress = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {

  const VERSION = 1;
  const MAX_SWAPS = 40;

  /**
   * Keep only swaps that still mean something. A swap whose replacement name is
   * missing cannot rewrite a step, so carrying it would produce a recipe view
   * that claims a swap is applied while the text still says the original.
   */
  function sanitizeSwaps(swaps) {
    const src = swaps && typeof swaps === "object" && !Array.isArray(swaps) ? swaps : {};
    const out = {};
    Object.keys(src).slice(0, MAX_SWAPS).forEach(canonical => {
      const option = src[canonical];
      if (!option || typeof option !== "object") return;
      const name = typeof option.name === "string" ? option.name.trim() : "";
      if (!name) return;
      const entry = { name };
      if (typeof option.note === "string" && option.note) entry.note = option.note;
      out[String(canonical)] = entry;
    });
    return out;
  }

  function toStep(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  function toTime(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  /**
   * Snapshot where the cook got to. Returns null when there is no recipe to
   * remember, so callers can treat null as "nothing worth writing".
   */
  function serialize(input) {
    const p = input || {};
    const recipeId = typeof p.recipeId === "string" ? p.recipeId.trim() : "";
    if (!recipeId) return null;
    return {
      v: VERSION,
      recipeId,
      step: toStep(p.step),
      swaps: sanitizeSwaps(p.swaps),
      at: toTime(p.at),
    };
  }

  /**
   * Rebuild a snapshot from untrusted text. Anything that is not a progress
   * record returns null, so a corrupt or future version degrades to "start
   * fresh" instead of throwing during boot.
   */
  function deserialize(raw) {
    let parsed = raw;
    if (typeof raw === "string") {
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        return null;
      }
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    if (Number(parsed.v) !== VERSION) return null;

    const recipeId = typeof parsed.recipeId === "string" ? parsed.recipeId.trim() : "";
    if (!recipeId) return null;

    return {
      v: VERSION,
      recipeId,
      step: toStep(parsed.step),
      swaps: sanitizeSwaps(parsed.swaps),
      at: toTime(parsed.at),
    };
  }

  /**
   * Whether there is a specific step worth offering to return to. Standing on
   * step 1 is not progress - it is where you would have started anyway.
   */
  function isResumable(progress) {
    return !!progress && progress.step > 0;
  }

  return { VERSION, serialize, deserialize, sanitizeSwaps, isResumable };
});
