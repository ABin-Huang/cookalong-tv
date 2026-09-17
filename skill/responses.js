"use strict";

/**
 * CookAlong TV — pure response layer for the Alexa skill.
 *
 * Every intent is turned into speech (SSML), a reprompt, an optional APL
 * document + datasource, and session-state mutations HERE, without any ASK
 * SDK dependency. index.js is only thin ASK glue, which keeps the whole
 * conversation flow unit-testable in plain Node.
 */

const { RECIPES, getRecipe, formatStep } = require("../src/recipes");
const {
  parseIngredientList,
  normalizeIngredient,
  normalizeProfile,
  matchRecipesWithExclusions,
  findSubstitute,
  substituteInSteps,
  displayName
} = require("../src/ingredients");

const APL = {
  matchResults: require("./apl/match-results.json"),
  cooking: require("./apl/cooking.json"),
  swapConfirm: require("./apl/swap-confirm.json")
};

const MATCH_FLOOR = 40;
const MATCH_LIMIT = 3;

/* ----------------------------- small helpers ---------------------------- */

function profileOf(session) {
  return normalizeProfile({ diets: session.diets || [], allergens: session.allergens || [] });
}

function profileClause(session) {
  const p = profileOf(session);
  const bits = [];
  if (p.diets.length) bits.push(p.diets.join(" and "));
  if (p.allergens.length) bits.push(`no ${p.allergens.join(", no ")}`);
  return bits.length ? ` <break time="120ms"/>Cooking ${bits.join(", ")} today.` : "";
}

/** Apply recorded swaps to a recipe's step text, returning display steps. */
function rewrittenSteps(recipe, swaps) {
  let steps = [...recipe.steps];
  Object.entries(swaps || {}).forEach(([canonical, sub]) => {
    const ing = recipe.ingredients.find(i => i.canonical === canonical);
    const names = ing
      ? [ing.name, displayName(canonical), displayName(canonical).replace(/s$/, "")]
      : [displayName(canonical)];
    steps = substituteInSteps(steps, names, sub.name).steps;
  });
  return steps;
}

function spokenMatch(m, rank) {
  const lead = rank ? `Option ${rank + 1}: ` : "Best match: ";
  let line = `${lead}${m.recipe.name}, ${m.score} percent match. `;
  if (m.missingSubstitutable.length) {
    line += `You are missing ${m.missingSubstitutable.map(displayName).join(" and ")}, ` +
      "but each one has a swap that fits your needs. ";
  } else if (m.missingHard.length) {
    line += `You still need ${m.missingHard.map(displayName).join(" and ")}. `;
  } else {
    line += "You have everything you need. ";
  }
  return line;
}

/* ------------------------------ datasources ----------------------------- */

function matchDatasource(picks, haves, excluded) {
  return {
    cookalongData: {
      properties: {
        title: "WHAT'S IN MY KITCHEN",
        subtitle: `With ${haves.map(displayName).join(", ")}`,
        profileNote: excluded.length ? `${excluded.length} recipe${excluded.length > 1 ? "s" : ""} hidden by your diet/allergies` : "",
        matches: picks.map((m, i) => ({
          rank: i + 1,
          score: m.score,
          name: m.recipe.name,
          meta: `${m.recipe.prepTimeMinutes} min · serves ${m.recipe.serves} · ${m.recipe.steps.length} steps`,
          ready: m.missingHard.length === 0 && m.missingSubstitutable.length === 0,
          status: m.missingHard.length === 0 && m.missingSubstitutable.length === 0
            ? "Ready to cook"
            : m.missingSubstitutable.length
              ? `Swap ${m.missingSubstitutable.map(displayName).join(", ")}`
              : `Need ${m.missingHard.map(displayName).join(", ")}`,
          best: i === 0
        }))
      }
    }
  };
}

function cookingDatasource(recipe, stepIndex, swaps, hint) {
  const steps = rewrittenSteps(recipe, swaps);
  return {
    cookalongData: {
      properties: {
        recipeName: recipe.name,
        stepLabel: `Step ${stepIndex + 1} of ${steps.length}`,
        stepText: steps[stepIndex],
        progress: (stepIndex + 1) / steps.length,
        hint: hint || 'Say "next step", "repeat", or "set a timer for 5 minutes".'
      }
    }
  };
}

function swapDatasource(ingredient, sub, profile) {
  const safe = [];
  if (profile.diets.length) safe.push(profile.diets.join("/"));
  if (profile.allergens.length) safe.push(`no ${profile.allergens.join(", no ")}`);
  return {
    cookalongData: {
      properties: {
        fromName: ingredient.name,
        toName: sub.name,
        note: sub.note,
        safeNote: safe.length ? `Verified compatible: ${safe.join(" · ")}` : ""
      }
    }
  };
}

