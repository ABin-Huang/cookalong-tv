"use strict";

/**
 * CookAlong TV — Fire TV Web App front-end logic.
 * Recipe browsing, step-by-step view and a smart timer, optimized for
 * the 10-foot TV experience. Designed to work with the Alexa+ voice layer.
 */
(() => {
  const recipes = window.COOKALONG_RECIPES || [];
  const $ = id => document.getElementById(id);

  const viewHome = $("view-home");
  const viewRecipe = $("view-recipe");
  const grid = $("recipe-grid");
  const filtersBox = $("filters");

  let activeDiet = "any";
  let currentRecipe = null;
  let currentStep = 0; // 0-based
  let timer = null;

  /* ---------- rendering ---------- */

  function cardFor(recipe) {
    const card = document.createElement("article");
    card.className = "card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Start cooking ${recipe.name}`);
    const tags = recipe.diet.length ? recipe.diet.join(" · ") : "Everyone";
    card.innerHTML = `
      <div class="card-body">
        <h3>${recipe.name}</h3>
        <p class="card-meta">${recipe.prepTimeMinutes} min · serves ${recipe.serves} · ${recipe.stepCount || recipe.steps.length} steps</p>
        <p class="card-diet">${tags}</p>
      </div>`;
    card.addEventListener("click", () => openRecipe(recipe.id));
    card.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") openRecipe(recipe.id);
    });
    return card;
  }

  function renderGrid() {
    grid.innerHTML = "";
    const filtered = activeDiet === "any"
      ? recipes
      : recipes.filter(r => r.diet.includes(activeDiet));
    if (!filtered.length) {
      grid.innerHTML = `<p class="empty">No recipes match “${activeDiet}” — try another filter.</p>`;
      return;
    }
    filtered.forEach(r => grid.appendChild(cardFor(r)));
  }

  /* ---------- recipe view ---------- */

  function openRecipe(id) {
    currentRecipe = recipes.find(r => r.id === id) || null;
    if (!currentRecipe) return;
    currentStep = 0;
    if (timer) { timer.stop(); timer = null; hideTimer(); }
    viewHome.classList.add("hidden");
    viewRecipe.classList.remove("hidden");
    $("recipe-title").textContent = currentRecipe.name;
    $("recipe-meta").textContent =
      `${currentRecipe.prepTimeMinutes} min · serves ${currentRecipe.serves}`;
    renderStep();
    window.scrollTo(0, 0);
  }

  function renderStep() {
    if (!currentRecipe) return;
    const total = currentRecipe.steps.length;
    $("step-label").textContent = `Step ${currentStep + 1} of ${total}`;
    $("step-text").textContent = currentRecipe.steps[currentStep];
    $("btn-prev").disabled = currentStep === 0;
    $("btn-next").disabled = currentStep === total - 1;
    showToast(`${currentRecipe.name} — Step ${currentStep + 1}`);
  }

  /* ---------- timer ---------- */

  function defaultTimerSeconds() {
    const min = (currentRecipe && currentRecipe.prepTimeMinutes) || 5;
    return Math.max(60, Math.min(30 * 60, min * 60));
  }

  function showTimer() {
    $("timer-display").classList.remove("hidden");
  }

  function hideTimer() {
    $("timer-display").classList.add("hidden");
  }

  function setTimerSeconds(seconds) {
    if (timer) timer.stop();
    const time = $("timer-time");
    const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
    const ss = String(seconds % 60).padStart(2, "0");
    time.textContent = `${mm}:${ss}`;
    time.dataset.seconds = seconds;
  }

  function startTimer() {
    const seconds = parseInt($("timer-time").dataset.seconds || defaultTimerSeconds(), 10);
    const time = $("timer-time");
    showTimer();
    timer = setInterval(() => {
      let remaining = parseInt(time.dataset.seconds, 10);
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(timer);
        timer = null;
        time.textContent = "00:00";
        showToast("⏰ Timer done! Time to check your food.", 6000);
        return;
      }
      time.dataset.seconds = remaining;
      const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
      const ss = String(remaining % 60).padStart(2, "0");
      time.textContent = `${mm}:${ss}`;
    }, 1000);
  }

  /* ---------- toast ---------- */

  let toastHandle = null;
  function showToast(message, ms = 2500) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.remove("hidden");
    if (toastHandle) clearTimeout(toastHandle);
    toastHandle = setTimeout(() => toast.classList.add("hidden"), ms);
  }

  /* ---------- events ---------- */

  filtersBox.addEventListener("click", e => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    filtersBox.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    activeDiet = chip.dataset.diet;
    renderGrid();
  });

  $("btn-back").addEventListener("click", () => {
    if (timer) { clearInterval(timer); timer = null; hideTimer(); }
    currentRecipe = null;
    viewRecipe.classList.add("hidden");
    viewHome.classList.remove("hidden");
  });

  $("btn-prev").addEventListener("click", () => {
    if (currentStep > 0) { currentStep -= 1; renderStep(); }
  });

  $("btn-next").addEventListener("click", () => {
    if (currentStep < currentRecipe.steps.length - 1) { currentStep += 1; renderStep(); }
  });

  $("btn-timer").addEventListener("click", () => {
    setTimerSeconds(defaultTimerSeconds());
    showTimer();
  });

  $("btn-timer-start").addEventListener("click", startTimer);
  $("btn-timer-pause").addEventListener("click", () => {
    if (timer) { clearInterval(timer); timer = null; }
  });
  $("btn-timer-reset").addEventListener("click", () => {
    if (timer) { clearInterval(timer); timer = null; }
    setTimerSeconds(defaultTimerSeconds());
  });

  // Remote D-pad support (left/right = prev/next) once a recipe is open.
  document.addEventListener("keydown", e => {
    if (viewRecipe.classList.contains("hidden")) return;
    if (e.key === "ArrowRight") $("btn-next").click();
    if (e.key === "ArrowLeft") $("btn-prev").click();
  });

  /* ---------- init ---------- */

  renderGrid();
  showToast("Welcome to CookAlong TV! Choose a recipe to start.");
})();
