"use strict";

/**
 * CookAlong TV — Alexa skill (ASK SDK v2, AWS Lambda ready).
 *
 * Thin ASK glue: all conversation logic, SSML and APL datasources live in
 * ./responses.js (unit-tested without the SDK). This file handles:
 *   - request/response interceptors (session state + persistent profile)
 *   - intent routing
 *   - Alexa.Presentation.APL.RenderDocument directives for Fire TV / Echo Show
 *   - optional DynamoDB-backed profile persistence (set DYNAMODB_TABLE)
 *
 * Deploy: see skill/DEPLOY.md.
 */

const Alexa = require("ask-sdk-core");
const { listRecipes } = require("../src/recipes");
const { parseDuration, Timer } = require("../src/timer");
const R = require("./responses");

const SESSION_KEY = "cookalong";
const APL_TOKEN = "cookalong-screen";

/* ------------------------------ interceptors ---------------------------- */

// Initialise session state and merge a profile remembered across sessions.
const LoadStateInterceptor = {
  async process(handlerInput) {
    const attrs = handlerInput.attributesManager.getSessionAttributes();
    if (!attrs[SESSION_KEY]) {
      const s = { recipeId: null, step: 0, swaps: {}, diets: [], allergens: [] };
      try {
        const persistent = await handlerInput.attributesManager.getPersistentAttributes();
        if (Array.isArray(persistent.diets)) s.diets = persistent.diets;
        if (Array.isArray(persistent.allergens)) s.allergens = persistent.allergens;
      } catch (_) { /* no persistence adapter: session-only profile */ }
      attrs[SESSION_KEY] = s;
      handlerInput.attributesManager.setSessionAttributes(attrs);
    }
  }
};

// Persist the cook's diet/allergen profile for future sessions.
const SaveProfileInterceptor = {
  async process(handlerInput, response) {
    if (!response) return;
    const attrs = handlerInput.attributesManager.getSessionAttributes();
    const s = attrs[SESSION_KEY];
    if (!s) return;
    try {
      handlerInput.attributesManager.setPersistentAttributes({
        diets: s.diets || [],
        allergens: s.allergens || []
      });
      await handlerInput.attributesManager.savePersistentAttributes();
    } catch (_) { /* persistence is optional */ }
  }
};

function state(handlerInput) {
  return handlerInput.attributesManager.getSessionAttributes()[SESSION_KEY];
}

function slotValue(handlerInput, name) {
  return Alexa.getSlotValue(handlerInput.requestEnvelope, name);
}

/** Attach speech, reprompt and an optional APL document in one place. */
function buildResponse(handlerInput, out) {
  let rb = handlerInput.responseBuilder.speak(out.speech);
  if (out.reprompt) rb = rb.reprompt(out.reprompt);
  if (out.document) {
    rb = rb.addDirective({
      type: "Alexa.Presentation.APL.RenderDocument",
      token: APL_TOKEN,
      document: out.document,
      datasources: out.datasource
    });
  }
  return rb.getResponse();
}

/* -------------------------------- intents ------------------------------- */

const LaunchRequestHandler = {
  canHandle(h) { return Alexa.getRequestType(h.requestEnvelope) === "LaunchRequest"; },
  handle(h) { return buildResponse(h, R.buildLaunch(state(h))); }
};

const StartCookingIntentHandler = {
  canHandle(h) { return Alexa.getIntentName(h.requestEnvelope) === "StartCookingIntent"; },
  handle(h) { return buildResponse(h, R.buildStartCooking(slotValue(h, "recipe"), state(h))); }
};

const WhatDoIHaveIntentHandler = {
  canHandle(h) { return Alexa.getIntentName(h.requestEnvelope) === "WhatDoIHaveIntent"; },
  handle(h) { return buildResponse(h, R.buildWhatDoIHave(slotValue(h, "ingredients"), state(h))); }
};

