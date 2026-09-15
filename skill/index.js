"use strict";

/**
 * CookAlong TV — Alexa Skills Kit skill backend (Node.js / AWS Lambda).
 * Handles launch, step navigation, smart timers, dietary filtering AND the
 * 2.0 "ingredient-aware" flows:
 *   - WhatDoIHaveIntent  ("i have chicken, rice and onion") -> scored matches
 *   - NextMatchIntent    ("what else") -> cycle through matches
 *   - SubstituteIntent   ("i don't have parmesan") -> smart swap advice
 *   - ExcludeIngredientIntent ("without onion") -> re-rank excluding it
 * Deploy as an AWS Lambda function using the ASK Node.js SDK.
 */

const Alexa = require("ask-sdk-core");
const { RECIPES, listRecipes, getRecipe, formatStep } = require("../src/recipes");
const { parseDuration, Timer } = require("../src/timer");
const {
  parseIngredientList,
  normalizeIngredient,
  matchRecipes,
  findSubstitute,
  displayName
} = require("../src/ingredients");

const SESSION_STATE_KEY = "cookalong";

function state(handlerInput) {
  const attrs = handlerInput.attributesManager.getSessionAttributes();
  if (!attrs[SESSION_STATE_KEY]) attrs[SESSION_STATE_KEY] = {};
  return attrs[SESSION_STATE_KEY];
}

function speakRecipeIntro(recipe) {
  return `${recipe.name}. ${recipe.prepTimeMinutes} minutes, serves ${recipe.serves}. ` +
    `You can say "next step", "set a timer for 5 minutes", or "what step am I on".`;
}

function listNames() {
  return listRecipes().map(m => m.name).join(", ");
}

/** Spoken summary of one scored match. */
function speakMatch(m, rank) {
  const prefix = rank ? `Option ${rank + 1}: ` : "Best match: ";
  let line = `${prefix}${m.recipe.name}, ${m.score} percent match. `;
  if (m.missingSubstitutable.length) {
    const swaps = m.missingSubstitutable.slice(0, 2).map(c => {
      const sub = findSubstitute(m.recipe, c);
      return `swap ${displayName(c)} for ${sub ? sub.name : "another ingredient"}`;
    });
    line += `You are missing ${m.missingSubstitutable.map(displayName).join(" and ")}, but you can ${swaps.join(" and ")}. `;
  } else if (m.missingHard.length) {
    line += `You still need ${m.missingHard.map(displayName).join(" and ")}. `;
  } else {
    line += "You have everything you need. ";
  }
  return line;
}

/* ---------- intents ---------- */

const LaunchRequestHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === "LaunchRequest";
  },
  handle(handlerInput) {
    const s = state(handlerInput);
    s.recipeId = null;
    s.step = 0;
    return handlerInput.responseBuilder
      .speak(`Welcome to CookAlong TV! I know ${RECIPES.length} recipes. ` +
        `Say "cook tomato basil pasta", tell me what is in your fridge, like "I have chicken and rice", ` +
        `or say "what can I make".`)
      .reprompt("Tell me a recipe, or the ingredients you have.")
      .getResponse();
  }
};

const StartCookingIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === "StartCookingIntent";
  },
  handle(handlerInput) {
    const s = state(handlerInput);
    let slot = Alexa.getSlotValue(handlerInput.requestEnvelope, "recipe");

    // "cook it / this one" refers to the current smart-match result.
    if (slot && /\b(it|this|that|one)\b/.test(slot.toLowerCase()) &&
        Array.isArray(s.matchIds) && s.matchIds.length) {
      slot = s.matchIds[s.matchIndex || 0];
    }
    if (!slot) {
      return handlerInput.responseBuilder
        .speak("Which recipe would you like to cook?")
        .reprompt("Tell me a recipe name, like tomato basil pasta.")
        .getResponse();
    }
    const recipe = getRecipe(slot);
    if (!recipe) {
      return handlerInput.responseBuilder
        .speak(`I couldn't find a recipe called ${slot}. You can choose from ${listNames()}.`)
        .reprompt("Which recipe would you like to cook?")
        .getResponse();
    }
    s.recipeId = recipe.id;
    s.step = 0;
    return handlerInput.responseBuilder
      .speak(`Starting ${speakRecipeIntro(recipe)} ${formatStep(recipe, 1)}`)
      .reprompt("Say next step when you are ready.")
      .getResponse();
  }
};

/* ---------- 2.0: ingredient-aware matching ---------- */

const WhatDoIHaveIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === "WhatDoIHaveIntent";
  },
  handle(handlerInput) {
    const s = state(handlerInput);
    const raw = Alexa.getSlotValue(handlerInput.requestEnvelope, "ingredients") || "";
    const { recognized, unknown } = parseIngredientList(raw);
    if (!recognized.length) {
      return handlerInput.responseBuilder
        .speak("Which ingredients do you have? For example, I have chicken, rice and garlic.")
        .reprompt("List a few ingredients you have.")
        .getResponse();
    }
    const matches = matchRecipes(recognized, RECIPES)
      .filter(m => m.score >= 40)
      .slice(0, 3);
    s.lastHaves = recognized;
    s.matchIndex = 0;
    s.matchIds = matches.map(m => m.recipe.id);

    if (!matches.length) {
      return handlerInput.responseBuilder
        .speak(`With ${recognized.map(displayName).join(" and ")}, nothing reaches a good match yet. ` +
          `Add a staple like rice, pasta or chicken and ask again.`)
        .reprompt("Tell me another ingredient you have.")
        .getResponse();
    }
    const tail = matches.length > 1
      ? `Say "what else" for more options, or "cook it" to start.`
      : `Say "cook it" to start.`;
    return handlerInput.responseBuilder
      .speak(`With ${recognized.map(displayName).join(", ")}: ${speakMatch(matches[0], 0)}${tail}` +
        (unknown.length ? ` I did not recognize ${unknown.join(", ")}.` : ""))
      .reprompt('Say "cook it", "what else", or add ingredients.')
      .getResponse();
  }
};

const NextMatchIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === "NextMatchIntent";
  },
  handle(handlerInput) {
    const s = state(handlerInput);
    if (!Array.isArray(s.matchIds) || !s.matchIds.length) {
      return handlerInput.responseBuilder
        .speak("Tell me your ingredients first, for example, I have mushrooms and rice.")
        .getResponse();
    }
    s.matchIndex = ((s.matchIndex || 0) + 1) % s.matchIds.length;
    const recipe = getRecipe(s.matchIds[s.matchIndex]);
    const match = matchRecipes(s.lastHaves || [], [recipe])[0];
    return handlerInput.responseBuilder
      .speak(`${speakMatch(match, s.matchIndex)} Say "cook it" or "what else".`)
      .reprompt('Say "cook it" or "what else".')
      .getResponse();
  }
};

const SubstituteIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === "SubstituteIntent";
  },
  handle(handlerInput) {
    const s = state(handlerInput);
    const recipe = s.recipeId ? getRecipe(s.recipeId) : null;
    if (!recipe) {
      return handlerInput.responseBuilder
        .speak("Start a recipe first, then I can suggest swaps. Say cook tomato basil pasta to begin.")
        .reprompt("Which recipe would you like to cook?")
        .getResponse();
    }
    const raw = Alexa.getSlotValue(handlerInput.requestEnvelope, "ingredient") || "";
    const canonical = normalizeIngredient(raw);
    const ing = canonical && recipe.ingredients.find(i => i.canonical === canonical);
    if (!ing) {
      return handlerInput.responseBuilder
        .speak(`${recipe.name} does not use ${raw || "that"}. Say the ingredient you are missing.`)
        .reprompt("Which ingredient are you missing?")
        .getResponse();
    }
    const sub = findSubstitute(recipe, canonical);
    if (!sub) {
      return handlerInput.responseBuilder
        .speak(`There is no good substitute for ${ing.name}; it is essential to this dish.`)
        .getResponse();
    }
    return handlerInput.responseBuilder
      .speak(`No problem. Replace ${ing.name} with ${sub.name}. ${sub.note} Say next step to keep cooking.`)
      .reprompt("Say next step to continue.")
      .getResponse();
  }
};

const ExcludeIngredientIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === "ExcludeIngredientIntent";
  },
  handle(handlerInput) {
    const s = state(handlerInput);
    const raw = Alexa.getSlotValue(handlerInput.requestEnvelope, "ingredient") || "";
    const canonical = normalizeIngredient(raw);
    if (!canonical) {
      return handlerInput.responseBuilder.speak("Which ingredient should I exclude?").getResponse();
    }
    s.excludes = Array.isArray(s.excludes) ? s.excludes : [];
    if (!s.excludes.includes(canonical)) s.excludes.push(canonical);
    const haves = s.lastHaves || [];
    const matches = matchRecipes(haves, RECIPES)
      .filter(m => m.score >= 40)
      .filter(m => !m.recipe.ingredients.some(i => s.excludes.includes(i.canonical)))
      .slice(0, 3);
    s.matchIds = matches.map(m => m.recipe.id);
    s.matchIndex = 0;
    if (!matches.length) {
      return handlerInput.responseBuilder
        .speak(`Excluding ${displayName(canonical)}, I have no matching recipes. Try removing a restriction.`)
        .getResponse();
    }
    return handlerInput.responseBuilder
      .speak(`Okay, no ${displayName(canonical)}. ${speakMatch(matches[0], 0)} Say "cook it" or "what else".`)
      .reprompt('Say "cook it" or "what else".')
      .getResponse();
  }
};

const NextStepIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === "NextStepIntent";
  },
  handle(handlerInput) {
    const s = state(handlerInput);
    const recipe = s.recipeId ? getRecipe(s.recipeId) : null;
    if (!recipe) {
      return handlerInput.responseBuilder
        .speak("You haven't started a recipe yet. Say cook tomato basil pasta to begin.")
        .reprompt("Say start cooking to begin a recipe.")
        .getResponse();
    }
    if (s.step >= recipe.steps.length - 1) {
      return handlerInput.responseBuilder
        .speak(`That was the last step. Enjoy your ${recipe.name}! Say "start over" to cook again.`)
        .getResponse();
    }
    s.step += 1;
    return handlerInput.responseBuilder
      .speak(formatStep(recipe, s.step + 1))
      .reprompt("Say next step when you are ready.")
      .getResponse();
  }
};

const RepeatStepIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === "RepeatStepIntent";
  },
  handle(handlerInput) {
    const s = state(handlerInput);
    const recipe = s.recipeId ? getRecipe(s.recipeId) : null;
    if (!recipe) return handlerInput.responseBuilder.speak("You haven't started a recipe yet.").getResponse();
    return handlerInput.responseBuilder.speak(formatStep(recipe, s.step + 1)).getResponse();
  }
};

const SetTimerIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === "SetTimerIntent";
  },
  handle(handlerInput) {
    const durationText = Alexa.getSlotValue(handlerInput.requestEnvelope, "duration");
    const seconds = parseDuration(durationText || "");
    if (!seconds) {
      return handlerInput.responseBuilder
        .speak("I didn't catch the time. Say something like, set a timer for 5 minutes.")
        .reprompt("How long should the timer be?")
        .getResponse();
    }
    const timer = new Timer(seconds);
    timer.start();
    return handlerInput.responseBuilder
      .speak(`Timer set for ${timer.speak()}. Say "cancel timer" to stop it.`)
      .getResponse();
  }
};

const CancelTimerIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === "CancelTimerIntent";
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak("Timer cancelled. Say set a timer for 5 minutes to start a new one.")
      .getResponse();
  }
};

const DietFilterIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === "DietFilterIntent";
  },
  handle(handlerInput) {
    const diet = Alexa.getSlotValue(handlerInput.requestEnvelope, "diet");
    if (!diet) {
      return handlerInput.responseBuilder.speak("Which diet? Vegetarian, vegan, or gluten-free.").getResponse();
    }
    const matches = listRecipes(diet);
    if (!matches.length) {
      return handlerInput.responseBuilder
        .speak(`Sorry, I don't have ${diet} recipes right now.`)
        .getResponse();
    }
    const names = matches.map(m => m.name).join(", ");
    return handlerInput.responseBuilder
      .speak(`Here are the ${diet} recipes: ${names}. Say one to start cooking.`)
      .getResponse();
  }
};

const HelpIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === "AMAZON.HelpIntent";
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak("CookAlong TV helps you cook hands-free. Say I have chicken and rice to find a match, " +
        "cook tomato basil pasta to start, I don't have parmesan for a smart swap, " +
        "next step to continue, or set a timer for 5 minutes.")
      .reprompt("What would you like to cook?")
      .getResponse();
  }
};

const CancelAndStopIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      (Alexa.getIntentName(handlerInput.requestEnvelope) === "AMAZON.CancelIntent" ||
        Alexa.getIntentName(handlerInput.requestEnvelope) === "AMAZON.StopIntent");
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak("Goodbye! Enjoy your cooking.")
      .getResponse();
  }
};

const SessionEndedRequestHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === "SessionEndedRequest";
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder.getResponse();
  }
};

const FallbackIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === "AMAZON.FallbackIntent";
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak("I didn't understand that. Try I have chicken and rice, cook tomato basil pasta, " +
        "I don't have parmesan, next step, or set a timer for 5 minutes.")
      .reprompt("What would you like to do?")
      .getResponse();
  }
};

/* ---------- error handler ---------- */

const ErrorHandler = {
  canHandle() {
    return true;
  },
  handle(handlerInput, error) {
    console.error(`Error handled: ${error.message}`);
    return handlerInput.responseBuilder
      .speak("Sorry, something went wrong. Please try again.")
      .reprompt("Please try again.")
      .getResponse();
  }
};

/* ---------- skill entry ---------- */

exports.handler = Alexa.SkillBuilders.custom()
  .addRequestHandlers(
    LaunchRequestHandler,
    StartCookingIntentHandler,
    WhatDoIHaveIntentHandler,
    NextMatchIntentHandler,
    SubstituteIntentHandler,
    ExcludeIngredientIntentHandler,
    NextStepIntentHandler,
    RepeatStepIntentHandler,
    SetTimerIntentHandler,
    CancelTimerIntentHandler,
    DietFilterIntentHandler,
    HelpIntentHandler,
    CancelAndStopIntentHandler,
    FallbackIntentHandler,
    SessionEndedRequestHandler
  )
  .addErrorHandlers(ErrorHandler)
  .lambda();
