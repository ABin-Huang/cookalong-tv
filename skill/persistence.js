"use strict";

/**
 * CookAlong TV — what the skill remembers between sessions.
 *
 * Kept out of index.js and free of any ASK builder, for the same reason
 * responses.js is: the part worth testing is the decision about WHAT survives
 * a session ending, and that decision can be tested in plain Node with two fake
 * objects instead of a Lambda.
 *
 * An Alexa session ends the moment the cook stops talking, and cooking is
 * nothing but pauses: check the oven, wipe the counter, come back. Every one of
 * those gaps is a new session with empty attributes, so the dish being cooked,
 * the swaps already agreed to, the diet and the allergies were all forgotten
 * between two questions — the app asked a cook to re-declare their dairy
 * allergy every time they turned around.
 */

const SESSION_STATE_KEY = "cookalong";

/**
 * The six facts worth carrying across a pause, and nothing else:
 *
 *   diets, allergens  declared once, then relied on forever. This is the
 *                     safety-critical pair — an answer that forgets an allergy
 *                     is not a worse answer, it is a dangerous one.
 *   lastHaves         what is in the kitchen, which is the question this app is
 *                     built on. "What can I make" should not require re-listing
 *                     the fridge.
 *   recipeId, step,   where the cook was, so "keep cooking" resumes the dish
 *   swaps             rather than starting an empty session. The swaps travel
 *                     with it, or a resumed step quietly undoes a decision the
 *                     cook already made.
 *
 * Deliberately NOT here: matchIds / matchIndex / awaitingCook. Those are the
 * tail of one spoken exchange — a cook who said "cook it" a second ago. Reviving
 * them tomorrow would make "cook it" start a dish nobody just discussed.
 */
const PERSISTED_KEYS = ["diets", "allergens", "lastHaves", "recipeId", "step", "swaps"];

/** Just the persisted half of a session, with nothing set to `undefined`. */
function snapshot(session) {
  const out = {};
  PERSISTED_KEYS.forEach(k => {
    if (session && session[k] !== undefined) out[k] = session[k];
  });
  return out;
}

/** Put it back. Returns the keys actually applied, so a caller can say what it knew. */
function restore(session, saved) {
  if (!saved || typeof saved !== "object") return [];
  const applied = [];
  PERSISTED_KEYS.forEach(k => {
    if (saved[k] !== undefined) {
      session[k] = saved[k];
      applied.push(k);
    }
  });
  return applied;
}

/** The one place the key lives, for property storage of any kind (DynamoDB here). */
const REMEMBERED_KEY = "state";

/**
 * The pre/post pair, built against a table name and a way to reach the session.
 *
 * `sessionOf(handlerInput)` is injected rather than imported so this module can
 * be tested with a plain object standing in for the SDK's request envelope.
 *
 * Both halves swallow their own failures on purpose. Losing memory is a degraded
 * skill; a skill that throws on every single request because a table is missing
 * or a role lost a permission is a dead one. It says so in the log and carries
 * on session-only.
 */
function createPersistence({ tableName, sessionOf }) {
  const enabled = Boolean(tableName);

  const load = {
    async process(handlerInput) {
      if (!enabled) return;
      try {
        const stored = await handlerInput.attributesManager.getPersistentAttributes();
        const saved = stored && stored[REMEMBERED_KEY];
        restore(sessionOf(handlerInput), saved);
      } catch (e) {
        console.error(`CookAlong: could not load remembered state (${e && e.message}). Continuing session-only.`);
      }
    }
  };

  const save = {
    async process(handlerInput) {
      if (!enabled) return;
      try {
        const out = snapshot(sessionOf(handlerInput));
        // An empty state writes NOTHING. A session that ended before the cook
        // said anything must not erase the profile the previous one saved —
        // which is the failure mode that makes naive persistence worse than
        // having none at all.
        if (!Object.keys(out).length) return;
        handlerInput.attributesManager.setPersistentAttributes({ [REMEMBERED_KEY]: out });
        await handlerInput.attributesManager.savePersistentAttributes();
      } catch (e) {
        console.error(`CookAlong: could not remember state (${e && e.message}).`);
      }
    }
  };

  return { enabled, load, save };
}

module.exports = {
  SESSION_STATE_KEY,
  PERSISTED_KEYS,
  REMEMBERED_KEY,
  snapshot,
  restore,
  createPersistence
};