const NextMatchIntentHandler = {
  canHandle(h) { return Alexa.getIntentName(h.requestEnvelope) === "NextMatchIntent"; },
  handle(h) { return buildResponse(h, R.buildNextMatch(state(h))); }
};

const SubstituteIntentHandler = {
  canHandle(h) { return Alexa.getIntentName(h.requestEnvelope) === "SubstituteIntent"; },
  handle(h) { return buildResponse(h, R.buildSubstitute(slotValue(h, "ingredient"), state(h))); }
};

const ExcludeIngredientIntentHandler = {
  canHandle(h) { return Alexa.getIntentName(h.requestEnvelope) === "ExcludeIngredientIntent"; },
  handle(h) { return buildResponse(h, R.buildExclude(slotValue(h, "ingredient"), state(h))); }
};

const NextStepIntentHandler = {
  canHandle(h) { return Alexa.getIntentName(h.requestEnvelope) === "NextStepIntent"; },
  handle(h) { return buildResponse(h, R.buildNextStep(state(h))); }
};

const RepeatStepIntentHandler = {
  canHandle(h) { return Alexa.getIntentName(h.requestEnvelope) === "RepeatStepIntent"; },
  handle(h) { return buildResponse(h, R.buildRepeatStep(state(h))); }
};

// "I'm vegan" / "I'm allergic to dairy" — remembered for the whole session
// and (optionally) persisted across sessions.
const SetProfileIntentHandler = {
  canHandle(h) { return Alexa.getIntentName(h.requestEnvelope) === "SetProfileIntent"; },
  handle(h) {
    return buildResponse(h, R.buildSetProfile(
      slotValue(h, "diet"), slotValue(h, "allergen"), state(h), false));
  }
};

const ClearProfileIntentHandler = {
  canHandle(h) { return Alexa.getIntentName(h.requestEnvelope) === "ClearProfileIntent"; },
  handle(h) {
    const s = state(h);
    s.diets = [];
    s.allergens = [];
    return h.responseBuilder
      .speak("<speak>Okay, I cleared your diet and allergy preferences.</speak>")
      .getResponse();
  }
};

// Yes -> start the currently recommended match ("cook it" equivalent).
const YesIntentHandler = {
  canHandle(h) { return Alexa.getIntentName(h.requestEnvelope) === "AMAZON.YesIntent"; },
  handle(h) {
    const s = state(h);
    if (s.awaitingCook && Array.isArray(s.matchIds) && s.matchIds.length) {
      return buildResponse(h, R.buildStartCooking(s.matchIds[s.matchIndex || 0], s));
    }
    return buildResponse(h, { speech: "<speak>Sorry, I didn't have a question pending. Say help for options.</speak>" });
  }
};

const NoIntentHandler = {
  canHandle(h) { return Alexa.getIntentName(h.requestEnvelope) === "AMAZON.NoIntent"; },
  handle(h) {
    state(h).awaitingCook = false;
    return buildResponse(h, {
      speech: "<speak>No problem. Tell me more ingredients, or name a recipe to cook.</speak>",
      reprompt: "What would you like to do?"
    });
  }
};

const SetTimerIntentHandler = {
  canHandle(h) { return Alexa.getIntentName(h.requestEnvelope) === "SetTimerIntent"; },
  handle(h) {
    const seconds = parseDuration(slotValue(h, "duration") || "");
    if (!seconds) {
      return h.responseBuilder
        .speak("I didn't catch the time. Say something like, set a timer for 5 minutes.")
        .reprompt("How long should the timer be?").getResponse();
    }
    const timer = new Timer(seconds);
    timer.start();
    // On a certified skill the on-device timer is delegated via
    // Alexa.TimerController; here we confirm the parsed spoken duration.
    return h.responseBuilder.speak(`Timer set for ${timer.speak()}. Say cancel timer to stop it.`).getResponse();
  }
};