/* -------------------------------- launch -------------------------------- */

function buildLaunch(session) {
  session.recipeId = null;
  session.step = 0;
  return {
    speech:
      `<speak>Welcome to CookAlong TV <break time="200ms"/> I know ${RECIPES.length} hands-free recipes. ` +
      `Say a dish, like <break time="80ms"/> cook tomato basil pasta, ` +
      `or tell me what is in your fridge, like <break time="80ms"/> I have chicken and rice.${profileClause(session)}</speak>`,
    reprompt: "Tell me a recipe, or the ingredients you have."
  };
}

/* ----------------------------- start cooking ---------------------------- */

function buildStartCooking(slot, session) {
  let name = slot || "";
  if (/\b(it|this|that|one)\b/.test(name.toLowerCase()) &&
      Array.isArray(session.matchIds) && session.matchIds.length) {
    name = session.matchIds[session.matchIndex || 0];
  }
  if (!name) {
    return { speech: "<speak>Which recipe would you like to cook?</speak>", reprompt: "Tell me a recipe name." };
  }
  const recipe = getRecipe(name);
  if (!recipe) {
    return {
      speech: `<speak>I couldn't find a recipe called ${name}. Try another name.</speak>`,
      reprompt: "Which recipe would you like to cook?"
    };
  }
  const p = profileOf(session);
  if (!recipeSatisfies(recipe, p)) {
    return {
      speech: `<speak>${recipe.name} doesn't fit your current diet or allergies. Try another match.</speak>`,
      reprompt: "Tell me your ingredients for a fresh match."
    };
  }
  session.recipeId = recipe.id;
  session.step = 0;
  session.swaps = {};
  session.awaitingCook = false;
  return {
    speech: `<speak>Starting ${recipe.name}. ${recipe.prepTimeMinutes} minutes, serves ${recipe.serves}. ` +
      `<break time="180ms"/>${formatStep(recipe, 1)}</speak>`,
    reprompt: 'Say "next step" when you are ready.',
    document: APL.cooking,
    datasource: cookingDatasource(recipe, 0, session.swaps)
  };
}

function recipeSatisfies(recipe, profile) {
  const dietsOk = profile.diets.every(d => recipe.diet.includes(d));
  return dietsOk; // allergen check for full recipes lives in the engine match path
}

/* ------------------------------ smart match ----------------------------- */

function buildWhatDoIHave(raw, session) {
  const { recognized, unknown } = parseIngredientList(raw || "");
  if (!recognized.length) {
    return {
      speech: "<speak>Which ingredients do you have? For example, I have chicken, rice and garlic.</speak>",
      reprompt: "List a few ingredients you have."
    };
  }
  const profile = profileOf(session);
  const { matches, excluded } = matchRecipesWithExclusions(recognized, RECIPES, profile);
  const picks = matches.filter(m => m.score >= MATCH_FLOOR).slice(0, MATCH_LIMIT);

  if (!picks.length) {
    return {
      speech: `<speak>With ${recognized.map(displayName).join(" and ")}, nothing reaches a good match yet. ` +
        "Add a staple like rice, pasta or tofu and ask again.</speak>",
      reprompt: "Tell me another ingredient you have."
    };
  }
  session.lastHaves = recognized;
  session.matchIndex = 0;
  session.matchIds = picks.map(m => m.recipe.id);
  session.awaitingCook = true;

  const tail = picks.length > 1
    ? ' Say "what else" for more, or "cook it" to start.'
    : ' Say "cook it" to start.';
  const unknownLine = unknown.length ? ` I did not recognize ${unknown.join(", ")}.` : "";
  const excludedLine = excluded.length
    ? ` <break time="120ms"/>${excluded.length} recipe${excluded.length > 1 ? "s were" : " was"} hidden for your diet or allergies.` : "";
  return {
    speech: `<speak>${spokenMatch(picks[0], 0)}${excludedLine}${unknownLine}${tail}</speak>`,
    reprompt: 'Say "cook it", "what else", or add ingredients.',
    document: APL.matchResults,
    datasource: matchDatasource(picks, recognized, excluded)
  };
}

