"use strict";

/**
 * CookAlong TV — Alexa Skills Kit skill backend (Node.js / AWS Lambda).
 * Handles launch, step navigation, smart timers and dietary filtering.
 * Deploy as an AWS Lambda function using the ASK Node.js SDK.
 */

const Alexa = require("ask-sdk-core");
const { listRecipes, getRecipe, findRecipe, formatStep } = require("../src/recipes");
const { parseDuration, Timer } = require("../src/timer");

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

/* ---------- intents ---------- */

const LaunchRequestHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === "LaunchRequest";
  },
  handle(handlerInput) {
    const s = state(handlerInput);
    s.recipeId = null;
    s.step = 0;

    const meals = listRecipes();
    const names = meals.map(m => m.name).join(", ");
    return handlerInput.responseBuilder
      .speak(`Welcome to CookAlong TV! I have ${meals.length} recipes: ${names}. ` +
        `Say "cook tomato basil pasta", or "what can I make".`)
      .reprompt("Which recipe would you like to cook?")
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
    const slot = Alexa.getSlotValue(handlerInput.requestEnvelope, "recipe");
    if (!slot) {
      return handlerInput.responseBuilder
        .speak("Which recipe would you like to cook?")
        .reprompt("Tell me a recipe name, like tomato basil pasta.")
        .getResponse();
    }
    const recipe = findRecipe(slot);
    if (!recipe) {
      return handlerInput.responseBuilder
        .speak(`I couldn't find a recipe called ${slot}. Try tomato basil pasta, vegetable stir fry, garlic chicken rice, or fluffy french toast.`)
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
      .speak("CookAlong TV helps you cook hands-free. Say cook tomato basil pasta to start, next step to continue, set a timer for 5 minutes for timers, or filter recipes by vegan.")
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
      .speak("I didn't understand that. Try cook tomato basil pasta, next step, or set a timer for 5 minutes.")
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
