"use strict";

/**
 * CookAlong TV — shared recipe data bundled for the browser.
 * Keep in sync with src/recipes.js (same dataset).
 * This file is loaded before app.js.
 */
window.COOKALONG_RECIPES = [
  {
    id: "tomato-basil-pasta",
    name: "Tomato Basil Pasta",
    diet: ["vegetarian", "vegan"],
    prepTimeMinutes: 20,
    serves: 2,
    steps: [
      "Boil salted water and cook 200g of spaghetti for 9 minutes.",
      "While the pasta cooks, heat 2 tablespoons of olive oil in a pan over medium heat.",
      "Add 3 crushed garlic cloves and cook for 1 minute until fragrant.",
      "Pour in 400g of crushed tomatoes, season with salt and pepper, and simmer for 8 minutes.",
      "Drain the pasta, reserving a cup of pasta water.",
      "Toss the pasta with the sauce, adding pasta water until it coats the noodles.",
      "Finish with fresh basil leaves and serve immediately."
    ]
  },
  {
    id: "vegetable-stir-fry",
    name: "Vegetable Stir Fry",
    diet: ["vegetarian", "vegan", "gluten-free"],
    prepTimeMinutes: 15,
    serves: 2,
    steps: [
      "Slice 1 bell pepper, 1 carrot and 150g of broccoli into bite-size pieces.",
      "Heat a wok over high heat and add 2 tablespoons of sesame oil.",
      "Add the carrots and broccoli first, stir-fry for 2 minutes.",
      "Add the bell pepper and stir-fry for another 2 minutes.",
      "Pour in 3 tablespoons of soy sauce and 1 tablespoon of rice vinegar.",
      "Stir-fry for 1 minute until everything is glossy and crisp-tender.",
      "Serve hot over steamed rice or noodles."
    ]
  },
  {
    id: "garlic-chicken-rice",
    name: "Garlic Chicken Rice",
    diet: [],
    prepTimeMinutes: 35,
    serves: 3,
    steps: [
      "Season 400g of chicken thighs with salt, pepper and 1 teaspoon of paprika.",
      "Heat a large pot over medium heat and brown the chicken for 4 minutes per side.",
      "Remove the chicken, then sauté 4 minced garlic cloves for 30 seconds.",
      "Add 300g of rice and stir for 1 minute to coat it in the garlic oil.",
      "Pour in 600ml of chicken stock and bring to a simmer.",
      "Return the chicken, cover and cook on low for 18 minutes.",
      "Rest for 5 minutes, fluff the rice, and serve."
    ]
  },
  {
    id: "fluffy-french-toast",
    name: "Fluffy French Toast",
    diet: ["vegetarian"],
    prepTimeMinutes: 15,
    serves: 2,
    steps: [
      "Whisk 2 eggs, 120ml of milk, 1 tablespoon of sugar and a pinch of cinnamon in a wide bowl.",
      "Dip 4 thick slices of bread into the mixture for 10 seconds per side.",
      "Melt 1 tablespoon of butter in a non-stick pan over medium heat.",
      "Cook the bread for 2 to 3 minutes per side until golden brown.",
      "Keep each slice warm while you cook the rest.",
      "Stack the toast, dust with powdered sugar, and drizzle with maple syrup."
    ]
  }
];
