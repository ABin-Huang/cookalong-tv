"use strict";

/**
 * CookAlong TV — Alexa skill entry point (ASK glue only).
 *
 * The conversation logic — speech, reprompts, APL documents and session
 * mutations — lives in responses.js, which has no ASK dependency and is unit
 * testable in plain Node. This file only maps request envelopes onto it.
 *
 * Every intent declared in models/en-US.json MUST have a handler here. An
 * intent that is declared but unhandled reaches the ErrorHandler and answers
 * "Sorry, something went wrong", which is exactly how the whole "what's in my
 * kitchen" half of this skill was silently dead: responses.js implemented it,
 * but nothing required responses.js. test/skill-contract.test.js now guards
 * that boundary, so the two can no longer drift apart unnoticed.
 */

const Alexa = require("ask-sdk-core");
const R = require("./responses");
const { listRecipes, getRecipe } = require("../src/recipes");
const { parseDuration, stepDurationSeconds, Timer } = require("../src/timer");

const SESSION_STATE_KEY = "cookalong";

function state(handlerInput) {
  const attrs = handlerInput.attributesManager.getSessionAttributes();
  if (!attrs[SESSION_STATE_KEY]) attrs[SESSION_STATE_KEY] = {};
  return attrs[SESSION_STATE_KEY];
}

function slot(handlerInput, name) {
  return Alexa.getSlotValue(handlerInput.requestEnvelope, name);
}

function supportsAPL(handlerInput) {
  const interfaces = Alexa.getSupportedInterfaces(handlerInput.requestEnvelope) || {};
  return Boolean(interfaces["Alexa.Presentation.APL"]);
}

/** Turn a responses.js result into an ASK response, adding APL when it can render. */
function respond(handlerInput, out) {
  const builder = handlerInput.responseBuilder.speak(out.speech);
  if (out.reprompt) builder.reprompt(out.reprompt);
  if (out.document && supportsAPL(handlerInput)) {
    builder.addDirective({
      type: "Alexa.Presentation.APL.RenderDocument",
      token: "cookalong",
      document: out.document,
      datasources: out.datasource || {}
    });
  }
  return builder.getResponse();
}

/** One handler per intent name — keeps the request routing obvious and greppable. */
function intentHandler(names, handle) {
  const wanted = Array.isArray(names) ? names : [names];
  return {
    canHandle(handlerInput) {
      return Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
        wanted.includes(Alexa.getIntentName(handlerInput.requestEnvelope));
    },
    handle
  };
}

/* -------------------------------- launch -------------------------------- */

const LaunchRequestHandler = {
  canHandle(handlerInput) { return Alexa.getRequestType(handlerInput.requestEnvelope) === "LaunchRequest"; },
  handle(handlerInput) { return respond(handlerInput, R.buildLaunch(state(handlerInput))); }
};

/* ----------------------------- cooking flow ----------------------------- */

const StartCookingIntentHandler = intentHandler("StartCookingIntent", handlerInput => {
  const s = state(handlerInput);
  let name = slot(handlerInput, "recipe");
  // "cook it" said right after a match, with the slot left unfilled
  if (!name && s.awaitingCook && Array.isArray(s.matchIds) && s.matchIds.length) {
    name = s.matchIds[s.matchIndex || 0];
  }
  return respond(handlerInput, R.buildStartCooking(name, s));
});

const NextStepIntentHandler = intentHandler("NextStepIntent", handlerInput =>
  respond(handlerInput, R.buildNextStep(state(handlerInput))));

const PreviousStepIntentHandler = intentHandler("PreviousStepIntent", handlerInput =>
  respond(handlerInput, R.buildPreviousStep(state(handlerInput))));

const RepeatStepIntentHandler = intentHandler("RepeatStepIntent", handlerInput =>
  respond(handlerInput, R.buildRepeatStep(state(handlerInput))));

/* ----------------------------- smart match ------------------------------ */

