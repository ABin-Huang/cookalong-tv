"use strict";

/**
 * CookAlong TV - Cook plan engine
 *
 * Cooking is parallel: the rice simmers for 18 minutes while the chicken rests
 * for 5. `TimerRack` makes several timers possible, but that only helps a cook
 * who already knows which pots exist and how long each one wants. This engine
 * answers that first question — which steps of this recipe actually name a
 * time, and where the longest stretch is — so the app can show the whole cook
 * at a glance and let any step's timer be started from one screen, instead of
 * walking to the step to discover it is asking for 18 minutes.
 *
 * It reads durations with the same parser the timer button uses
 * (`stepDurationSeconds`), deliberately. Two implementations of "what time is
 * this step asking for" would drift, and the one that drifted would be the one
 * the cook was reading.
 *
 * Nothing here interprets the numbers. A step that names several times reports
 * the longest one, which is the timer engine's documented behaviour, and the
 * sum of the named times is never presented as how long the dish takes —
 * chopping and plating are not timed, and two steps can run at once. That is
 * why every field that sums is called "named".
 *
 * UMD bundle: works as a CommonJS module (Node tests) and as
 * `window.CookalongPlan` in the Fire TV Web App.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./timer.js"));
  } else {
    root.CookalongPlan = factory(root.CookalongTimer);
  }
})(typeof self !== "undefined" ? self : this, function (timerEngine) {

  function durationOf(stepText) {
    if (!timerEngine || typeof timerEngine.stepDurationSeconds !== "function") return null;
    const seconds = timerEngine.stepDurationSeconds(stepText);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  }

  /**
   * Every step that names a duration, in step order.
   *
   * @param {string[]} steps step prose, already scaled and swap-rewritten — the
   *   amount text changes, the times never do, and both are held to that.
   * @returns {{index:number, seconds:number, text:string}[]} `index` is the
   *   step's position in the original list, so a plan row can point back at
   *   "step 6" even when the steps before it named no time at all.
   */
  function timedSteps(steps) {
    const list = Array.isArray(steps) ? steps : [];
    const out = [];
    list.forEach((text, index) => {
      const seconds = durationOf(text);
      if (seconds !== null) out.push({ index, seconds, text: String(text) });
    });
    return out;
  }

  /** The longest single time any step names; a tie goes to the earlier step. */
  function pickLongest(timed) {
    let best = null;
    timed.forEach(entry => {
      if (!best || entry.seconds > best.seconds) best = entry;
    });
    return best;
  }

  function longest(steps) {
    return pickLongest(timedSteps(steps));
  }

  /**
   * @returns {{
   *   totalCount:number, timedCount:number, namedSeconds:number,
   *   longest:{index:number, seconds:number, text:string}|null,
   *   steps:{index:number, seconds:number, text:string}[]
   * }}
   */
  function summary(steps) {
    const list = Array.isArray(steps) ? steps : [];
    const timed = timedSteps(list);
    return {
      totalCount: list.length,
      timedCount: timed.length,
      namedSeconds: timed.reduce((sum, entry) => sum + entry.seconds, 0),
      longest: pickLongest(timed),
      steps: timed,
    };
  }

  return { timedSteps, longest, summary };
});