function buildNextMatch(session) {
  if (!Array.isArray(session.matchIds) || !session.matchIds.length) {
    return { speech: "<speak>Tell me your ingredients first, for example, I have mushrooms and rice.</speak>" };
  }
  const profile = profileOf(session);
  // Recompute the full list so the screen keeps all options and highlights
  // the one currently being spoken.
  const { matches, excluded } = matchRecipesWithExclusions(session.lastHaves || [], RECIPES, profile);
  const picks = matches.filter(m => m.score >= MATCH_FLOOR).slice(0, MATCH_LIMIT);
  if (!picks.length) {
    return { speech: "<speak>There are no other matches right now. Add another ingredient.</speak>" };
  }
  session.matchIndex = ((session.matchIndex || 0) + 1) % picks.length;
  const current = picks[session.matchIndex];
  session.matchIds = picks.map(m => m.recipe.id);
  const ordered = picks.map((m, i) => i === session.matchIndex ? m : m);
  return {
    speech: `<speak>${spokenMatch(current, session.matchIndex)} Say "cook it" or "what else".</speak>`,
    reprompt: 'Say "cook it" or "what else".',
    document: APL.matchResults,
    datasource: matchDatasourceWithBest(ordered, session.lastHaves, excluded, session.matchIndex)
  };
}

// Like matchDatasource but the highlighted row is an explicit best index.
function matchDatasourceWithBest(picks, haves, excluded, bestIndex) {
  const ds = matchDatasource(picks, haves, excluded);
  ds.cookalongData.properties.matches.forEach((row, i) => { row.best = i === bestIndex; });
  return ds;
}

/* ------------------------------- swaps ---------------------------------- */

function buildSubstitute(raw, session) {
  const recipe = session.recipeId ? getRecipe(session.recipeId) : null;
  if (!recipe) {
    return {
      speech: "<speak>Start a recipe first, then I can suggest swaps. Say cook tomato basil pasta to begin.</speak>",
      reprompt: "Which recipe would you like to cook?"
    };
  }
  const canonical = normalizeIngredient(raw || "");
  const ing = canonical && recipe.ingredients.find(i => i.canonical === canonical);
  if (!ing) {
    return {
      speech: `<speak>${recipe.name} doesn't use ${raw || "that"}. Name the ingredient you are missing.</speak>`,
      reprompt: "Which ingredient are you missing?"
    };
  }
  const profile = profileOf(session);
  const sub = findSubstitute(recipe, canonical, profile);
  if (!sub) {
    return {
      speech: `<speak>There is no safe substitute for ${ing.name} that fits your diet and allergies; it is essential to this dish.</speak>`
    };
  }
  session.swaps = session.swaps || {};
  session.swaps[canonical] = sub;
  const why = profile.diets.length || profile.allergens.length
    ? ` This keeps the dish ${[...profile.diets, ...profile.allergens.map(a => `no ${a}`)].join(" and ")}.` : "";
  return {
    speech: `<speak>No problem. Replace ${ing.name} with ${sub.name}. <break time="140ms"/>${sub.note}${why} Say next step to keep cooking.</speak>`,
    reprompt: 'Say "next step" to continue.',
    document: APL.swapConfirm,
    datasource: swapDatasource(ing, sub, profile),
    // also refresh the cooking screen after this turn is acknowledged
    followUpCooking: true
  };
}

/* ------------------------- exclude / re-rank ---------------------------- */

function buildExclude(raw, session) {
  const canonical = normalizeIngredient(raw || "");
  if (!canonical) return { speech: "<speak>Which ingredient should I exclude?</speak>" };
  session.excludes = Array.isArray(session.excludes) ? session.excludes : [];
  if (!session.excludes.includes(canonical)) session.excludes.push(canonical);
  const profile = profileOf(session);
  const { matches } = matchRecipesWithExclusions(session.lastHaves || [], RECIPES, profile);
  const picks = matches
    .filter(m => m.score >= MATCH_FLOOR)
    .filter(m => !m.recipe.ingredients.some(i => session.excludes.includes(i.canonical)))
    .slice(0, MATCH_LIMIT);
  session.matchIds = picks.map(m => m.recipe.id);
  session.matchIndex = 0;
  if (!picks.length) {
    return { speech: `<speak>Excluding ${displayName(canonical)}, I have no matching recipes. Try removing a restriction.</speak>` };
  }
  return {
    speech: `<speak>Okay, no ${displayName(canonical)}. ${picks.length ? spokenMatch(picks[0], 0) : ""} Say cook it or what else.</speak>`,
    reprompt: 'Say "cook it" or "what else".',
    document: picks.length ? APL.matchResults : undefined,
    datasource: picks.length ? matchDatasource(picks, session.lastHaves || [], []) : undefined
  };
}

/* ------------------------------ step flow ------------------------------- */

