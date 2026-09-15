"use strict";

/**
 * CookAlong TV — shared recipe data bundled for the browser.
 * Keep in sync with src/recipes.js (same dataset).
 * This file is loaded before ingredients-engine.js and app.js.
 */
window.COOKALONG_RECIPES = [
  {
    id: "tomato-basil-pasta",
    name: "Tomato Basil Pasta",
    diet: ["vegetarian", "vegan"],
    prepTimeMinutes: 20,
    serves: 2,
    ingredients: [
      { name: "spaghetti", canonical: "pasta", qty: "200g", role: "main" },
      { name: "crushed tomatoes", canonical: "tomato", qty: "400g", role: "main" },
      { name: "garlic cloves", canonical: "garlic", qty: "3", role: "secondary" },
      { name: "fresh basil leaves", canonical: "basil", qty: "a handful", role: "secondary" },
      { name: "olive oil", canonical: "olive-oil", qty: "2 tbsp", role: "seasoning", pantry: true },
      { name: "salt", canonical: "salt", qty: "to taste", role: "seasoning", pantry: true },
      { name: "black pepper", canonical: "black-pepper", qty: "to taste", role: "seasoning", pantry: true }
    ],
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
    ingredients: [
      { name: "bell pepper", canonical: "bell-pepper", qty: "1", role: "main" },
      { name: "carrot", canonical: "carrot", qty: "1", role: "main" },
      { name: "broccoli", canonical: "broccoli", qty: "150g", role: "main" },
      { name: "steamed rice", canonical: "rice", qty: "to serve", role: "secondary" },
      { name: "garlic cloves", canonical: "garlic", qty: "2", role: "secondary" },
      { name: "sesame oil", canonical: "sesame-oil", qty: "2 tbsp", role: "seasoning", pantry: true },
      { name: "soy sauce", canonical: "soy-sauce", qty: "3 tbsp", role: "seasoning", pantry: true },
      { name: "rice vinegar", canonical: "rice-vinegar", qty: "1 tbsp", role: "seasoning", pantry: true }
    ],
    steps: [
      "Slice 1 bell pepper, 1 carrot and 150g of broccoli into bite-size pieces.",
      "Heat a wok over high heat and add 2 tablespoons of sesame oil.",
      "Add the carrots and broccoli first, stir-fry for 2 minutes.",
      "Add the bell pepper and garlic and stir-fry for another 2 minutes.",
      "Pour in 3 tablespoons of soy sauce and 1 tablespoon of rice vinegar.",
      "Stir-fry for 1 minute until everything is glossy and crisp-tender.",
      "Serve hot over steamed rice."
    ]
  },
  {
    id: "garlic-chicken-rice",
    name: "Garlic Chicken Rice",
    diet: [],
    prepTimeMinutes: 35,
    serves: 3,
    ingredients: [
      { name: "chicken thighs", canonical: "chicken", qty: "400g", role: "main" },
      { name: "rice", canonical: "rice", qty: "300g", role: "main" },
      { name: "chicken stock", canonical: "chicken-stock", qty: "600ml", role: "secondary" },
      { name: "garlic cloves", canonical: "garlic", qty: "4", role: "secondary" },
      { name: "paprika", canonical: "paprika", qty: "1 tsp", role: "seasoning", pantry: true },
      { name: "salt", canonical: "salt", qty: "to taste", role: "seasoning", pantry: true },
      { name: "black pepper", canonical: "black-pepper", qty: "to taste", role: "seasoning", pantry: true }
    ],
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
    ingredients: [
      { name: "bread", canonical: "bread", qty: "4 thick slices", role: "main" },
      { name: "eggs", canonical: "egg", qty: "2", role: "main" },
      { name: "milk", canonical: "milk", qty: "120ml", role: "secondary" },
      { name: "butter", canonical: "butter", qty: "1 tbsp", role: "secondary" },
      { name: "maple syrup", canonical: "maple-syrup", qty: "to drizzle", role: "secondary" },
      { name: "sugar", canonical: "sugar", qty: "1 tbsp", role: "seasoning", pantry: true },
      { name: "cinnamon", canonical: "cinnamon", qty: "a pinch", role: "seasoning", pantry: true }
    ],
    steps: [
      "Whisk 2 eggs, 120ml of milk, 1 tablespoon of sugar and a pinch of cinnamon in a wide bowl.",
      "Dip 4 thick slices of bread into the mixture for 10 seconds per side.",
      "Melt 1 tablespoon of butter in a non-stick pan over medium heat.",
      "Cook the bread for 2 to 3 minutes per side until golden brown.",
      "Keep each slice warm while you cook the rest.",
      "Stack the toast, dust with powdered sugar, and drizzle with maple syrup."
    ]
  },
  {
    id: "mushroom-risotto",
    name: "Creamy Mushroom Risotto",
    diet: ["vegetarian", "gluten-free"],
    prepTimeMinutes: 30,
    serves: 2,
    ingredients: [
      { name: "rice", canonical: "rice", qty: "250g", role: "main" },
      { name: "mushrooms", canonical: "mushroom", qty: "250g", role: "main" },
      { name: "onion", canonical: "onion", qty: "1", role: "secondary" },
      { name: "garlic cloves", canonical: "garlic", qty: "2", role: "secondary" },
      { name: "vegetable stock", canonical: "vegetable-stock", qty: "600ml", role: "secondary" },
      { name: "grated parmesan", canonical: "cheese", qty: "40g", role: "secondary" },
      { name: "butter", canonical: "butter", qty: "1 tbsp", role: "secondary" },
      { name: "olive oil", canonical: "olive-oil", qty: "2 tbsp", role: "seasoning", pantry: true },
      { name: "salt", canonical: "salt", qty: "to taste", role: "seasoning", pantry: true },
      { name: "black pepper", canonical: "black-pepper", qty: "to taste", role: "seasoning", pantry: true }
    ],
    substitutions: {
      "vegetable-stock": { name: "chicken stock", note: "Same amount; it works beautifully in risotto." }
    },
    steps: [
      "Warm 600ml of vegetable stock in a small pot and keep it at a gentle simmer.",
      "Finely chop 1 onion and 2 garlic cloves, then slice 250g of mushrooms.",
      "Heat 2 tablespoons of olive oil in a wide pan, cook the onion for 3 minutes, then add garlic and mushrooms for 4 minutes.",
      "Add 250g of rice and stir for 1 minute until the grains look glossy.",
      "Ladle in the warm stock one cup at a time, stirring often, for about 18 minutes until the rice is creamy.",
      "Turn off the heat and beat in 1 tablespoon of butter and 40g of grated parmesan until melted.",
      "Rest for 2 minutes, season with salt and pepper, and serve."
    ]
  },
  {
    id: "tofu-scramble",
    name: "Turmeric Tofu Scramble",
    diet: ["vegetarian", "vegan", "gluten-free"],
    prepTimeMinutes: 12,
    serves: 2,
    ingredients: [
      { name: "firm tofu", canonical: "tofu", qty: "300g", role: "main" },
      { name: "spinach", canonical: "spinach", qty: "2 handfuls", role: "main" },
      { name: "tomato", canonical: "tomato", qty: "1", role: "secondary" },
      { name: "scallions", canonical: "scallion", qty: "2", role: "secondary" },
      { name: "turmeric", canonical: "turmeric", qty: "1/2 tsp", role: "seasoning", pantry: true },
      { name: "olive oil", canonical: "olive-oil", qty: "1 tbsp", role: "seasoning", pantry: true },
      { name: "salt", canonical: "salt", qty: "to taste", role: "seasoning", pantry: true },
      { name: "black pepper", canonical: "black-pepper", qty: "to taste", role: "seasoning", pantry: true }
    ],
    steps: [
      "Drain and press 300g of firm tofu, then crumble it into small curds.",
      "Heat 1 tablespoon of olive oil in a pan over medium heat.",
      "Add half a teaspoon of turmeric and cook for 10 seconds to bloom the colour.",
      "Add the crumbled tofu, season with salt and pepper, and cook for 4 minutes.",
      "Fold in 2 handfuls of spinach and 1 diced tomato; cook for 2 minutes until wilted.",
      "Top with sliced scallions and serve with toast or rice."
    ]
  },
  {
    id: "beef-broccoli",
    name: "Beef and Broccoli",
    diet: [],
    prepTimeMinutes: 20,
    serves: 2,
    ingredients: [
      { name: "beef", canonical: "beef", qty: "350g", role: "main" },
      { name: "broccoli", canonical: "broccoli", qty: "300g", role: "main" },
      { name: "steamed rice", canonical: "rice", qty: "to serve", role: "secondary" },
      { name: "garlic cloves", canonical: "garlic", qty: "2", role: "secondary" },
      { name: "ginger", canonical: "ginger", qty: "1 small piece", role: "secondary" },
      { name: "soy sauce", canonical: "soy-sauce", qty: "3 tbsp", role: "seasoning", pantry: true },
      { name: "rice vinegar", canonical: "rice-vinegar", qty: "1 tbsp", role: "seasoning", pantry: true },
      { name: "sesame oil", canonical: "sesame-oil", qty: "1 tbsp", role: "seasoning", pantry: true }
    ],
    steps: [
      "Slice 350g of beef into thin strips against the grain.",
      "Mix 3 tablespoons of soy sauce, 1 tablespoon of rice vinegar and grated ginger for the sauce.",
      "Heat 1 tablespoon of sesame oil in a wok over high heat.",
      "Sear the beef for 2 minutes until browned, then remove it.",
      "Add 300g of broccoli florets and 2 sliced garlic cloves; stir-fry for 3 minutes.",
      "Return the beef, pour in the sauce, and toss for 1 minute.",
      "Serve hot over steamed rice."
    ]
  },
  {
    id: "banana-oat-pancakes",
    name: "Banana Oat Pancakes",
    diet: ["vegetarian"],
    prepTimeMinutes: 15,
    serves: 2,
    ingredients: [
      { name: "bananas", canonical: "banana", qty: "2 ripe", role: "main" },
      { name: "rolled oats", canonical: "oats", qty: "150g", role: "main" },
      { name: "eggs", canonical: "egg", qty: "2", role: "main" },
      { name: "milk", canonical: "milk", qty: "60ml", role: "secondary" },
      { name: "butter", canonical: "butter", qty: "a little", role: "secondary" },
      { name: "honey", canonical: "honey", qty: "to drizzle", role: "secondary" },
      { name: "cinnamon", canonical: "cinnamon", qty: "1/2 tsp", role: "seasoning", pantry: true }
    ],
    steps: [
      "Mash 2 ripe bananas in a bowl until smooth.",
      "Whisk in 2 eggs and 60ml of milk.",
      "Fold in 150g of rolled oats and half a teaspoon of cinnamon; rest the batter for 3 minutes.",
      "Heat a little butter in a non-stick pan over medium heat.",
      "Pour small rounds of batter and cook 2 minutes per side until golden.",
      "Stack the pancakes and drizzle with honey; serve warm."
    ]
  },
  {
    id: "lemon-garlic-shrimp",
    name: "Lemon Garlic Shrimp",
    diet: ["gluten-free"],
    prepTimeMinutes: 20,
    serves: 2,
    ingredients: [
      { name: "shrimp", canonical: "shrimp", qty: "400g", role: "main" },
      { name: "lemon", canonical: "lemon", qty: "1", role: "main" },
      { name: "butter", canonical: "butter", qty: "2 tbsp", role: "secondary" },
      { name: "garlic cloves", canonical: "garlic", qty: "4", role: "secondary" },
      { name: "scallions", canonical: "scallion", qty: "2", role: "secondary" },
      { name: "rice", canonical: "rice", qty: "to serve", role: "secondary" },
      { name: "salt", canonical: "salt", qty: "to taste", role: "seasoning", pantry: true },
      { name: "black pepper", canonical: "black-pepper", qty: "to taste", role: "seasoning", pantry: true }
    ],
    steps: [
      "Pat 400g of shrimp dry and season with salt and pepper.",
      "Melt 2 tablespoons of butter in a pan over medium-high heat.",
      "Add 4 sliced garlic cloves and cook for 30 seconds until fragrant.",
      "Add the shrimp in one layer and cook 2 minutes per side until pink.",
      "Squeeze over the juice of 1 lemon and toss to coat.",
      "Scatter with scallions and serve with rice."
    ]
  },
  {
    id: "hearty-chicken-soup",
    name: "Hearty Chicken Soup",
    diet: ["gluten-free"],
    prepTimeMinutes: 40,
    serves: 4,
    ingredients: [
      { name: "chicken", canonical: "chicken", qty: "500g", role: "main" },
      { name: "chicken stock", canonical: "chicken-stock", qty: "1.2 L", role: "main" },
      { name: "potatoes", canonical: "potato", qty: "2", role: "main" },
      { name: "carrots", canonical: "carrot", qty: "2", role: "secondary" },
      { name: "onion", canonical: "onion", qty: "1", role: "secondary" },
      { name: "garlic cloves", canonical: "garlic", qty: "2", role: "secondary" },
      { name: "olive oil", canonical: "olive-oil", qty: "1 tbsp", role: "seasoning", pantry: true },
      { name: "salt", canonical: "salt", qty: "to taste", role: "seasoning", pantry: true },
      { name: "black pepper", canonical: "black-pepper", qty: "to taste", role: "seasoning", pantry: true }
    ],
    steps: [
      "Cut 500g of chicken into chunks; dice 2 carrots, 1 onion and 2 potatoes.",
      "Heat 1 tablespoon of olive oil in a large pot.",
      "Cook the onion and 2 garlic cloves for 3 minutes until soft.",
      "Add the chicken and brown lightly for 4 minutes.",
      "Pour in 1.2 litres of chicken stock and bring to a simmer.",
      "Add the carrots and potatoes, then simmer for 25 minutes until tender.",
      "Season with salt and pepper and ladle into bowls."
    ]
  }
];