const CancelTimerIntentHandler = {
  canHandle(h) { return Alexa.getIntentName(h.requestEnvelope) === "CancelTimerIntent"; },
  handle(h) { return h.responseBuilder.speak("Timer cancelled.").getResponse(); }
};

const DietFilterIntentHandler = {
  canHandle(h) { return Alexa.getIntentName(h.requestEnvelope) === "DietFilterIntent"; },
  handle(h) {
    const diet = (slotValue(h, "diet") || "").toLowerCase();
    const matches = listRecipes(diet);
    if (!matches.length) return h.responseBuilder.speak(`Sorry, I don't have ${diet} recipes right now.`).getResponse();
    const names = matches.map(m => m.name).join(", ");
    return h.responseBuilder
      .speak(`Here are the ${diet} recipes: ${names}. Say one to start cooking.`)
      .reprompt("Say a recipe name to begin.").getResponse();
  }
};

const HelpIntentHandler = {
  canHandle(h) { return Alexa.getIntentName(h.requestEnvelope) === "AMAZON.HelpIntent"; },
  handle(h) { return h.responseBuilder.speak(R.HELP_SPEECH).reprompt("What would you like to cook?").getResponse(); }
};

const CancelAndStopIntentHandler = {
  canHandle(h) {
    return ["AMAZON.CancelIntent", "AMAZON.StopIntent"].includes(Alexa.getIntentName(h.requestEnvelope));
  },
  handle(h) { return h.responseBuilder.speak("Goodbye! Enjoy your cooking.").withShouldEndSession(true).getResponse(); }
};

const SessionEndedRequestHandler = {
  canHandle(h) { return Alexa.getRequestType(h.requestEnvelope) === "SessionEndedRequest"; },
  handle(h) {
    console.log(`Session ended: ${h.requestEnvelope.request.reason}`);
    return h.responseBuilder.getResponse();
  }
};

const FallbackIntentHandler = {
  canHandle(h) { return Alexa.getIntentName(h.requestEnvelope) === "AMAZON.FallbackIntent"; },
  handle(h) { return h.responseBuilder.speak(R.FALLBACK_SPEECH).reprompt("What would you like to do?").getResponse(); }
};

const ErrorHandler = {
  canHandle() { return true; },
  handle(h, error) {
    console.error(`Error handled: ${(error && error.stack) || error}`);
    return h.responseBuilder.speak("Sorry, something went wrong. Please try again.").reprompt("Please try again.").getResponse();
  }
};

/* ------------------------------ skill builder --------------------------- */

// Persistent storage is wired only when a DynamoDB table name is provided, so
// local tests and Alexa-hosted deployments both work out of the box.
function buildSkill() {
  const builder = Alexa.SkillBuilders.custom();
  try {
    if (process.env.DYNAMODB_TABLE) {
      // eslint-disable-next-line global-require
      const { DynamoDbPersistenceAdapter } = require("ask-sdk-dynamodb-persistence-adapter");
      builder.withPersistenceAdapter(new DynamoDbPersistenceAdapter({
        tableName: process.env.DYNAMODB_TABLE,
        createTable: true
      }));
    }
  } catch (e) {
    console.warn("DynamoDB persistence unavailable, continuing session-only:", e.message);
  }
  return builder
    .addRequestInterceptors(LoadStateInterceptor)
    .addResponseInterceptors(SaveProfileInterceptor)
    .addRequestHandlers(
      LaunchRequestHandler,
      SetProfileIntentHandler,
      ClearProfileIntentHandler,
      StartCookingIntentHandler,
      WhatDoIHaveIntentHandler,
      NextMatchIntentHandler,
      SubstituteIntentHandler,
      ExcludeIngredientIntentHandler,
      NextStepIntentHandler,
      RepeatStepIntentHandler,
      YesIntentHandler,
      NoIntentHandler,
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
}

exports.handler = buildSkill();
exports._internal = { buildResponse, state, LoadStateInterceptor, SaveProfileInterceptor };