const WhatDoIHaveIntentHandler = intentHandler("WhatDoIHaveIntent", handlerInput =>
  respond(handlerInput, R.buildWhatDoIHave(slot(handlerInput, "ingredients"), state(handlerInput))));

const NextMatchIntentHandler = intentHandler("NextMatchIntent", handlerInput =>
  respond(handlerInput, R.buildNextMatch(state(handlerInput))));

const SubstituteIntentHandler = intentHandler("SubstituteIntent", handlerInput => {
  const s = state(handlerInput);
  const out = R.buildSubstitute(slot(handlerInput, "ingredient"), s);
  // The whole point of a swap is that you SEE the step text change, so put the
  // cooking screen back up with the rewritten step instead of leaving the
  // confirmation card on screen.
  const recipe = s.recipeId ? getRecipe(s.recipeId) : null;
  if (out.followUpCooking && recipe) {
    out.document = R.APL.cooking;
    out.datasource = R.cookingDatasource(recipe, s.step, s.swaps, "Your swap is applied — the step text above is updated.");
  }
  return respond(handlerInput, out);
});

const ExcludeIngredientIntentHandler = intentHandler("ExcludeIngredientIntent", handlerInput =>
  respond(handlerInput, R.buildExclude(slot(handlerInput, "ingredient"), state(handlerInput))));

/* -------------------------------- profile ------------------------------- */

const SetProfileIntentHandler = intentHandler("SetProfileIntent", handlerInput =>
  respond(handlerInput, R.buildSetProfile(
    slot(handlerInput, "diet"), slot(handlerInput, "allergen"), state(handlerInput))));

const ClearProfileIntentHandler = intentHandler("ClearProfileIntent", handlerInput => {
  const s = state(handlerInput);
  const had = [...(s.diets || []), ...(s.allergens || []).map(a => `no ${a}`)];
  s.diets = [];
  s.allergens = [];
  return respond(handlerInput, {
    speech: had.length
      ? `<speak>Cleared ${had.join(", ")}. Every recipe is back on the table.</speak>`
      : "<speak>You have no diet or allergy saved right now.</speak>",
    reprompt: "Tell me your ingredients to find a match."
  });
});

const DietFilterIntentHandler = intentHandler("DietFilterIntent", handlerInput => {
  const diet = (slot(handlerInput, "diet") || "").toLowerCase().trim();
  if (!diet) {
    return respond(handlerInput, {
      speech: "<speak>Which diet? Vegetarian, vegan, or gluten-free.</speak>",
      reprompt: "Vegetarian, vegan, or gluten-free?"
    });
  }
  const matches = listRecipes(diet);
  if (!matches.length) {
    return respond(handlerInput, { speech: `<speak>I don't have ${diet} recipes right now.</speak>` });
  }
  return respond(handlerInput, {
    speech: `<speak>${matches.length} ${diet} recipes: ${matches.map(m => m.name).join(", ")}. Say one to start cooking.</speak>`,
    reprompt: "Which one would you like to cook?"
  });
});

/* --------------------------------- timer -------------------------------- */
/**
 * The timer follows the recipe: with no duration slot we fall back to the time
 * the CURRENT STEP names ("cover and cook on low for 18 minutes").
 *
 * Known limitation, deliberately not papered over: a Lambda invocation cannot
 * ring later, so this acknowledges the timer but nothing fires when it ends. A
 * real alert needs the Alexa Timers/Reminders API, or the on-screen timer in
 * the Fire TV app. Logged as friction for the Amazon team.
 */
const SetTimerIntentHandler = intentHandler("SetTimerIntent", handlerInput => {
  const s = state(handlerInput);
  let seconds = parseDuration(slot(handlerInput, "duration") || "");
  let fromStep = false;
  if (!seconds) {
    const recipe = s.recipeId ? getRecipe(s.recipeId) : null;
    if (recipe) {
      const steps = R.rewrittenSteps(recipe, s.swaps);
      seconds = stepDurationSeconds(steps[s.step] || "");
      fromStep = Boolean(seconds);
    }
  }
  if (!seconds) {
    return respond(handlerInput, {
      speech: "<speak>I didn't catch the time. Say something like, set a timer for 5 minutes.</speak>",
      reprompt: "How long should the timer be?"
    });
  }
  const timer = new Timer(seconds);
  s.timer = timer.toJSON();
  const lead = fromStep ? `This step takes about ${timer.speak()}. ` : "";
  return respond(handlerInput, {
    speech: `<speak>${lead}Timer set for ${timer.speak()}. Say "cancel timer" to stop it.</speak>`
  });
});