function buildNextStep(session) {
  const recipe = session.recipeId ? getRecipe(session.recipeId) : null;
  if (!recipe) {
    return { speech: "<speak>You have not started a recipe yet. Say cook tomato basil pasta to begin.</speak>", reprompt: "Say start cooking to begin." };
  }
  const steps = rewrittenSteps(recipe, session.swaps);
  if (session.step >= steps.length - 1) {
    return { speech: `<speak>That was the last step. Enjoy your ${recipe.name}! Say start over to cook again.</speak>` };
  }
  session.step += 1;
  return {
    speech: `<speak>Step ${session.step + 1} of ${steps.length}: ${steps[session.step]}</speak>`,
    reprompt: 'Say "next step" when ready.',
    document: APL.cooking,
    datasource: cookingDatasource(recipe, session.step, session.swaps)
  };
}

function buildPreviousStep(session) {
  const recipe = session.recipeId ? getRecipe(session.recipeId) : null;
  if (!recipe) {
    return { speech: "<speak>You have not started a recipe yet. Say cook tomato basil pasta to begin.</speak>", reprompt: "Say start cooking to begin." };
  }
  const steps = rewrittenSteps(recipe, session.swaps);
  if (session.step <= 0) {
    return {
      speech: `<speak>This is the first step already. ${steps[0]}</speak>`,
      reprompt: 'Say "next step" when ready.',
      document: APL.cooking,
      datasource: cookingDatasource(recipe, 0, session.swaps)
    };
  }
  session.step -= 1;
  return {
    speech: `<speak>Step ${session.step + 1} of ${steps.length}: ${steps[session.step]}</speak>`,
    reprompt: 'Say "next step" when ready.',
    document: APL.cooking,
    datasource: cookingDatasource(recipe, session.step, session.swaps)
  };
}

function buildRepeatStep(session) {
  const recipe = session.recipeId ? getRecipe(session.recipeId) : null;
  if (!recipe) return { speech: "<speak>You have not started a recipe yet.</speak>" };
  const steps = rewrittenSteps(recipe, session.swaps);
  return {
    speech: `<speak>Step ${session.step + 1} of ${steps.length}: ${steps[session.step]}</speak>`,
    document: APL.cooking,
    datasource: cookingDatasource(recipe, session.step, session.swaps)
  };
}

/* ------------------------------- profile -------------------------------- */

function buildSetProfile(dietSlot, allergenSlot, session, removing = false) {
  const before = profileOf(session);
  const diet = (dietSlot || "").toLowerCase().trim();
  const allergen = (allergenSlot || "").toLowerCase().trim();
  session.diets = session.diets || [];
  session.allergens = session.allergens || [];
  const spoken = [];
  if (diet) {
    if (removing) session.diets = session.diets.filter(d => d !== diet);
    else if (!session.diets.includes(diet)) session.diets.push(diet);
    spoken.push(diet);
  }
  if (allergen) {
    if (removing) session.allergens = session.allergens.filter(a => a !== allergen);
    else if (!session.allergens.includes(allergen)) session.allergens.push(allergen);
    spoken.push(`no ${allergen}`);
  }
  if (!spoken.length) {
    return { speech: "<speak>I can remember your diet and allergies. For example, I am vegan, or I am allergic to dairy.</speak>" };
  }
  const after = profileOf(session);
  const verb = removing ? "removed" : "saved";
  return {
    speech: `<speak>Got it, ${verb}: ${spoken.join(" and ")}. Every match and swap will respect that. ` +
      `Right now you are ${after.diets.join(", ") || "on no special diet"}` +
      (after.allergens.length ? `, avoiding ${after.allergens.join(", ")}.` : ".") + "</speak>",
    reprompt: "Tell me your ingredients to find a match."
  };
}

/* --------------------------------- help --------------------------------- */

const HELP_SPEECH =
  "<speak>CookAlong TV helps you cook hands-free. Say I have chicken and rice to find a match, " +
  "cook tomato basil pasta to start, I am vegan to set your diet, I do not have parmesan for a smart swap, " +
  "next step to continue, or set a timer for 5 minutes.</speak>";

const FALLBACK_SPEECH =
  "<speak>I didn't catch that. Try I have chicken and rice, cook tomato basil pasta, I am vegan, " +
  "I do not have parmesan, next step, or set a timer for 5 minutes.</speak>";

module.exports = {
  APL,
  buildLaunch,
  buildStartCooking,
  buildWhatDoIHave,
  buildNextMatch,
  buildSubstitute,
  buildExclude,
  buildNextStep,
  buildPreviousStep,
  buildRepeatStep,
  buildSetProfile,
  rewrittenSteps,
  matchDatasource,
  cookingDatasource,
  swapDatasource,
  profileOf,
  HELP_SPEECH,
  FALLBACK_SPEECH
};