const CancelTimerIntentHandler = intentHandler("CancelTimerIntent", handlerInput => {
  state(handlerInput).timer = null;
  return respond(handlerInput, {
    speech: "<speak>Timer cancelled. Say set a timer for 5 minutes to start a new one.</speak>"
  });
});

/* ------------------------------- yes / no ------------------------------- */

const YesIntentHandler = intentHandler("AMAZON.YesIntent", handlerInput => {
  const s = state(handlerInput);
  if (s.awaitingCook && Array.isArray(s.matchIds) && s.matchIds.length) {
    return respond(handlerInput, R.buildStartCooking(s.matchIds[s.matchIndex || 0], s));
  }
  return respond(handlerInput, { speech: R.HELP_SPEECH, reprompt: "What would you like to cook?" });
});

const NoIntentHandler = intentHandler("AMAZON.NoIntent", handlerInput => {
  const s = state(handlerInput);
  if (s.awaitingCook) return respond(handlerInput, R.buildNextMatch(s));
  return respond(handlerInput, { speech: "<speak>Okay. Say cook tomato basil pasta whenever you are ready.</speak>" });
});

/* --------------------------------- help --------------------------------- */

const HelpIntentHandler = intentHandler("AMAZON.HelpIntent", handlerInput =>
  respond(handlerInput, { speech: R.HELP_SPEECH, reprompt: "What would you like to cook?" }));

const CancelAndStopIntentHandler = intentHandler(["AMAZON.CancelIntent", "AMAZON.StopIntent"], handlerInput =>
  respond(handlerInput, { speech: "<speak>Goodbye! Enjoy your cooking.</speak>" }));

const FallbackIntentHandler = intentHandler("AMAZON.FallbackIntent", handlerInput =>
  respond(handlerInput, { speech: R.FALLBACK_SPEECH, reprompt: "What would you like to do?" }));

/* ------------------------------ plumbing -------------------------------- */

const SessionEndedRequestHandler = {
  canHandle(handlerInput) { return Alexa.getRequestType(handlerInput.requestEnvelope) === "SessionEndedRequest"; },
  handle(handlerInput) { return handlerInput.responseBuilder.getResponse(); }
};

const ErrorHandler = {
  canHandle() { return true; },
  handle(handlerInput, error) {
    // If any intent declared in the interaction model lands here, the contract
    // test fails — that is the point of the test.
    console.error(`Error handled: ${error.message}`);
    return handlerInput.responseBuilder
      .speak("Sorry, something went wrong. Please try again.")
      .reprompt("Please try again.")
      .getResponse();
  }
};

exports.handler = Alexa.SkillBuilders.custom()
  .addRequestHandlers(
    LaunchRequestHandler,
    StartCookingIntentHandler,
    NextStepIntentHandler,
    PreviousStepIntentHandler,
    RepeatStepIntentHandler,
    WhatDoIHaveIntentHandler,
    NextMatchIntentHandler,
    SubstituteIntentHandler,
    ExcludeIngredientIntentHandler,
    SetProfileIntentHandler,
    ClearProfileIntentHandler,
    DietFilterIntentHandler,
    SetTimerIntentHandler,
    CancelTimerIntentHandler,
    YesIntentHandler,
    NoIntentHandler,
    HelpIntentHandler,
    CancelAndStopIntentHandler,
    FallbackIntentHandler,
    SessionEndedRequestHandler
  )
  .addErrorHandlers(ErrorHandler)
  .lambda();
