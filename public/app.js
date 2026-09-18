"use strict";

/**
 * CookAlong TV — Fire TV Web App front-end logic.
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
  let currentStep = 0;
  let rack = null;                  // the set of timers; cooking is parallel
  let finishedTimers = [];          // labels that finished and are unacknowledged
  let voiceListening = false;
  let voiceMuted = false;
  let currentMatch = null;      // the kitchen match a recipe was opened from, if any
  let currentHave = null;       // the ingredient set that match was scored against
  let activeSwaps = {};         // canonical -> substitution option currently applied
  let activeAllergens = new Set();  // allergens the cook has asked us to avoid
  let wantedServings = null;        // the yield the cook asked for; null = as written

  const MUTE_KEY = "cookalong.muted.v1";
  const ALLERGY_KEY = "cookalong.allergies.v1";
  const PROGRESS_KEY = "cookalong.progress.v1";
  const SERVINGS_KEY = "cookalong.servings.v1";

  /** Escape untrusted text before it is interpolated into innerHTML. */
  function esc(value) {
    return String(value).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function cardFor(recipe) {
    const card = document.createElement("article");
    card.className = "card";
    card.tabIndex = 0;
    card.dataset.recipeId = recipe.id;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Start cooking ${recipe.name}`);
    const tags = recipe.diet.length ? recipe.diet.join(" · ") : "Everyone";
    const kcal = recipe.nutrition ? recipe.nutrition.kcal : null;
    card.innerHTML = `<div class="card-body"><h3>${esc(recipe.name)}</h3><p class="card-meta">${recipe.prepTimeMinutes} min · serves ${recipe.serves} · ${recipe.stepCount || recipe.steps.length} steps${kcal ? ` · 🔥 ${kcal} kcal` : ""}</p><p class="card-diet">${esc(tags)}</p></div>`;
    card.addEventListener("click", () => openRecipe(recipe.id));
    card.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") openRecipe(recipe.id); });
    return card;
  }

  function renderGrid() {
    grid.innerHTML = "";
    const dietFiltered = activeDiet === "any" ? recipes : recipes.filter(r => r.diet.includes(activeDiet));
    // The diet chip already narrowed this list, so anything still removed here
    // was removed for an allergen — which makes the count safe to state plainly
    // instead of hedging about which filter did it.
    const visible = engine
      ? dietFiltered.filter(r => engine.recipeMatchesProfile(r, currentProfile()))
      : dietFiltered;
    const hidden = dietFiltered.length - visible.length;

    const note = $("allergens-note");
    if (note) {
      const bits = [];
      if (hidden) bits.push(`${hidden} recipe${hidden === 1 ? "" : "s"} hidden because of your allergies`);
      if (activeAllergens.size) bits.push(`avoiding ${[...activeAllergens].join(", ")}`);
      note.textContent = bits.join(" · ");
      note.classList.toggle("warn", hidden > 0);
    }

    if (!visible.length) {
      grid.innerHTML = hidden
        ? '<p class="empty">Every recipe that matches also contains something you asked to avoid. Clear an allergy to bring them back.</p>'
        : `<p class="empty">No recipes match “${esc(activeDiet)}” — try another filter.</p>`;
      return;
    }
    visible.forEach(r => grid.appendChild(cardFor(r)));
  }

  /**
   * `restore` (optional) is a saved progress snapshot — { step, swaps } — used
   * when the cook comes back to a dish they were halfway through. Anything else
   * is a fresh start, which discards the old position on purpose.
   */
  function openRecipe(id, match, have, restore) {
    currentRecipe = recipes.find(r => r.id === id) || null;
    if (!currentRecipe) return;

    const total = currentRecipe.steps.length;
    const asked = restore ? Number(restore.step) : 0;
    currentStep = Number.isFinite(asked) ? Math.max(0, Math.min(asked, total - 1)) : 0;
    currentMatch = match || null;
    currentHave = have ? new Set(have) : null;
    activeSwaps = (restore && restore.swaps) ? { ...restore.swaps } : {};

    if (!restore) clearProgress();   // starting fresh, so the old position is gone

    hideTimers();   // timers already counting keep running across recipes
    viewHome.classList.add("hidden");
    viewRecipe.classList.remove("hidden");
    $("recipe-title").textContent = currentRecipe.name;
    renderRecipeMeta();
    renderServings();
    renderStep(); renderProgress(); renderSwaps(); renderIngredients(); renderPlan();
    renderRecipeAllergens(); renderTimers();
    window.scrollTo(0, 0);
    returnFocusId = id;
    focusEl(defaultFocus());
    acquireWakeLock();   // nobody wants the TV to sleep mid-recipe
    speak(`Starting ${currentRecipe.name}. ${scaledSteps()[currentStep]}`, true);
  }

  /* ---------------- Allergens: the profile the engine already understood ---- */

  /**
   * Every ingredient-derived check funnels through here. The engine is
   * fail-closed: a swap or a recipe that is not *proven* compatible with these
   * allergens is never offered, so keeping the set accurate is what makes the
   * safety claim true rather than decorative.
   */
  function currentProfile() {
    return {
      diets: activeDiet === "any" ? [] : [activeDiet],
      allergens: [...activeAllergens],
    };
  }

  function saveAllergens() {
    try {
      localStorage.setItem(ALLERGY_KEY, JSON.stringify([...activeAllergens]));
    } catch (e) { /* private mode — the set still applies for this session */ }
  }

  function restoreAllergens() {
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem(ALLERGY_KEY) || "[]"); } catch (e) { saved = []; }
    const known = new Set((engine && engine.COMMON_ALLERGENS) || []);
    activeAllergens = new Set(
      (Array.isArray(saved) ? saved : [])
        .map(a => String(a || "").toLowerCase().trim())
        .filter(a => !known.size || known.has(a))
    );
  }

  function renderAllergenChips() {
    const box = $("allergen-chips");
    if (!box || !engine) return;
    box.innerHTML = "";
    (engine.COMMON_ALLERGENS || []).forEach(allergen => {
      const chip = document.createElement("button");
      chip.className = "chip allergen-chip" + (activeAllergens.has(allergen) ? " active" : "");
      chip.type = "button";
      chip.dataset.allergen = allergen;
      chip.setAttribute("aria-pressed", String(activeAllergens.has(allergen)));
      chip.textContent = allergen;
      chip.addEventListener("click", () => toggleAllergen(allergen));
      box.appendChild(chip);
    });
    const clear = $("btn-allergens-clear");
    if (clear) clear.disabled = !activeAllergens.size;
  }

  function toggleAllergen(allergen) {
    if (activeAllergens.has(allergen)) activeAllergens.delete(allergen);
    else activeAllergens.add(allergen);
    saveAllergens();
    renderAllergenChips();
    renderGrid();
    renderRecipeAllergens();
    renderSwaps();
    renderIngredients();
    if (kitchenResults.children.length) askKitchen(false);   // re-rank against the new profile
    const label = activeAllergens.size
      ? `avoiding ${[...activeAllergens].join(", ")}`
      : "no allergies set";
    setVoiceStatus(`Recipe list updated — ${label}`);
    showToast(activeAllergens.has(allergen)
      ? `🚫 Hiding recipes with ${allergen}`
      : `✓ ${allergen} is back on the menu`, 3000);
  }

  /**
   * State the allergen position on the recipe itself. Any cook can see what a
   * dish carries; a cook who marked an allergy gets told, in the strongest
   * terms the UI has, before they start.
   */
  function renderRecipeAllergens() {
    const box = $("recipe-allergen");
    if (!box) return;
    if (!engine || !currentRecipe) { box.classList.add("hidden"); box.textContent = ""; return; }

    const carries = engine.recipeAllergens(currentRecipe);
    const conflicts = carries.filter(a => activeAllergens.has(a));

    if (conflicts.length) {
      box.className = "recipe-allergen conflict";
      box.textContent = `⚠ Contains ${conflicts.join(", ")} — which you asked to avoid. ` +
        `Swap it below, or press Back for other recipes.`;
    } else if (carries.length) {
      box.className = "recipe-allergen";
      box.textContent = `Contains: ${carries.join(", ")}.`;
    } else {
      box.className = "recipe-allergen";
      box.textContent = "No common allergens detected in this recipe.";
    }
    box.classList.remove("hidden");
  }

  /* ---------------- Cooking progress: come back to the step you left -------- */

  const P = window.CookalongProgress || null;

  function clearProgress() {
    try { localStorage.removeItem(PROGRESS_KEY); } catch (e) { /* private mode */ }
  }

  function readProgress() {
    if (!P) return null;
    let raw = null;
    try { raw = localStorage.getItem(PROGRESS_KEY); } catch (e) { return null; }
    return P.deserialize(raw);
  }

  /**
   * Persist the position, and clear it on the last step.
   *
   * Reaching the final step means the dish is cooked; offering to "resume" a
   * finished recipe on the next visit is worse than offering nothing at all.
   */
  function saveProgress() {
    if (!P || !currentRecipe) return;
    const total = scaledSteps().length;
    if (total > 1 && currentStep >= total - 1) { clearProgress(); return; }

    const snapshot = P.serialize({
      recipeId: currentRecipe.id,
      step: currentStep,
      swaps: activeSwaps,
      at: Date.now(),
    });
    if (!snapshot) return;
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(snapshot)); } catch (e) { /* private mode */ }
  }

  /**
   * The timer already outlives a reload; the step did not, so coming back meant
   * a live countdown on a dish the app had forgotten. This closes that gap and
   * is the reason it lives on the home screen: it is the first thing a cook
   * needs after the TV went to sleep mid-recipe.
   */
  function renderResume() {
    const banner = $("resume-banner");
    if (!banner) return;

    const saved = readProgress();
    const recipe = saved ? recipes.find(r => r.id === saved.recipeId) : null;
    if (!P || !P.isResumable(saved) || !recipe) { banner.classList.add("hidden"); return; }

    const total = recipe.steps.length;
    const step = Math.min(saved.step, total - 1);
    const swaps = Object.keys(saved.swaps || {}).length;
    const soonest = rack ? rack.next() : null;
    const timerBit = soonest
      ? ` ${rack.active().length > 1 ? `${rack.active().length} timers are` : "The timer is"} still on it — ` +
        `${fmt(soonest.timer.remainingSeconds)} ${soonest.timer.state === "paused" ? "paused" : "running"}` +
        `${soonest.label ? ` (${soonest.label})` : ""}.`
      : "";

    $("resume-detail").textContent =
      `You were on step ${step + 1} of ${total} in ${recipe.name}` +
      (swaps ? `, with ${swaps} swap${swaps > 1 ? "s" : ""} applied` : "") + "." + timerBit;
    banner.classList.remove("hidden");
  }

  function resumeCooking() {
    const saved = readProgress();
    if (!saved) { renderResume(); return; }
    setVoiceStatus(`Back to ${saved.recipeId.replace(/-/g, " ")}, step ${saved.step + 1}`);
    showToast(`↩ Picking up at step ${saved.step + 1}`, 2500);
    openRecipe(saved.recipeId, null, null, { step: saved.step, swaps: saved.swaps });
  }

  /* ---------------- "What you need": the ingredient list ---------------- */

  /**
   * Tag one ingredient with what the engine already knows about it. Opened from
   * the kitchen panel the tags come from that match; opened from the recipe grid
   * they come from the pantry alone, so we never claim something is "missing"
   * when we simply do not know.
   */
  function ingredientStatus(ing) {
    if (ing.pantry) return { kind: "staple", label: "🍱 pantry staple" };
    if (activeSwaps[ing.canonical]) return { kind: "swapped", label: `🔄 → ${activeSwaps[ing.canonical].name}` };
    if (currentHave && currentHave.has(ing.canonical)) return { kind: "have", label: "✓ on hand" };
    if (!currentHave && pantry && pantry.has(ing.canonical)) return { kind: "have", label: "✓ in pantry" };
    if (currentMatch) {
      if (currentMatch.missingSubstitutable.includes(ing.canonical)) return { kind: "swap", label: "🔄 swap available" };
      if (currentMatch.missingHard.includes(ing.canonical)) return { kind: "miss", label: "✗ missing" };
    }
    return { kind: "plain", label: "" };
  }

  /* ---------------- Scaling a recipe to the pot in front of you ------------- */

  const SERV = window.CookalongServings || null;

  function baseServings() {
    return (currentRecipe && currentRecipe.serves) || 1;
  }

  /** How many this dish is being cooked for right now. */
  function effectiveServings() {
    if (!SERV) return baseServings();
    return SERV.clampServings(wantedServings || baseServings());
  }

  function scaleFactor() {
    return SERV ? SERV.factorFor(baseServings(), effectiveServings()) : 1;
  }

  /**
   * The ingredient list as it reads at this yield. Scaling changes quantities
   * and nothing else — the canonical ids that matching and swaps key off are
   * untouched, so the allergen and pantry logic keeps seeing the same recipe.
   */
  function scaledIngredients() {
    const ings = (currentRecipe && currentRecipe.ingredients) || [];
    if (!SERV) return ings;
    return SERV.scaleIngredients(ings, scaleFactor());
  }

  /**
   * The steps with swaps applied, then the amounts scaled.
   *
   * Swaps first: a swap rewrites ingredient names inside the sentence, and the
   * scaler matches on those same names. Cooking times never scale, which the
   * engine enforces and its tests hold it to across every recipe.
   */
  function scaledSteps() {
    const steps = displaySteps();
    const factor = scaleFactor();
    if (!SERV || factor === 1) return steps;
    const heads = SERV.ingredientHeads((currentRecipe && currentRecipe.ingredients) || []);
    return steps.map(step => SERV.scaleStepText(step, factor, heads));
  }

  function saveServings() {
    try {
      if (wantedServings) localStorage.setItem(SERVINGS_KEY, JSON.stringify({ v: 1, want: wantedServings }));
      else localStorage.removeItem(SERVINGS_KEY);
    } catch (e) { /* private mode — the choice still applies for this session */ }
  }

  function restoreServings() {
    let snap = null;
    try { snap = JSON.parse(localStorage.getItem(SERVINGS_KEY) || "null"); } catch (e) { snap = null; }
    if (!snap || snap.v !== 1) return null;
    const want = Number(snap.want);
    return Number.isFinite(want) && want > 0 ? want : null;
  }

  /**
   * The header line. Once the yield moves, the honest figure to quote is the
   * total for the whole dish — "550 kcal per serving" is not what is in the pan.
   */
  function renderRecipeMeta() {
    if (!currentRecipe) return;
    const serves = effectiveServings();
    const base = baseServings();
    const scaled = serves !== base;
    const n = currentRecipe.nutrition || null;

    let text = `${currentRecipe.prepTimeMinutes} min · serves ${serves}`;
    if (scaled) text += ` (scaled from ${base})`;

    const totals = n && SERV ? SERV.totalNutrition(n, scaled ? serves : 1) : n;
    if (totals) {
      const macros = [["protein", "P"], ["carbs", "C"], ["fat", "F"]]
        .filter(([key]) => Number.isFinite(totals[key]))
        .map(([key, letter]) => `${letter} ${totals[key]}g`);
      const bits = [];
      if (Number.isFinite(totals.kcal)) bits.push(`🔥 ${totals.kcal} kcal`);
      if (macros.length) bits.push(macros.join(" / "));
      if (bits.length) text += ` · ${bits.join(" · ")} ${scaled ? "in total" : "per serving"}`;
    }

    $("recipe-meta").textContent = text;
  }

  function renderServings() {
    const bar = $("servings-bar");
    if (!bar) return;
    if (!currentRecipe || !SERV) { bar.classList.add("hidden"); return; }
    bar.classList.remove("hidden");

    const serves = effectiveServings();
    const base = baseServings();
    $("servings-value").textContent = String(serves);
    const minus = $("btn-servings-minus");
    const plus = $("btn-servings-plus");
    if (minus) minus.disabled = serves <= SERV.MIN_SERVINGS;
    if (plus) plus.disabled = serves >= SERV.MAX_SERVINGS;

    const note = $("servings-note");
    if (!note) return;
    if (serves === base) {
      note.textContent = "as written";
      note.classList.remove("scaled");
    } else {
      const factor = Math.round(SERV.factorFor(base, serves) * 100) / 100;
      note.textContent = `×${factor} from ${base} · amounts scaled, cooking times unchanged`;
      note.classList.add("scaled");
    }
  }

  /**
   * Redraw the scaled parts without re-announcing the recipe. Walking the
   * servings up three notches should not read the step aloud three times.
   */
  function renderScaled() {
    renderServings();
    renderRecipeMeta();
    renderIngredients();
    if (!currentRecipe) return;
    $("step-text").textContent = scaledSteps()[currentStep];
    renderStepTimerHint();
    renderProgress();
    // The plan's rows quote the step prose, so they follow the amounts. Their
    // durations do not move — that is the whole point of scaling and is tested.
    renderPlan();
  }

  function changeServings(delta) {
    if (!currentRecipe || !SERV) return;
    const from = effectiveServings();
    const next = SERV.clampServings(from + delta);
    if (next === from) return;
    wantedServings = next;
    saveServings();
    renderScaled();
    showToast(`Scaled for ${next} — amounts changed, times did not`, 2600);
  }

  function renderIngredients() {
    const list = $("ingredients-list");
    if (!list) return;
    const summary = $("ingredients-summary");
    if (!currentRecipe) { list.innerHTML = ""; if (summary) summary.textContent = ""; return; }

    const ings = scaledIngredients();
    list.innerHTML = "";
    let ready = 0;
    let swapped = 0;
    let swap = 0;
    let miss = 0;

    ings.forEach(ing => {
      const st = ingredientStatus(ing);
      if (st.kind === "have" || st.kind === "staple") ready += 1;
      else if (st.kind === "swapped") swapped += 1;
      else if (st.kind === "swap") swap += 1;
      else if (st.kind === "miss") miss += 1;

      const row = document.createElement("li");
      row.className = `ing-row ${st.kind}`;
      const qty = document.createElement("span");
      qty.className = "ing-qty";
      qty.textContent = ing.qty || "";
      const name = document.createElement("span");
      name.className = "ing-name";
      name.textContent = ing.name;
      row.append(qty, name);
      if (st.label) {
        const tag = document.createElement("span");
        tag.className = "ing-tag";
        tag.textContent = st.label;
        row.appendChild(tag);
      }
      list.appendChild(row);
    });

    if (summary) {
      const bits = [`${ready} of ${ings.length} ready`];
      if (swapped) bits.push(`${swapped} swapped`);
      if (swap) bits.push(`${swap} swappable`);
      if (miss) bits.push(`${miss} to buy`);
      const serves = effectiveServings();
      summary.textContent = `${serves} serving${serves === 1 ? "" : "s"} · ${bits.join(" · ")}`;
    }
  }

  /* ---------------- The cook plan: every pot, and how long it wants --------- */

  const PLAN = window.CookalongPlan || null;

  /**
   * Whether the plan's rows are showing. Collapsed is the default because the
   * summary line is the insight and the rows are a setup tool: leaving five rows
   * open above the step card pushes the thing the cook is actually reading off a
   * 10-foot screen. Once opened it stays open for the session — a cook who
   * unfolded it meant it.
   */
  let planOpen = false;

  function setPlanOpen(open) {
    planOpen = !!open;
    const list = $("plan-list");
    const toggle = $("btn-plan-toggle");
    if (!list || !toggle) return;
    list.classList.toggle("hidden", !planOpen);
    toggle.textContent = planOpen ? "Hide steps" : "Show steps";
    toggle.setAttribute("aria-expanded", planOpen ? "true" : "false");
  }

  /**
   * Every step of this recipe that names a time, in one list.
   *
   * Cooking is parallel and the timer rack already allows it — but only for a
   * cook who knows which steps have a clock on them, and that knowledge used to
   * arrive one step at a time behind a Next press. Which is precisely why the
   * 18-minute braise got discovered with everything else already going. This puts
   * the whole cook on one screen and lets any row be started from here.
   *
   * The numbers are the step's own, read by the same parser the ⏱ button uses —
   * the longest wait the step names, "per side" doubled. Nothing is summed into a
   * duration the recipe never stated, and the summary says "name a time" rather
   * than "takes", because chopping is not timed.
   */
  function renderPlan() {
    const panel = $("plan-panel");
    const list = $("plan-list");
    if (!panel || !list) return;
    if (!currentRecipe || !PLAN) { panel.classList.add("hidden"); return; }

    const plan = PLAN.summary(scaledSteps());
    panel.classList.toggle("hidden", !plan.timedCount);
    if (!plan.timedCount) { list.innerHTML = ""; return; }
    setPlanOpen(planOpen);   // keep the toggle and the list agreeing with each other

    const longest = plan.longest;
    $("plan-summary").textContent =
      `${plan.timedCount} of ${plan.totalCount} steps name a time · longest ${shortDuration(longest.seconds)} (step ${longest.index + 1})`;

    list.innerHTML = "";
    plan.steps.forEach(entry => {
      const row = document.createElement("li");
      row.className = "plan-row";
      row.dataset.step = String(entry.index);
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.setAttribute("aria-label", `Go to step ${entry.index + 1}`);
      if (longest && entry.index === longest.index) row.classList.add("longest");

      const stepTag = document.createElement("span");
      stepTag.className = "plan-step";
      stepTag.textContent = `Step ${entry.index + 1}`;

      const time = document.createElement("span");
      time.className = "plan-time";
      time.textContent = shortDuration(entry.seconds);

      const text = document.createElement("span");
      text.className = "plan-text";
      text.textContent = entry.text;

      const start = document.createElement("button");
      start.type = "button";
      start.className = "btn small plan-start";
      start.dataset.action = "start";
      start.dataset.step = String(entry.index);
      start.textContent = `⏱ ${shortDuration(entry.seconds)}`;

      row.append(stepTag, time, text, start);
      list.appendChild(row);
    });
    syncPlanTimerFlags();
  }

  /**
   * Show which rows already have a timer without rebuilding them. This runs on
   * every rack change — so once a second while anything counts — and rebuilding
   * would take the remote's focus with it, the same trap the timer list was
   * fixed for.
   */
  function syncPlanTimerFlags() {
    document.querySelectorAll("#plan-list .plan-row").forEach(row => {
      const index = Number(row.dataset.step);
      const button = row.querySelector("button[data-action='start']");
      if (!button) return;
      const label = stepTimerLabel(index);
      const entry = (rack && label) ? rack.findByLabel(label) : null;
      row.classList.toggle("timing", !!entry);

      const seconds = suggestedTimerSeconds(index);
      const text = entry
        ? (entry.timer.state === "running" ? `⏱ ${fmt(entry.timer.remainingSeconds)}` : "⏱ Restart")
        : `⏱ ${shortDuration(seconds)}`;
      if (button.textContent !== text) button.textContent = text;
      button.setAttribute("aria-label", entry
        ? `Restart the timer on step ${index + 1}`
        : `Start a ${shortDuration(seconds)} timer for step ${index + 1}`);
    });
  }

  /**
   * Open a planned step, keeping the yield and the swaps already applied — the
   * plan is a shortcut into the same screen, not a separate mode.
   */
  function goToStep(index) {
    if (!currentRecipe) return;
    const total = scaledSteps().length;
    currentStep = Math.max(0, Math.min(index, total - 1));
    renderStep();
    // renderStep has just relabelled the button with this step's own time, so
    // focus lands on the action rather than back in the list.
    focusEl($("btn-timer"));
  }

  /** One delegated handler for the whole plan, so the rows stay disposable. */
  function onPlanClick(event) {
    const button = event.target.closest("button[data-action='start']");
    if (button) { addStepTimer(Number(button.dataset.step), false); return; }
    const row = event.target.closest(".plan-row");
    if (row) goToStep(Number(row.dataset.step));
  }

  /** Recipe step text with any applied swaps rewritten in. */
  function displaySteps() {
    if (!currentRecipe) return [];
    const canonicals = Object.keys(activeSwaps);
    if (!engine || !canonicals.length) return currentRecipe.steps;
    let steps = [...currentRecipe.steps];
    canonicals.forEach(canonical => {
      const sub = activeSwaps[canonical];
      const ing = (currentRecipe.ingredients || []).find(i => i.canonical === canonical);
      const shown = engine.displayName(canonical);
      const names = ing ? [ing.name, shown, shown.replace(/s$/, "")] : [shown];
      steps = engine.substituteInSteps(steps, names, sub.name).steps;
    });
    return steps;
  }

  function renderStep() {
    if (!currentRecipe) return;
    const steps = scaledSteps();
    const total = steps.length;
    $("step-label").textContent = `Step ${currentStep + 1} of ${total}`;
    $("step-text").textContent = steps[currentStep];
    $("btn-prev").disabled = currentStep === 0;
    $("btn-next").disabled = currentStep === total - 1;
    updateTimerButton(); renderProgress(); renderStepTimerHint();
    saveProgress();
    showToast(`${currentRecipe.name} — Step ${currentStep + 1}`);
  }

  function renderProgress() {
    const box = $("progress");
    if (!currentRecipe) { box.innerHTML = ""; return; }
    const total = scaledSteps().length;
    box.innerHTML = Array.from({ length: total }, (_, i) => `<span class="dot ${i <= currentStep ? "done" : ""}"></span>`).join("");
  }

  function defaultTimerSeconds() {
    const min = (currentRecipe && currentRecipe.prepTimeMinutes) || 5;
    return Math.max(60, Math.min(30 * 60, min * 60));
  }

  /**
   * The time the current step itself is asking for ("simmer for 18 minutes").
   * This is what lets the timer follow the recipe instead of a fixed default.
   * Takes a step index so the cook plan can ask about a step that is not on
   * screen — the whole point of the plan is starting the pot you are not on.
   */
  function stepSeconds(index = currentStep) {
    if (!currentRecipe || !T || !T.stepDurationSeconds) return null;
    const steps = scaledSteps();
    return T.stepDurationSeconds(steps[index] || "");
  }

  /** What the ⏱ button should offer: the step's own time, else the recipe's. */
  function suggestedTimerSeconds(index = currentStep) {
    return stepSeconds(index) || defaultTimerSeconds();
  }

  function humanDuration(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    const parts = [];
    if (m) parts.push(`${m} minute${m === 1 ? "" : "s"}`);
    if (s) parts.push(`${s} second${s === 1 ? "" : "s"}`);
    return parts.join(" ") || "0 seconds";
  }

  function fmt(seconds) {
    return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }

  /** A plan row's duration, where there is no room for the word "minute". */
  function shortDuration(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (!m) return `${s} sec`;
    return s ? `${m} min ${s} sec` : `${m} min`;
  }
  function updateTimerButton() {
    const btn = $("btn-timer");
    if (!currentRecipe) return;
    const label = stepTimerLabel();
    const already = (rack && label) ? rack.findByLabel(label) : null;
    btn.textContent = `⏱ ${already ? "Restart" : "Set"} timer ${fmt(suggestedTimerSeconds())}`;
    btn.title = already
      ? "A timer is already on this step — pressing again restarts it"
      : stepSeconds() ? "This step's own cooking time" : "A default timer for this recipe";
  }

  /** Surface the step's own time so the cook never has to scan the sentence. */
  function renderStepTimerHint() {
    const hint = $("step-timer-hint");
    if (!hint) return;
    const secs = stepSeconds();
    if (!secs) { hint.classList.add("hidden"); hint.textContent = ""; return; }
    hint.textContent = `⏱ This step takes about ${humanDuration(secs)} — press “Set timer”.`;
    hint.classList.remove("hidden");
  }
  function showTimers() { $("timer-display").classList.remove("hidden"); renderTimers(); }
  function hideTimers() { $("timer-display").classList.add("hidden"); }

  /* ---- Timers: a rack of deadline-based timers, reachable from any screen -- */
  const T = window.CookalongTimer || null;
  const TIMER_KEY = "cookalong.timer.v1";

  function ensureRack() {
    if (!rack && T) rack = new T.TimerRack(onRackChange);
    return rack;
  }

  function saveTimers() {
    try {
      if (!rack || !rack.size) localStorage.removeItem(TIMER_KEY);
      else localStorage.setItem(TIMER_KEY, JSON.stringify(rack.toJSON()));
    } catch (e) { /* private mode */ }
  }

  /**
   * What a timer is timing. "Timer done" is useless when three are running, so
   * every timer carries the dish and the step it belongs to.
   */
  function stepTimerLabel(index = currentStep) {
    if (!currentRecipe) return "";
    return `${currentRecipe.name} · step ${index + 1}`;
  }

  const TIMER_LABELS = { idle: "ready to start", running: "counting down", paused: "paused", done: "done" };

  /** The topbar badge always shows the most urgent timer, so one glance is enough. */
  function renderTimerBadge() {
    const badge = $("btn-timer-badge");
    if (!badge) return;
    const live = rack ? rack.active() : [];
    const soonest = live[0] || null;
    badge.classList.toggle("hidden", !soonest);
    if (!soonest) return;
    $("timer-badge-icon").textContent = soonest.timer.state === "running" ? "⏱" : "⏸";
    $("timer-badge-text").textContent = live.length > 1
      ? `${fmt(soonest.timer.remainingSeconds)} +${live.length - 1}`
      : fmt(soonest.timer.remainingSeconds);
    badge.title = live.length > 1
      ? `${live.length} timers — next is ${soonest.label || "a timer"}`
      : `${soonest.label || "Timer"} — open the timers`;
  }

  /**
   * Keep one row's buttons in step with its timer without replacing them.
   * Rebuilding a focused button drops the remote's focus, and these rows are
   * redrawn every second while a timer counts.
   */
  function renderTimerRowActions(box, entry) {
    const { timer } = entry;
    const label = entry.label || "timer";

    let toggle = box.querySelector("button[data-action='toggle']");
    if (timer.state !== "done" && !toggle) {
      toggle = document.createElement("button");
      toggle.className = "btn small";
      toggle.dataset.action = "toggle";
      box.insertBefore(toggle, box.firstChild);
    } else if (timer.state === "done" && toggle) {
      toggle.remove();
      toggle = null;
    }
    if (toggle) {
      const text = timer.state === "running" ? "Pause" : "Start";
      if (toggle.textContent !== text) toggle.textContent = text;
      toggle.setAttribute("aria-label", `${text} the ${label} timer`);
    }

    let remove = box.querySelector("button[data-action='remove']");
    if (!remove) {
      remove = document.createElement("button");
      remove.className = "btn small";
      remove.dataset.action = "remove";
      box.appendChild(remove);
    }
    const removeText = timer.state === "done" ? "Dismiss" : "✕";
    if (remove.textContent !== removeText) remove.textContent = removeText;
    remove.setAttribute("aria-label", `Remove the ${label} timer`);
  }

  function renderTimers() {
    const list = $("timer-list");
    if (!list) return;
    const entries = rack ? rack.list() : [];
    const count = $("timer-count");
    if (count) count.textContent = String(entries.filter(e => e.timer.state !== "done").length);
    const empty = $("timer-empty");
    if (empty) empty.classList.toggle("hidden", entries.length > 0);

    // Reconcile rather than rebuild: this runs on every tick, and throwing the
    // list away each second would take the cook's focus with it.
    const stale = new Map(
      [...list.querySelectorAll("[data-timer-id]")].map(row => [row.dataset.timerId, row])
    );

    entries.forEach(entry => {
      const { timer } = entry;
      let row = stale.get(entry.id);
      if (!row) {
        row = document.createElement("li");
        row.dataset.timerId = entry.id;
        row.innerHTML =
          '<span class="timer-row-label"></span><span class="timer-row-time"></span>' +
          '<span class="timer-row-state"></span><span class="timer-row-actions"></span>';
        list.appendChild(row);
      }
      stale.delete(entry.id);

      row.className = `timer-row ${timer.state}`;
      row.querySelector(".timer-row-label").textContent = entry.label || "Timer";
      row.querySelector(".timer-row-time").textContent = fmt(timer.remainingSeconds);
      row.querySelector(".timer-row-state").textContent = TIMER_LABELS[timer.state] || timer.state;
      renderTimerRowActions(row.querySelector(".timer-row-actions"), entry);
    });

    stale.forEach(row => row.remove());

    renderTimerBadge();
    updateTimerButton();
    syncPlanTimerFlags();
  }

  /**
   * Every timer reports through here — one place that redraws the list, writes
   * the snapshot and, when one actually lands, says which one it was.
   */
  function onRackChange(rackRef, finished) {
    renderTimers();
    saveTimers();
    renderResume();          // the banner quotes the timers, so it is now stale
    if (finished) announceFinished(finished);
  }

  /**
   * Announce a finished timer by name. Three timers running makes "Timer done"
   * useless, so the alert says which pot to walk back to — and a second timer
   * landing while the alert is still up adds itself rather than replacing what
   * the cook has not read yet.
   */
  function announceFinished(entry) {
    const label = (entry && entry.label) || "Timer";
    if (!finishedTimers.includes(label)) finishedTimers.push(label);
    playChime();
    speak(`${label} — timer done!`);
    showToast(`⏰ ${label} — time to check your food.`, 6000);
    renderTimerAlert();
  }

  function renderTimerAlert() {
    const box = $("timer-alert");
    if (!box || !finishedTimers.length) return;
    const many = finishedTimers.length > 1;
    $("timer-alert-title").textContent = many ? `${finishedTimers.length} timers done!` : "Timer done!";
    $("timer-alert-body").textContent = many
      ? `${finishedTimers.join(" · ")} — time to check your food.`
      : `${finishedTimers[0]} — time to check your food.`;
    box.classList.remove("hidden");
    $("btn-timer-dismiss").focus({ preventScroll: true });
    markFocus($("btn-timer-dismiss"));
  }

  /**
   * Start a timer for a step. Pressing it twice for the same step restarts that
   * timer rather than stacking a duplicate — one step, one timer — and
   * everything else already counting carries on untouched.
   *
   * `index` defaults to the step on screen, but the cook plan passes the step it
   * is starting; that is the feature: the 18-minute pot gets started from the
   * plan before anyone has walked to step 6.
   *
   * `focusRow` is false when the call came from the plan. Focus belongs where the
   * cook put it — yanking it into the timer list would undo the plan's whole
   * advantage, which is starting two pots without losing your place.
   */
  function addStepTimer(index = currentStep, focusRow = true) {
    if (!ensureRack()) { showToast("Timer engine not loaded.", 3000); return; }
    const seconds = suggestedTimerSeconds(index);
    const label = stepTimerLabel(index);
    const already = label ? rack.findByLabel(label) : null;
    const entry = rack.add(seconds, label);
    if (!entry) {
      showToast(`That is as many timers as this kitchen tracks (${rack.maxTimers}).`, 3500);
      return;
    }
    rack.start(entry.id);
    showTimers();
    showToast(already
      ? `⏱ Restarted ${label || "the timer"} at ${fmt(seconds)}`
      : `⏱ ${label || "Timer"} — ${fmt(seconds)}`, 3500);
    if (focusRow) focusEl(timerRowFocus(entry.id));
    else syncPlanTimerFlags();
  }

  /** The row's own Start/Pause button, so the remote lands somewhere useful. */
  function timerRowFocus(id) {
    const row = document.querySelector(`.timer-row[data-timer-id="${id}"]`);
    const button = row && row.querySelector("button[data-action='toggle']");
    return button || $("btn-timer-close");
  }

  /** One delegated handler for every row, so the rows stay disposable. */
  function onTimerRowClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button || !rack) return;
    const row = button.closest("[data-timer-id]");
    const entry = row ? rack.get(row.dataset.timerId) : null;
    if (!entry) return;

    const label = entry.label || "timer";
    if (button.dataset.action === "toggle") {
      if (entry.timer.state === "running") rack.pause(entry.id);
      else rack.start(entry.id);
      setVoiceStatus(`${label} ${entry.timer.state === "running" ? "started" : "paused"}`);
    } else if (button.dataset.action === "remove") {
      rack.remove(entry.id);
      // Removing a finished timer also retires it from the alert's list.
      finishedTimers = finishedTimers.filter(name => name !== label);
      renderTimerAlert();
      showToast(`Removed ${label}`, 2500);
    }
  }

  function restoreTimers() {
    if (!T) return;
    let raw = null;
    try { raw = localStorage.getItem(TIMER_KEY); } catch (e) { raw = null; }
    if (!raw) { renderTimers(); return; }

    let restored = null;
    try { restored = T.TimerRack.fromJSON(raw, onRackChange); } catch (e) { restored = null; }
    if (!restored) { localStorage.removeItem(TIMER_KEY); renderTimers(); return; }

    rack = restored;
    const finished = rack.done();
    const live = rack.active();
    if (finished.length) {
      // Timers that ran out while the app was closed are stated, not resurrected.
      finishedTimers = finished.map(e => e.label || "Timer");
      rack.clearDone();
      renderTimerAlert();
      showToast(`⏰ ${finishedTimers.join(" · ")} finished while you were away.`, 6000);
    }
    if (live.length) {
      // Say "press Start to resume" and then make it findable: a restored timer
      // the cook cannot see is a timer they will not restart.
      showTimers();
      showToast(`⏱ ${live.length} timer${live.length === 1 ? "" : "s"} restored — ` +
        `${fmt(live[0].timer.remainingSeconds)} left. Press Start to resume.`, 5000);
    }
    renderTimers();
  }

  function dismissTimerAlert() {
    // Acknowledging the alert does not erase the finished timers: the cook can
    // still see which one rang, and clear them when they are done reading.
    finishedTimers = [];
    $("timer-alert").classList.add("hidden");
    focusEl(defaultFocus());
  }

  /** Short two-tone chime — no audio asset needed, and it survives mute. */
  let audioCtx = null;
  function playChime() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = audioCtx || new Ctx();
      if (audioCtx.state === "suspended") audioCtx.resume();
      [0, 0.45, 0.9].forEach((offset, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.value = i === 2 ? 1320 : 880;
        const at = audioCtx.currentTime + offset;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.35, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.32);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(at);
        osc.stop(at + 0.35);
      });
    } catch (e) { /* audio unavailable — the visual alert still fires */ }
  }

  let voices = [];
  function loadVoices() { voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : []; }
  function onVoicesChanged() {
    loadVoices();
    // The voice list can arrive after first paint, so re-measure and let the
    // UI correct itself rather than staying wrong for the whole session.
    refreshCapabilities();
    applyCapabilityUI();
  }
  if (window.speechSynthesis) { loadVoices(); window.speechSynthesis.onvoiceschanged = onVoicesChanged; }
  function pickVoice() {
    return voices.find(v => v.lang === "en-US" && /female|Samantha|Zira|Google US English/i.test(v.name)) || voices.find(v => v.lang === "en-US") || null;
  }
  function speak(text, interrupt = false) {
    if (voiceMuted) return;
    // A device with the API but no installed voice — which is what a Fire TV
    // is — swallows every utterance without raising an error. Say so once
    // instead of failing silently for the entire cook.
    if (capSummary && !capSummary.spokenPrimary) {
      if (!silentNoticeShown) {
        silentNoticeShown = true;
        showToast("🔇 No voice is installed on this device, so steps stay on screen. Device check has the details.", 6000);
      }
      return;
    }
    if (!window.speechSynthesis) return;
    // Never talk with the microphone open. The recogniser can hear the answer
    // through the speakers, treat it as a new command, and get answered again —
    // an app that argues with itself for the rest of the cook. Closing the
    // microphone here makes that structurally impossible, whatever path
    // decided to speak.
    if (voiceRecognition) stopVoiceRecognition();
    if (interrupt) window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "en-US"; utter.rate = 0.98;
    const v = pickVoice(); if (v) utter.voice = v;
    window.speechSynthesis.speak(utter);
  }
  function setVoiceStatus(text) {
    const el = $("voice-text");
    if (el) el.textContent = text;
    voiceStatusLive = true;
  }

  /**
   * The passive "what this device can do" line. Deliberately does not overwrite
   * a status the cook just triggered, because the voice list arrives
   * asynchronously: the first measurement is often wrong, and correcting the
   * capability line must not clobber "Opening Tomato Basil Pasta".
   */
  function setDefaultVoiceStatus() {
    if (voiceStatusLive) return;
    const el = $("voice-text");
    if (el) el.textContent = defaultVoiceStatus();
  }

  /* ---------------- The conversation: what was heard, what was answered -----
   *
   * The app used to treat a spoken command as fire-and-forget. The transcript
   * flashed for three seconds and was gone; the answer was a line in the top bar
   * that the next command overwrote; and on a device with no installed voice the
   * answer was handed to speak() and never appeared anywhere at all. A cook who
   * said something and saw nothing had no way to tell a misheard word from a
   * broken app — which is exactly the report this section answers.
   *
   * So the conversation is state, not an event. It is held here, shown in the
   * top bar while it happens, kept in a panel the cook can open afterwards, and
   * written down in one place — `answer()` — so that no code path can silently
   * drop the half of the exchange the screen is supposed to show.
   */

  const VOICE = window.CookalongVoiceCommands || null;
  const VOICE_LOG_KEY = "cookalong.voice-log.v1";
  const VOICE_LOG_MAX = 40;

  /* A browser can expose SpeechRecognition, accept start(), and then emit
   * nothing whatsoever: no start event, no result, no error. Chromium does
   * exactly that when it cannot reach a speech service, and the old code
   * answered it by leaving "Listening… speak a command" on the screen forever.
   * These two timeouts are the difference between a status line and a claim:
   * if nothing comes back within the grace period the microphone was never
   * really open, and no single utterance should take longer than the limit. */
  const LISTEN_GRACE_MS = 3500;
  const LISTEN_LIMIT_MS = 10000;

  let voiceState = "idle";
  let voiceLog = [];              // [{ who: "you"|"cookalong", text, at }]
  let voiceUnread = 0;            // turns added since the panel was last opened
  let voiceRecognition = null;    // the live SpeechRecognition, if any
  let voiceSession = null;        // { final, interim, handled, live } for the one in flight
  let voiceWatchdog = null;
  let answerRestHandle = null;

  /**
   * The four states the top bar can be in, and what each one promises.
   *
   *   idle       nothing is happening; the line offers the next thing to say
   *   listening  the microphone is open; the line is the cook's own words
   *   thinking   the words have stopped and the app is working on them
   *   answered   here is what it did
   *
   * Anything that is not listening or thinking clears the watchdog, so a stale
   * timer can never end a later session.
   */
  function setVoiceState(state, text) {
    voiceState = state;
    const box = $("voice-status");
    if (box) box.dataset.state = state;
    const btn = $("btn-voice");
    if (btn) btn.classList.toggle("active", state === "listening");
    if (text != null) setVoiceStatus(text);
    if (state !== "listening" && state !== "thinking") clearVoiceWatchdog();
  }

  /**
   * Back to the resting line: what the cook can do next.
   *
   * The old top bar kept the last answer up forever, so a screen that had said
   * something once said nothing useful again. An answer is worth reading for a
   * few seconds; after that the line is better spent offering the next move.
   */
  function restVoice() {
    clearVoiceWatchdog();
    clearTimeout(answerRestHandle);
    answerRestHandle = null;
    voiceStatusLive = false;
    setVoiceState("idle");
    setDefaultVoiceStatus();
  }

  function armVoiceWatchdog(ms, onFire) {
    clearVoiceWatchdog();
    voiceWatchdog = setTimeout(() => { voiceWatchdog = null; onFire(); }, ms);
  }

  function clearVoiceWatchdog() {
    if (!voiceWatchdog) return;
    clearTimeout(voiceWatchdog);
    voiceWatchdog = null;
  }

  /** Recognition failures, in the words of the cook's problem, not the code's. */
  const RECOGNITION_ERRORS = {
    "not-allowed": "This browser is not allowed to use the microphone — check the permission prompt.",
    "service-not-allowed": "This browser will not let the page use its speech service.",
    "audio-capture": "No microphone was found on this device.",
    network: "This browser could not reach its speech service, so it cannot hear you.",
    "no-speech": "I did not hear anything — try again, a little closer to the microphone.",
    "language-not-supported": "This browser has no speech model for that language.",
  };

  /* -- the written record --------------------------------------------------- */

  function loadVoiceLog() {
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem(VOICE_LOG_KEY) || "[]"); } catch (e) { saved = []; }
    voiceLog = Array.isArray(saved)
      ? saved.filter(t => t && t.text && (t.who === "you" || t.who === "cookalong")).slice(-VOICE_LOG_MAX)
      : [];
  }

  function saveVoiceLog() {
    try { localStorage.setItem(VOICE_LOG_KEY, JSON.stringify(voiceLog)); } catch (e) { /* private mode */ }
  }

  function logTurn(who, text) {
    const clean = String(text || "").trim();
    if (!clean) return;
    voiceLog.push({ who, text: clean, at: new Date().toISOString() });
    if (voiceLog.length > VOICE_LOG_MAX) voiceLog = voiceLog.slice(-VOICE_LOG_MAX);
    saveVoiceLog();
    // While the panel is open the cook is reading it, so nothing is unread.
    const open = !$("conversation-panel").classList.contains("hidden");
    if (open) renderConvo();
    else voiceUnread += 1;
    renderConvoBadge();
  }

  function clearConvo() {
    if (!voiceLog.length) { showToast("Nothing has been said yet", 2400); return; }
    const gone = voiceLog.length;
    voiceLog = [];
    voiceUnread = 0;
    saveVoiceLog();
    renderConvo();
    renderConvoBadge();
    showToast(`💬 Cleared ${gone} turn${gone === 1 ? "" : "s"}`, 2600);
  }

  function renderConvo() {
    const list = $("convo-list");
    if (!list) return;
    list.innerHTML = "";
    voiceLog.forEach(turn => {
      const li = document.createElement("li");
      li.className = `convo-turn ${turn.who}`;
      const who = document.createElement("span");
      who.className = "convo-who";
      who.textContent = turn.who === "you" ? "You" : "CookAlong";
      const text = document.createElement("span");
      text.className = "convo-said";
      text.textContent = turn.text;
      li.append(who, text);
      list.appendChild(li);
    });
    const empty = $("convo-empty");
    if (empty) empty.classList.toggle("hidden", voiceLog.length > 0);
    const summary = $("convo-summary");
    if (summary) {
      const mine = voiceLog.filter(t => t.who === "you").length;
      const theirs = voiceLog.length - mine;
      summary.textContent = voiceLog.length
        ? `${mine} thing${mine === 1 ? "" : "s"} heard, ${theirs} answered.`
        : "Nothing on the record yet.";
    }
  }

  function renderConvoBadge() {
    const badge = $("btn-convo-badge");
    if (!badge) return;
    const heard = voiceLog.filter(t => t.who === "you").length;
    badge.classList.toggle("has-unread", voiceUnread > 0);
    const text = $("convo-badge-text");
    if (text) text.textContent = voiceUnread ? `${voiceUnread} new` : "Chat";
    badge.title = voiceUnread
      ? `${voiceUnread} new turn${voiceUnread === 1 ? "" : "s"} since you last looked`
      : heard
        ? `What you and CookAlong have said — ${heard} thing${heard === 1 ? "" : "s"} heard so far`
        : "Nothing said yet — open this to see what you can say";
  }

  function openConvo() {
    renderConvo();
    $("conversation-panel").classList.remove("hidden");
    voiceUnread = 0;
    renderConvoBadge();
    focusEl($("convo-list").querySelector(".convo-turn") || $("btn-convo-close"));
  }

  function closeConvo() {
    $("conversation-panel").classList.add("hidden");
    setConvoHelp(false);
    focusEl(defaultFocus());
  }

  function toggleConvoHelp() {
    setConvoHelp($("convo-help").classList.contains("hidden"));
  }

  function setConvoHelp(open) {
    const panel = $("convo-help");
    const button = $("btn-convo-help");
    if (!panel || !button) return;
    panel.classList.toggle("hidden", !open);
    button.setAttribute("aria-expanded", String(open));
    button.textContent = open ? "Hide the list" : "What can I say?";
    // Asking for the list is a request to read it, so bring it into view rather
    // than leaving it below the fold of a dialog that scrolls.
    if (open && panel.scrollIntoView) panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  /**
   * Render the command table. The help view in the panel and the card at the
   * foot of the home screen both call this, so neither can describe a command
   * the matcher does not have, and adding a command to the table adds it to
   * every place the app teaches it.
   *
   * Grouped by where the command works rather than by precedence, because a
   * cook reads this to find a phrase, not to trace the matcher.
   */
  function renderCommandList(target) {
    if (!target) return;
    target.innerHTML = "";
    if (!VOICE) return;
    const rows = VOICE.help();
    Object.keys(VOICE.SCOPE_LABEL).forEach(scope => {
      const group = rows.filter(row => row.scope === scope);
      if (!group.length) return;
      const head = document.createElement("li");
      head.className = "cmd-scope";
      head.textContent = VOICE.SCOPE_LABEL[scope];
      target.appendChild(head);
      group.forEach(row => {
        const li = document.createElement("li");
        li.className = "cmd-row";
        const say = document.createElement("span");
        say.className = "cmd-say";
        say.textContent = `“${row.say}”`;
        const help = document.createElement("span");
        help.className = "cmd-help";
        help.textContent = row.help;
        li.append(say, help);
        target.appendChild(li);
      });
    });
  }

  /** "a, b and c" — a list that can be read out loud without sounding like a dump. */
  function listWords(items) {
    const list = (items || []).filter(Boolean);
    if (!list.length) return "nothing yet";
    if (list.length === 1) return list[0];
    return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
  }

  /**
   * How every answer leaves the app: a line in the top bar, a row in the
   * transcript, and — only where the device really has a voice — the same words
   * out loud.
   *
   * This funnel is what makes the answer visible on a Fire TV, where speak() is
   * a deliberate no-op because there is nothing to speak through. The old code
   * called speak() and stopped there, so the answer to a spoken command was
   * discarded on exactly the device the app is built for.
   */
  function answer(reply, options) {
    if (!reply) { restVoice(); return ""; }
    const opts = options || {};
    const r = typeof reply === "string" ? { status: reply, say: reply } : reply;
    const say = String(r.say || r.status || "").trim();
    const status = String(r.status || say).trim();
    // `log: false` is for answers nobody asked for — the re-rank that follows an
    // allergy change, say. They still belong on the top bar, but writing them
    // into the transcript inserts a remark into the middle of an exchange the
    // cook did not have, and the record stops reading like a conversation.
    if (say && opts.log !== false) logTurn("cookalong", say);
    setVoiceState(r.state || "answered", status);
    if (say) speak(say, !!r.interrupt);
    // An answer is worth reading for a few seconds, then the line is better
    // spent offering the next move — but only if the cook has not moved on.
    clearTimeout(answerRestHandle);
    answerRestHandle = setTimeout(() => {
      const el = $("voice-text");
      if (el && el.textContent !== status) return;
      restVoice();
    }, 9000);
    return say;
  }

  function applyMuteState() {
    $("mute-icon").textContent = voiceMuted ? "🔇" : "🔊";
    $("mute-label").textContent = voiceMuted ? "Voice off" : "Voice on";
    $("btn-mute").setAttribute("aria-pressed", String(voiceMuted));
    $("btn-mute").classList.toggle("active", voiceMuted);
    if (voiceMuted && window.speechSynthesis) window.speechSynthesis.cancel();
  }

  function toggleMute() {
    voiceMuted = !voiceMuted;
    try { localStorage.setItem(MUTE_KEY, voiceMuted ? "1" : "0"); } catch (e) { /* private mode */ }
    applyMuteState();
    showToast(voiceMuted ? "🔇 Spoken guidance off" : "🔊 Spoken guidance on", 2500);
    if (!voiceMuted) speak("Voice guidance on.");
  }

  function restoreMuteState() {
    try { voiceMuted = localStorage.getItem(MUTE_KEY) === "1"; } catch (e) { voiceMuted = false; }
    applyMuteState();
  }

  /* ---------------- Device capabilities: does this thing actually speak? ---- */

  const CAP = window.CookalongCapabilities || null;
  let capabilities = null;
  let capSummary = null;
  let silentNoticeShown = false;
  let voiceStatusLive = false;
  let wakeLockSentinel = null;

  /** The live browser environment, as plain data the engine can measure. */
  function readEnvironment() {
    let store = null;
    try { store = window.localStorage; } catch (e) { store = null; }   // access itself can throw
    return {
      userAgent: navigator.userAgent || "",
      speechSynthesis: window.speechSynthesis,
      SpeechRecognition: window.SpeechRecognition,
      webkitSpeechRecognition: window.webkitSpeechRecognition,
      wakeLock: navigator.wakeLock,
      localStorage: store,
    };
  }

  function refreshCapabilities() {
    if (!CAP) return null;
    capabilities = CAP.detect(readEnvironment());
    capSummary = CAP.summarize(capabilities);
    return capSummary;
  }

  /**
   * Make the app tell the truth about what it can do here.
   *
   * A Fire TV exposes speechSynthesis and installs no voice, so the previous
   * code called speak() into the void and left a microphone button whose only
   * possible outcome was an error. Neither is acceptable in a product whose
   * whole pitch is hands-free: one is silent, the other is a dead control.
   * So when the device cannot speak, the screen becomes the primary channel
   * (see `body.screen-first`) and the microphone button is repurposed into the
   * thing that explains the situation.
   */
  function applyCapabilityUI() {
    if (!capSummary) return;
    const status = $("voice-status");
    if (status) status.classList.toggle("nospeech", !capSummary.spokenPrimary);
    document.body.classList.toggle("screen-first", capSummary.mode === "screen");

    const micLabel = $("mic-label");
    const micIcon = $("mic-icon");
    const micBtn = $("btn-voice");
    if (capSummary.canListen) {
      if (micLabel) micLabel.textContent = "Voice";
      if (micIcon) micIcon.textContent = "🎙";
      if (micBtn) micBtn.title = "Talk to this screen (browser speech recognition)";
    } else {
      if (micLabel) micLabel.textContent = "Device check";
      if (micIcon) micIcon.textContent = "🔍";
      if (micBtn) micBtn.title = "This screen cannot listen — see what it can do instead";
    }

    // Voices can arrive after first paint, so the capability line has to be
    // allowed to correct itself once the real answer is known.
    setDefaultVoiceStatus();
  }

  /**
   * What the resting line says.
   *
   * It used to point at the remote's Alexa button and nothing else, which told
   * a first-time cook nothing about the microphone sitting two centimetres to
   * the right of the sentence. The line now names the control that is actually
   * on screen, and the 💬 button, because the list of what the app understands
   * is behind it.
   */
  function defaultVoiceStatus() {
    const canListen = !!(capSummary && capSummary.canListen);
    const spoken = !!(capSummary && capSummary.spokenPrimary);
    if (canListen) {
      return spoken
        ? "Press 🎙 and talk — or 💬 to see what you can say"
        : "Press 🎙 and talk — answers stay on screen here";
    }
    if (spoken) return "This screen cannot listen — use the remote's Alexa button";
    return "No voice in or out here — press 💬 to see what you can say";
  }

  function probeRows() {
    const c = capabilities || {};
    const speech = c.speech || {};
    const recognition = c.recognition || {};
    const wakeLock = c.wakeLock || {};
    const storage = c.storage || {};

    return [
      {
        name: "Spoken guidance",
        detail: speech.status === "no-voices"
          ? `${speech.voices || 0} voices installed — the API exists but would say nothing`
          : speech.status === "ok" ? `${speech.voices} voices installed` : "no speechSynthesis at all",
        state: speech.speakable ? "ok" : "bad",
        label: speech.speakable ? "works" : (speech.status === "no-voices" ? "silent" : "missing"),
      },
      {
        name: "Voice input in this screen",
        detail: recognition.supported
          ? "SpeechRecognition is available"
          : "no SpeechRecognition — talk through the remote's Alexa button",
        state: recognition.supported ? "ok" : "warn",
        label: recognition.supported ? "works" : "unavailable",
      },
      {
        name: "Remote / arrow keys",
        detail: "D-pad focus handling is built into this page",
        state: "ok",
        label: "works",
      },
      {
        name: "Screen wake lock",
        detail: wakeLock.supported
          ? "the screen can be held awake while cooking"
          : "not offered by this browser",
        state: wakeLock.supported ? "ok" : "warn",
        label: wakeLock.supported ? "works" : "unavailable",
      },
      {
        name: "Local storage",
        detail: storage.writable
          ? "pantry, allergies and progress persist between visits"
          : "nothing will persist between visits",
        state: storage.writable ? "ok" : "bad",
        label: storage.writable ? "works" : "blocked",
      },
    ];
  }

  /**
   * The paste-ready report. This is the friction-log artefact: it is produced
   * on the device that misbehaved, so the environment never has to be
   * reconstructed from memory later.
   */
  function selfCheckReport() {
    if (!CAP) return "CookAlong TV - device check\ncapability engine unavailable";
    return CAP.formatReport(capabilities, capSummary, { at: new Date().toISOString() });
  }

  function renderSelfCheck() {
    refreshCapabilities();
    if (!capSummary) return;

    const summary = $("selfcheck-summary");
    if (summary) summary.textContent = `${capSummary.headline} ${capSummary.action}`;

    const list = $("selfcheck-list");
    if (list) {
      list.innerHTML = "";
      probeRows().forEach(row => {
        const li = document.createElement("li");
        li.className = "probe-row";
        const name = document.createElement("span");
        name.className = "probe-name";
        name.textContent = row.name;
        const detail = document.createElement("span");
        detail.className = "probe-detail";
        detail.textContent = row.detail;
        const state = document.createElement("span");
        state.className = `probe-state ${row.state}`;
        state.textContent = row.label;
        li.append(name, detail, state);
        list.appendChild(li);
      });
    }
    applyCapabilityUI();
  }

  function openSelfCheck() {
    if (!CAP) { showToast("Device check is unavailable — the capability engine didn't load.", 4000); return; }
    renderSelfCheck();
    $("selfcheck").classList.remove("hidden");
    focusEl($("btn-selfcheck-close"));
  }

  function closeSelfCheck() {
    $("selfcheck").classList.add("hidden");
    focusEl(defaultFocus());
  }

  function copySelfCheckReport() {
    const report = selfCheckReport();
    const done = () => showToast("📋 Device report copied — paste it into a bug report.", 3500);
    // The async clipboard API is not guaranteed on a TV browser, so fall back
    // to the old selection trick rather than leaving the cook with nothing.
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(report).then(done).catch(() => legacyCopy(report, done));
      return;
    }
    legacyCopy(report, done);
  }

  function legacyCopy(text, done) {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      if (ok) done();
      else showToast("Couldn't copy automatically — the report is on screen above.", 5000);
    } catch (e) {
      showToast("Couldn't copy automatically — the report is on screen above.", 5000);
    }
  }

  /** Keep the TV awake while a recipe is open. Failure is not worth a dialog. */
  function acquireWakeLock() {
    if (!capabilities || !capabilities.wakeLock.supported || wakeLockSentinel) return;
    if (document.hidden) return;
    try {
      navigator.wakeLock.request("screen").then(sentinel => {
        wakeLockSentinel = sentinel;
        sentinel.addEventListener("release", () => { wakeLockSentinel = null; });
      }).catch(() => { /* denied at runtime — cooking still works */ });
    } catch (e) { /* request threw synchronously */ }
  }

  function releaseWakeLock() {
    if (!wakeLockSentinel) return;
    try { wakeLockSentinel.release(); } catch (e) { /* already released */ }
    wakeLockSentinel = null;
  }

  /**
   * One utterance, end to end: show it, match it, answer it.
   *
   * The transcript is recorded here rather than in the recognition callbacks,
   * because this is the only place a heard sentence becomes an action — so the
   * panel is a record of what the app acted on, not of everything the recogniser
   * happened to guess at. The yield before responding is what makes "thinking"
   * visible at all: the match is synchronous, so without it the state would be
   * set and replaced inside a single frame.
   */
  function interpret(transcript) {
    const said = String(transcript || "").trim();
    if (voiceSession) voiceSession.handled = true;
    stopVoiceRecognition();
    if (!said) { restVoice(); return; }
    logTurn("you", said);
    setVoiceState("thinking", `“${said}” — thinking…`);
    setTimeout(() => respond(said), 180);
  }

  /**
   * Match one utterance against the command table and run what it names.
   *
   * Which commands exist, and which of them a phrase belongs to, is decided
   * entirely by src/voice-commands.js — the same table the cheatsheet and the
   * help panel are rendered from. Nothing here re-implements a rule, because a
   * second copy of a rule is how the advertised list and the working list drift
   * apart.
   */
  function respond(said) {
    if (!VOICE) {
      answer({
        state: "error",
        status: "Voice commands are unavailable",
        say: "The command table did not load, so I cannot match what you said. Try the buttons, or reload the page.",
      });
      return;
    }

    const hit = VOICE.findCommand(said, {
      recipes,
      allergens: (engine && engine.COMMON_ALLERGENS) || [],
      atHome: !viewHome.classList.contains("hidden"),
      hasRecipe: !!currentRecipe,
    });

    if (!hit) {
      // Honest, and pointed: say that it did not understand, and say where the
      // list of things it does understand is. "Nothing happened" is the outcome
      // that makes a cook conclude the microphone is broken.
      answer({
        state: "error",
        status: "I didn't catch that — 💬 has the list",
        say: `I did not catch “${said}”. I did not catch that. ` +
          "Press the 💬 button to see what I can do, or try “what can I cook”.",
      });
      return;
    }

    const action = VOICE_ACTIONS[hit.id];
    if (!action) {
      answer({
        state: "error",
        status: "That command has no action",
        say: `I know “${hit.command.say}” but nothing is wired up for it. Press 💬 and try another one.`,
      });
      return;
    }
    answer(action(hit.capture, said));
  }

  /** The diet chips, with an answer that says which list is now on screen. */
  function applyDiet(diet) {
    activateDiet(diet);
    const label = diet === "any" ? "all recipes" : `${diet} recipes`;
    return { status: `Showing ${label}`, say: `Showing ${label}.` };
  }

  /** The question a step-at-a-time recipe cannot answer: what actually takes longest. */
  function cookPlanReply() {
    if (!currentRecipe || !PLAN) {
      return {
        status: "Open a recipe and I'll lay out its timed steps",
        say: "Open a recipe first, and I will lay out the steps that name a time.",
      };
    }
    const plan = PLAN.summary(scaledSteps());
    if (!plan.timedCount) {
      return {
        status: `${currentRecipe.name} names no cooking times`,
        say: `${currentRecipe.name} does not name a cooking time in any step.`,
      };
    }
    const long = plan.longest;
    return {
      status: `${plan.timedCount} timed steps — longest ${shortDuration(long.seconds)} on step ${long.index + 1}`,
      say: `${plan.timedCount} of ${plan.totalCount} steps name a time, and the times they name add up to ` +
        `${humanDuration(plan.namedSeconds)}. The longest single wait is step ${long.index + 1}. ` +
        "Any of them can be started from the cook plan.",
    };
  }

  /**
   * What each command in the table does, keyed by the same id the table uses.
   *
   * The split is deliberate: the table owns how a phrase is recognised and what
   * the app teaches, this owns what happens next. An id in one without the other
   * is caught by `respond`, which says so out loud instead of failing silently.
   *
   * Every action returns the reply rather than speaking it, so the single
   * `answer()` funnel writes the top bar, the transcript and the voice — which
   * is how a command cannot end up answering on only one of them.
   */
  const VOICE_ACTIONS = {
    allergy: capture => {
      const known = (engine && engine.COMMON_ALLERGENS) || [];
      if (!capture.allergen) {
        return { status: "Which one?", say: `Which one? I know ${listWords(known)}.` };
      }
      const avoiding = activeAllergens.has(capture.allergen);
      if (capture.remove) {
        if (!avoiding) {
          return {
            status: `Not avoiding ${capture.allergen} anyway`,
            say: `I was not leaving ${capture.allergen} out.`,
          };
        }
        toggleAllergen(capture.allergen);
        return {
          status: `${capture.allergen} is back on the menu`,
          say: `${capture.allergen} is back on the menu.`,
        };
      }
      if (avoiding) {
        return {
          status: `Already avoiding ${capture.allergen}`,
          say: `I am already leaving ${capture.allergen} out.`,
        };
      }
      // Declaring an allergy sets it. A toggle would mean saying it twice
      // quietly put the ingredient back, which is the one direction this must
      // never move in on its own.
      toggleAllergen(capture.allergen);
      return {
        status: `Leaving ${capture.allergen} out from now on`,
        say: `Leaving ${capture.allergen} out of every recipe from now on.`,
      };
    },

    "open-recipe": capture => {
      openRecipe(capture.recipe.id);
      return { status: `Opening ${capture.recipe.name}`, say: `Opening ${capture.recipe.name}.` };
    },

    "diet-vegan": () => applyDiet("vegan"),
    "diet-vegetarian": () => applyDiet("vegetarian"),
    "diet-gluten-free": () => applyDiet("gluten-free"),
    "diet-all": () => applyDiet("any"),

    "timer-set": () => {
      const seconds = suggestedTimerSeconds();
      addStepTimer();
      return { status: `Timer added for ${humanDuration(seconds)}`, say: `Timer added for ${humanDuration(seconds)}.` };
    },
    "timer-pause": () => {
      const counting = rack ? rack.running().length : 0;
      if (counting) ensureRack().pauseAll();
      return counting
        ? {
          status: `${counting} timer${counting === 1 ? "" : "s"} paused`,
          say: `Paused ${counting === 1 ? "the timer" : `${counting} timers`}.`,
        }
        : { status: "Nothing was counting", say: "No timer was counting." };
    },
    "timer-resume": () => {
      const next = rack && rack.next();
      if (!next) {
        return { status: "There is no timer waiting to start", say: "There is no timer waiting to start." };
      }
      rack.start(next.id);
      return { status: `Started ${next.label || "the timer"}`, say: `Started ${next.label || "the timer"}.` };
    },
    "timer-status": () => {
      const live = rack ? rack.active() : [];
      if (!live.length) return { status: "No timers are running", say: "No timers are running." };
      const soonest = live[0];
      return {
        status: `${live.length} timer${live.length === 1 ? "" : "s"} — next ${fmt(soonest.timer.remainingSeconds)}`,
        say: `You have ${live.length} timer${live.length === 1 ? "" : "s"} going. ` +
          `Next is ${soonest.label || "a timer"}, ${soonest.timer.speak()} left.`,
      };
    },

    "kitchen-match": (capture, said) => {
      if (!viewRecipe.classList.contains("hidden")) $("btn-back").click();
      kitchenInput.value = said;
      return runKitchenMatch();
    },

    "add-missing": () => addMissingFromRecipe(),
    "read-shopping": () => readShopping(),
    "cook-plan": () => cookPlanReply(),

    "next-step": () => {
      if (currentStep < displaySteps().length - 1) {
        currentStep += 1;
        renderStep();
        return {
          status: `Step ${currentStep + 1} of ${scaledSteps().length}`,
          say: `Step ${currentStep + 1}. ${scaledSteps()[currentStep]}`,
        };
      }
      return {
        status: "That was the last step",
        say: `That was the last step. Enjoy your ${currentRecipe.name}!`,
      };
    },
    "prev-step": () => {
      if (currentStep <= 0) return { status: "This is the first step", say: "This is the first step." };
      currentStep -= 1;
      renderStep();
      return {
        status: `Step ${currentStep + 1} of ${scaledSteps().length}`,
        say: `Step ${currentStep + 1}. ${scaledSteps()[currentStep]}`,
      };
    },
    "repeat-step": () => ({ status: "Repeating the step", say: scaledSteps()[currentStep] }),
    "read-step": () => ({ status: "Reading the step", say: scaledSteps()[currentStep] }),

    "open-log": () => {
      openConvo();
      const heard = voiceLog.filter(t => t.who === "you").length;
      return heard
        ? {
          status: `${heard} thing${heard === 1 ? "" : "s"} heard so far`,
          say: `Here is our conversation — ${heard} thing${heard === 1 ? "" : "s"} so far.`,
        }
        : {
          status: "Nothing said yet",
          say: "We have not said anything yet. Press the microphone and ask me something.",
        };
    },

    help: () => {
      openConvo();
      setConvoHelp(true);
      return { status: "Here is what you can say", say: "Here is what you can say. The list is on screen now." };
    },
  };

  /**
   * Close the microphone, and mean it.
   *
   * `abort()` rather than `stop()`: a graceful stop flushes one last result,
   * and that result arrives *after* the app has already decided what to say —
   * so the app answers its own sentence through the microphone it is still
   * holding open. The reference is cleared first for the same reason: nothing
   * downstream may act on a session that is already over.
   */
  function stopVoiceRecognition() {
    const recognition = voiceRecognition;
    if (!recognition) return;
    voiceRecognition = null;
    voiceListening = false;
    try { recognition.abort(); } catch (e) { /* already closed */ }
  }

  /**
   * Open the microphone — and be honest about it if it never really opens.
   *
   * The old advice was that a microphone button either works or throws. It does
   * not. A browser will hand back a SpeechRecognition object, accept start(), and
   * then produce no events at all when it cannot reach a speech service, which is
   * exactly what chromium does in the browser this app is verified in. The old
   * code wrote "Listening… speak a command" and left it there indefinitely, so
   * the screen went on insisting it was awake while nothing whatsoever happened.
   *
   * Every way this can end now ends in words: a result, a named error, a
   * timeout, or an end with nothing heard. There is no path that leaves the line
   * claiming to listen.
   */
  function toggleVoice() {
    // No in-page microphone on this device: route to the panel that explains
    // how to talk, instead of a control whose only outcome is a complaint.
    if (capSummary && !capSummary.canListen) { openSelfCheck(); return; }
    // Tapping again while it is open is a request to stop.
    if (voiceRecognition) {
      // A deliberate stop is not a failure, so mark the session handled before
      // anything can report it as one.
      if (voiceSession) voiceSession.handled = true;
      stopVoiceRecognition();
      // The browser that started this whole section emits no events at all, so
      // `onend` cannot be relied on to tidy up — and if it never fires, the next
      // tap would be a request to stop a session that is already over, and the
      // button would be dead for the rest of the cook. Clearing here is what
      // makes the stop path deterministic; `onend` still runs and is harmless.
      clearVoiceWatchdog();
      voiceRecognition = null;
      voiceListening = false;
      restVoice();
      return;
    }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { showToast("Voice recognition isn't supported in this browser.", 4000); return; }

    const recognition = new SR();
    voiceRecognition = recognition;
    voiceSession = { final: "", interim: "", handled: false, live: false };

    recognition.lang = "en-US";
    // The cook asked to see themselves talking. interimResults is what puts the
    // words on screen while they are still being said; without it the line reads
    // "Listening…" and stays that way until the whole sentence is over, which is
    // indistinguishable from a hang.
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    // The first real sign of life ends the grace period and starts the limit:
    // from here the microphone is genuinely open, so the only remaining question
    // is whether the utterance ever finishes.
    const onLive = () => {
      if (!voiceSession || voiceSession.live) return;
      voiceSession.live = true;
      armVoiceWatchdog(LISTEN_LIMIT_MS, onTooLong);
    };
    recognition.onstart = onLive;
    recognition.onaudiostart = onLive;
    recognition.onspeechstart = onLive;
    recognition.onsoundstart = onLive;

    recognition.onresult = event => {
      // A session that has already been answered, given up on, or stopped must
      // not answer again. Without this the recogniser's late results are treated
      // as new commands, each one answered out loud into the microphone that is
      // still open — and the app spends the rest of the cook talking to itself.
      if (!voiceSession || voiceSession.handled) return;
      onLive();
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const words = result[0] ? result[0].transcript : "";
        if (result.isFinal) voiceSession.final += words;
        else interim += words;
      }
      voiceSession.interim = interim;
      const heard = (voiceSession.final + interim).trim();
      if (heard) setVoiceState("listening", `“${heard}”`);
      if (voiceSession.final.trim()) interpret(voiceSession.final.trim());
    };

    recognition.onerror = event => {
      const code = (event && event.error) || "unknown";
      // Tapping the microphone again to stop it is not a failure to report —
      // and neither is the `aborted` we raise ourselves when closing the
      // microphone, which arrives after the answer is already being given.
      if (code === "aborted") {
        if (!voiceSession || !voiceSession.handled) restVoice();
        return;
      }
      if (voiceSession) voiceSession.handled = true;
      const line = RECOGNITION_ERRORS[code] || `This browser's speech recogniser failed (${code}).`;
      answer({
        state: "error",
        status: line,
        say: `${line} Use the remote, or press 💬 to see what I can do.`,
      });
    };

    recognition.onend = () => {
      const session = voiceSession;
      clearVoiceWatchdog();
      voiceRecognition = null;
      voiceListening = false;
      if (!session || session.handled) return;
      // A sentence cut off before it was finalised is still worth acting on: the
      // cook said it, and being ignored is worse than being answered.
      const heard = (session.final || session.interim).trim();
      if (heard) { interpret(heard); return; }
      session.handled = true;
      answer({
        state: "error",
        status: "I didn't catch that",
        say: "I did not make out anything. Try again, or press 💬 to see what I can do.",
      });
    };

    /** Something came back, but the utterance never finished. */
    function onTooLong() {
      if (!voiceSession || voiceSession.handled) return;
      voiceSession.handled = true;
      // Giving up has to close the microphone, not just forget it. This path
      // used to clear the reference and walk away, which left the recogniser
      // running: it kept producing results, each result was answered out loud,
      // and the microphone heard the answer and asked again. That is the loop
      // a cook hears as "it repeats forever".
      stopVoiceRecognition();
      answer({
        state: "error",
        status: "That took too long — I stopped listening",
        say: "That took too long, so I stopped listening. Try a shorter command, like “next step”.",
      });
    }

    /** Nothing came back at all: the microphone was never really open. */
    function onDeaf() {
      if (!voiceSession || voiceSession.handled) return;
      voiceSession.handled = true;
      // Same reason as the timeout above: an abandoned recogniser is a live
      // microphone, and a live microphone with a talking app is a feedback loop.
      stopVoiceRecognition();
      answer({
        state: "error",
        status: "No microphone is coming through",
        say: "This screen is not picking up the microphone — the browser's speech service " +
          "may be blocked, or there may be no microphone. Use the remote, or press 💬 to see what I can do.",
      });
    }

    voiceListening = true;
    setVoiceState("listening", "Listening… say something like “next step”");
    armVoiceWatchdog(LISTEN_GRACE_MS, onDeaf);

    try {
      recognition.start();
    } catch (e) {
      // Some browsers throw synchronously when no microphone is attached.
      clearVoiceWatchdog();
      voiceRecognition = null;
      voiceListening = false;
      voiceSession.handled = true;
      answer({
        state: "error",
        status: "Could not open the microphone",
        say: "Could not open the microphone. Use the remote, or the remote's Alexa button.",
      });
    }
  }

  function activateDiet(diet) {
    activeDiet = diet;
    filtersBox.querySelectorAll(".chip").forEach(c => c.classList.toggle("active", c.dataset.diet === diet));
    renderGrid();
  }

  /* ---------------- Kitchen: "What's in my kitchen?" ---------------- */
  const engine = window.CookalongIngredients || null;
  const kitchenInput = $("kitchen-input");
  const kitchenChips = $("kitchen-chips");
  const kitchenResults = $("kitchen-results");
  const kitchenBox = $("kitchen");
  const pantryChips = $("pantry-chips");
  const PANTRY_KEY = "cookalong.pantry.v1";
  const TONIGHT_KEY = "cookalong.tonight.v1";
  const QUICK_INGREDIENTS = ["chicken", "garlic", "rice", "tomato", "broccoli", "eggs", "mushrooms", "tofu", "shrimp", "beef", "bananas", "lemon", "pasta", "carrot", "onion"];
  let pantry = null;
  let lastAsked = null;

  function initPantry() {
    if (!engine || !engine.Pantry) return;
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem(PANTRY_KEY) || "[]"); } catch (e) { saved = []; }
    pantry = engine.Pantry.fromJSON(saved);
    renderPantry();
  }

  function savePantry() {
    try { localStorage.setItem(PANTRY_KEY, JSON.stringify(pantry.all())); } catch (e) { /* private mode */ }
    renderPantry();
  }

  function renderPantry() {
    if (!pantryChips || !pantry) return;
    pantryChips.innerHTML = "";
    pantry.all().forEach(canon => {
      const chip = document.createElement("button");
      chip.className = "chip pantry-chip";
      chip.type = "button";
      chip.title = "Tap to mark as used";
      chip.textContent = engine.displayName(canon);
      chip.addEventListener("click", () => {
        pantry.consume(canon);
        savePantry();
        showToast(`🍱 ${engine.displayName(canon)} marked as used`, 2500);
      });
      pantryChips.appendChild(chip);
    });
    if (!pantry.size) {
      const empty = document.createElement("span");
      empty.className = "pantry-empty";
      empty.textContent = "empty — save ingredients you always keep";
      pantryChips.appendChild(empty);
    }
    const clear = $("btn-pantry-clear");
    if (clear) clear.disabled = !pantry.size;
  }

  /** Autocomplete the kitchen input from every ingredient the engine knows. */
  function renderIngredientSuggestions() {
    const list = $("ingredient-suggestions");
    if (!list || !engine) return;
    list.innerHTML = "";
    Object.keys(engine.ALIASES || {}).forEach(canonical => {
      const option = document.createElement("option");
      option.value = canonical;
      option.label = engine.displayName(canonical);
      list.appendChild(option);
    });
  }

  /**
   * The hint and the quick chips exist to help the cook ask the question. Once
   * there is an answer they step aside, because they are the tallest part of the
   * preamble and the answer is what the cook came for: measured in a 720p
   * Fire TV viewport the preamble alone ran to ~705px, taller than the screen,
   * so the decision card began below the fold and was invisible without
   * scrolling. Composing again brings them back, and "composing" is decided by
   * the input actually differing from the kitchen we last answered — not by
   * focus, so pressing Enter to re-ask the same kitchen does not push the answer
   * back off the screen.
   */
  function updateComposing() {
    if (!kitchenBox || !kitchenInput) return;
    kitchenBox.classList.toggle("is-editing", kitchenInput.value.trim() !== (lastAsked || ""));
  }

  function setKitchenMode(hasDecision) {
    if (!kitchenBox) return;
    kitchenBox.classList.toggle("has-decision", !!hasDecision);
    updateComposing();
  }

  function renderKitchenChips() {
    if (!engine || !kitchenChips) return;
    kitchenChips.innerHTML = "";
    QUICK_INGREDIENTS.forEach(name => {
      const chip = document.createElement("button");
      chip.className = "chip kitchen-chip";
      chip.type = "button";
      chip.textContent = name;
      chip.addEventListener("click", () => {
        const cur = kitchenInput.value.trim();
        kitchenInput.value = cur ? `${cur}, ${name}` : name;
        kitchenInput.focus();
      });
      kitchenChips.appendChild(chip);
    });
  }

  // Listing options and naming a winner are different promises. A browse list
  // can afford to be generous; the decision uses the engine's own floor.
  const KITCHEN_FLOOR = 25;
  const KITCHEN_LIMIT = 5;

  /**
   * A decision is remembered against the kitchen that produced it. "Another one"
   * must still be showing the same second answer after a reload — an answer that
   * changes under the cook's feet is not an answer — but the memory is worthless
   * once the ingredients change, so the signature resets it.
   */
  function kitchenSignature(have) { return [...have].sort().join("|"); }

  function loadTonight(signature) {
    try {
      const saved = JSON.parse(localStorage.getItem(TONIGHT_KEY) || "null");
      if (saved && saved.signature === signature && Array.isArray(saved.avoided)) return saved.avoided;
    } catch (e) { /* private mode, or junk in the key */ }
    return [];
  }

  function saveTonight(signature, avoided) {
    try {
      localStorage.setItem(TONIGHT_KEY, JSON.stringify({ signature, avoided }));
    } catch (e) { /* private mode */ }
  }

  /** A labelled group that stays folded until asked for. */
  function kitchenFold(label, nodes) {
    const wrap = document.createElement("div");
    wrap.className = "kitchen-fold";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn small kitchen-fold-toggle";
    btn.setAttribute("aria-expanded", "false");
    btn.textContent = label;
    const body = document.createElement("div");
    body.className = "kitchen-fold-body hidden";
    nodes.forEach(n => body.appendChild(n));
    btn.addEventListener("click", () => {
      const hidden = body.classList.toggle("hidden");
      btn.setAttribute("aria-expanded", String(!hidden));
    });
    wrap.appendChild(btn);
    wrap.appendChild(body);
    return wrap;
  }

  function runKitchenMatch() {
    if (!engine) { showToast("Ingredient engine not loaded.", 3500); return; }
    const { recognized, unknown } = engine.parseIngredientList(kitchenInput.value);
    if (!recognized.length) {
      const got = unknown.length
        ? ` — I didn't get: ${esc(unknown.join(", "))}`
        : "";
      kitchenResults.innerHTML = `<p class="kitchen-empty">I couldn't recognise any ingredients. Try things like “chicken, garlic, rice”${got}.</p>`;
      setKitchenMode(false);
      return;
    }

    const have = Array.from(new Set([...recognized, ...(pantry ? pantry.all() : [])]));
    const profile = currentProfile();

    // The exclusion-aware call is the point: it reports not just which recipes
    // fit, but which ones were removed and for what reason. Without it an
    // allergy filter silently shrinks the list with no explanation.
    const { matches: scored, excluded } = engine.matchRecipesWithExclusions(have, recipes, profile);
    const browse = scored.filter(m => m.score >= KITCHEN_FLOOR).slice(0, KITCHEN_LIMIT);
    const allergyHidden = excluded.filter(m =>
      (m.excludedReasons || []).some(r => r.startsWith("contains ")));

    // The decision and the list below it read from the same scored array, so the
    // dish the banner names is by construction a dish the list also contains —
    // rather than a second opinion computed here and free to drift from it.
    const signature = kitchenSignature(have);
    const decision = engine.suggest(scored, { avoid: loadTonight(signature) });

    // Remember the kitchen this answer belongs to before rendering, so the
    // composing aids can tell "reading the answer" from "changing the question".
    lastAsked = kitchenInput.value.trim();
    setKitchenMode(!!decision);

    kitchenResults.innerHTML = "";
    if (allergyHidden.length) {
      const reasons = [...new Set(allergyHidden.flatMap(m => m.excludedReasons))].join(" · ");
      const note = document.createElement("p");
      note.className = "kitchen-hidden";
      note.textContent = `🚫 ${allergyHidden.length} recipe${allergyHidden.length === 1 ? "" : "s"} hidden — ${reasons}.`;
      kitchenResults.appendChild(note);
    }

    if (!browse.length) {
      // Built as a node rather than by concatenating innerHTML, so the banner
      // above survives the "nothing scored high enough" case too.
      const empty = document.createElement("p");
      empty.className = "kitchen-empty";
      empty.textContent = `Nothing scores high enough with only: ${recognized.map(engine.displayName).join(", ")}. Add more ingredients for better matches.`;
      kitchenResults.appendChild(empty);
      return;
    }

    const cookable = browse.filter(m => (m.missingHard || []).length === 0);
    const shopping = browse.filter(m => (m.missingHard || []).length > 0);
    const alsoReady = decision
      ? decision.alternatives.filter(m => m.recipe.id !== decision.pick.recipe.id)
      : [];

    const note = document.createElement("p");
    note.className = "kitchen-empty";

    if (decision) {
      const card = kitchenMatchCard(decision.pick, profile, have, {
        decided: true,
        ready: decision.ready,
        // "Another one" walks down the same ranking rather than re-rolling, so
        // the second answer is the runner-up and not a different dish each time.
        onAnother: () => {
          const next = loadTonight(signature).concat([decision.pick.recipe.id]);
          saveTonight(signature, next);
          askKitchen();
        },
      });
      card.classList.add("is-decided");
      kitchenResults.appendChild(card);
      if (alsoReady.length) {
        kitchenResults.appendChild(kitchenFold(
          `Also ready right now (${alsoReady.length})`,
          alsoReady.slice(0, KITCHEN_LIMIT - 1).map(m => kitchenMatchCard(m, profile, have))
        ));
      }
    } else if (cookable.length) {
      // Cookable, but none of them clears the bar for "tonight it is this".
      // Saying nothing rather than promoting the least-bad option is the point.
      note.textContent = "You could cook these, but none of them is a confident pick yet — you are part of the way to each.";
      kitchenResults.appendChild(note);
      cookable.slice(0, KITCHEN_LIMIT).forEach(m => kitchenResults.appendChild(kitchenMatchCard(m, profile, have)));
    } else {
      note.textContent = `Nothing here can be cooked without a shop yet. With ${recognized.map(engine.displayName).join(", ")}, the closest are:`;
      kitchenResults.appendChild(note);
    }

    if (shopping.length) {
      kitchenResults.appendChild(kitchenFold(
        `Needs shopping (${shopping.length})`,
        shopping.map(m => kitchenMatchCard(m, profile, have))
      ));
    }

    // The answer leads with the dish, and says the same thing the card says.
    // "One swap and you are there" on its own invites the cook to hear "no
    // shopping needed", which is exactly what a swap does not promise; with the
    // screen off, the spoken line is the only line there is.
    //
    // It is returned rather than spoken here so that the one funnel writes the
    // top bar, the transcript and the voice together — and so the voice command
    // that asked the question and the button that asked it give the same answer
    // in the same words.
    const reply = {
      status: decision ? `Tonight: ${decision.pick.recipe.name}` : `Found ${browse.length} matches`,
      say: decision
        ? `Tonight, cook ${decision.pick.recipe.name}. ` +
          (decision.ready
            ? "You have everything it needs."
            : "Nothing essential is missing — one swap and you are there.")
        : `I found ${browse.length} recipes you can make.`,
    };
    showToast(decision
      ? `🧺 Tonight: ${decision.pick.recipe.name}`
      : `🧺 ${browse.length} recipe${browse.length > 1 ? "s" : ""} matched`, 3000);
    return reply;
  }

  /**
   * The same question asked with the remote instead of the microphone.
   *
   * `runKitchenMatch` works out the answer and returns it; whoever asked decides
   * how to deliver it. Both routes deliver it through `answer()` so the top bar,
   * the transcript and the voice say the same thing — otherwise the log would
   * only record half of the conversations a cook actually had.
   */
  function askKitchen(logged) {
    const reply = runKitchenMatch();
    if (reply) answer(reply, { log: logged !== false });
    return reply;
  }

  function saveKitchenInputToPantry() {
    if (!engine || !pantry) { showToast("Pantry not available.", 3000); return; }
    const { recognized, unknown } = engine.parseIngredientList(kitchenInput.value);
    if (!recognized.length) { showToast("Nothing recognisable to save — try “chicken, garlic”.", 3000); return; }
    recognized.forEach(c => pantry.restock(c));
    savePantry();
    setVoiceStatus(`Saved ${recognized.length} ingredient${recognized.length > 1 ? "s" : ""} to pantry`);
    showToast(`🍱 Saved to pantry: ${recognized.map(engine.displayName).join(", ")}`, 3500);
  }

  function clearPantry() {
    if (!pantry || !pantry.size) return;
    const count = pantry.size;
    pantry.all().forEach(c => pantry.consume(c));
    savePantry();
    setVoiceStatus(`Pantry cleared (${count} ingredient${count > 1 ? "s" : ""} removed)`);
    showToast(`🍱 Pantry cleared — ${count} ingredient${count > 1 ? "s" : ""} removed`, 3000);
    if (kitchenResults.children.length) askKitchen(false);
  }

  /**
   * Why a recipe scored what it scored: pantry staples and ingredients you
   * have earn full weight, a missing-but-swappable item earns half, a hard
   * miss earns nothing. Mirrors the engine's scoreOne().
   */
  function buildWhy(m) {
    const w = ing => (engine && engine.ingredientWeight ? engine.ingredientWeight(ing) : 1);
    const onHand = [];
    const swap = [];
    const miss = [];
    let total = 0;
    let onHandPts = 0;
    let swapPts = 0;
    (m.recipe.ingredients || []).forEach(ing => {
      const weight = w(ing);
      total += weight;
      if (ing.pantry || m.matched.includes(ing.canonical)) {
        onHand.push(ing.name);
        onHandPts += weight;
      } else if (m.missingSubstitutable.includes(ing.canonical)) {
        swap.push(ing.name);
        swapPts += weight * 0.5;
      } else {
        miss.push(ing.name);
      }
    });
    return { onHand, swap, miss, total, onHandPts, swapPts, earned: onHandPts + swapPts };
  }

  function kitchenMatchCard(m, profile, haveSet, opts) {
    const o = opts || {};
    const r = m.recipe;
    const card = document.createElement("article");
    card.className = "match-card";
    card.tabIndex = 0;
    const have = m.matched.map(engine.displayName).join(", ");
    const swaps = m.missingSubstitutable.map(c => {
      const sub = engine.findSubstitute(r, c, profile);
      return `${engine.displayName(c)} → ${sub ? sub.name : "swap"}`;
    });
    const missing = m.missingHard.map(engine.displayName).join(", ");
    const kcal = r.nutrition ? r.nutrition.kcal : null;
    const why = buildWhy(m);
    const pct = why.total ? Math.round((why.earned / why.total) * 100) : 0;
    const pts = n => (Math.round(n * 10) / 10).toString();

    // Every card says up front what it would cost the cook to make it, so the
    // groups below are legible without a filter and no card can imply it is
    // cheaper than it is.
    const ready = (m.missingHard || []).length === 0 && (m.missingSubstitutable || []).length === 0;
    const need = ready
      ? `<span class="match-need ready">nothing to buy</span>`
      : (m.missingHard || []).length
        ? `<span class="match-need shopping">${m.missingHard.length} to buy</span>`
        : `<span class="match-need swap">${m.missingSubstitutable.length} to swap</span>`;

    // The banner claims only what the match actually supports. "Ready" means
    // nothing is missing at all; a swap-only dish is still a substitution the
    // cook has to agree to, and it is described as exactly that.
    const tonight = o.decided
      ? `<div class="match-tonight">
          <span class="tonight-label">Tonight, cook this</span>
          <p class="tonight-why">${esc(o.ready
            ? "You have everything it needs — nothing to buy."
            : `Nothing essential is missing. ${m.missingSubstitutable.length} item${m.missingSubstitutable.length === 1 ? "" : "s"} can be swapped for something that fits your needs.`)}</p>
        </div>`
      : "";

    card.innerHTML = `
      ${tonight}
      <div class="match-head">
        <h4>${esc(r.name)}</h4>
        <span class="match-score">${need}${esc(m.score)}%${kcal ? ` · 🔥 ${kcal}` : ""}</span>
      </div>
      <div class="match-bar"><span style="width:${esc(m.score)}%"></span></div>
      <div class="match-body">
        ${have ? `<p class="m-ok">✓ ${esc(have)}</p>` : ""}
        ${swaps.length ? `<p class="m-swap">🔄 ${esc(swaps.join(" · "))}</p>` : ""}
        ${missing ? `<p class="m-miss">✗ ${esc(missing)}</p>` : ""}
      </div>
      <div class="match-why">
        <button class="match-why-toggle" type="button" aria-expanded="false">Why ${esc(m.score)}%?</button>
        <div class="match-why-body hidden">
          <div class="match-why-row"><span>✓ on hand — ${why.onHand.length} item${why.onHand.length === 1 ? "" : "s"}</span><span class="w">${pts(why.onHandPts)} pts</span></div>
          ${why.swap.length ? `<div class="match-why-row"><span>🔄 swappable — ${why.swap.length}, half credit</span><span class="w">${pts(why.swapPts)} pts</span></div>` : ""}
          ${why.miss.length ? `<div class="match-why-row"><span>✗ missing — ${esc(why.miss.join(", "))}</span><span class="w">0 pts</span></div>` : ""}
          <div class="match-why-row"><span>Weighted total</span><span class="w">${pts(why.earned)} / ${pts(why.total)} = ${pct}%</span></div>
          <p class="match-why-foot">Main ingredients weigh 3×, secondary 1×, seasonings 0.5×. Pantry staples are assumed on hand.</p>
        </div>
      </div>
      <div class="match-actions">
        <button class="btn primary match-cook" type="button">Cook it</button>
        <button class="btn match-shop" type="button">🛒 Add what's missing</button>
        ${o.onAnother ? `<button class="btn match-another" type="button">Another one</button>` : ""}
      </div>`;

    const toggle = card.querySelector(".match-why-toggle");
    const body = card.querySelector(".match-why-body");
    toggle.addEventListener("click", () => {
      const open = body.classList.toggle("hidden");
      toggle.setAttribute("aria-expanded", String(!open));
      toggle.textContent = open ? `Why ${m.score}%?` : "Hide breakdown";
    });

    card.querySelector(".match-cook").addEventListener("click", () => openRecipe(r.id, m, haveSet));
    card.querySelector(".match-shop").addEventListener("click", () => addMissingFromMatch(m, r));
    const another = card.querySelector(".match-another");
    if (another && o.onAnother) another.addEventListener("click", o.onAnother);
    // The card is focusable in its own right, so a key pressed on one of its
    // buttons bubbles up here and would open the recipe instead of doing what the
    // button says. Only keys on the card itself may mean "start cooking".
    card.addEventListener("keydown", e => {
      if (e.target !== card) return;
      if (e.key === "Enter" || e.key === " ") openRecipe(r.id, m, haveSet);
    });
    return card;
  }

  /* ---------------- Recipe: live ingredient swaps ---------------- */
  const swapList = $("swap-list");
  const swapPanel = $("swap-panel");

  function ingredientLabel(recipe, canonical) {
    const ing = (recipe.ingredients || []).find(i => i.canonical === canonical);
    if (ing) return ing.name;
    return engine ? engine.displayName(canonical) : canonical;
  }

  /** Every swap option that fits the recipe's diets + the active filter. */
  function compatibleOptions(recipe, canonical) {
    if (!engine) return [];
    const info = engine.listSubstitutes(recipe, canonical, currentProfile());
    return info.compatible || (info.chosen ? [info.chosen] : []);
  }

  /**
   * Which ingredients to offer a swap for:
   *  - opened from a kitchen match -> exactly the missing-but-swappable ones
   *  - opened from the grid        -> the first few swappable main/secondary items
   */
  function swapTargets() {
    if (!engine || !currentRecipe) return [];
    if (currentMatch) {
      return currentMatch.missingSubstitutable
        .filter(c => !activeSwaps[c])
        .map(c => ({ canonical: c, label: ingredientLabel(currentRecipe, c), options: compatibleOptions(currentRecipe, c) }))
        .filter(t => t.options.length);
    }
    const ROLE_ORDER = { main: 0, secondary: 1, seasoning: 2 };
    return (currentRecipe.ingredients || [])
      .filter(ing => !activeSwaps[ing.canonical])
      .map(ing => ({
        canonical: ing.canonical,
        label: ing.name,
        role: ing.role,
        options: compatibleOptions(currentRecipe, ing.canonical),
      }))
      .filter(t => t.options.length)
      .sort((a, b) => (ROLE_ORDER[a.role] ?? 3) - (ROLE_ORDER[b.role] ?? 3))
      .slice(0, 4)
      .map(({ canonical, label, options }) => ({ canonical, label, options }));
  }

  function renderSwaps() {
    if (!swapPanel) return;
    swapList.innerHTML = "";
    if (!engine || !currentRecipe) { swapPanel.classList.add("hidden"); return; }

    const applied = Object.entries(activeSwaps);
    const targets = swapTargets();
    swapPanel.classList.toggle("hidden", !targets.length && !applied.length);

    applied.forEach(([canonical, sub]) => {
      const row = document.createElement("div");
      row.className = "swap-row applied";
      const label = document.createElement("span");
      label.className = "swap-need";
      label.textContent = `✓ ${ingredientLabel(currentRecipe, canonical)} → ${sub.name}`;
      const undo = document.createElement("button");
      undo.className = "btn small swap-undo";
      undo.type = "button";
      undo.textContent = "↩ Undo";
      undo.addEventListener("click", () => undoSwap(canonical));
      row.append(label, undo);
      swapList.appendChild(row);
    });

    targets.forEach(target => {
      const row = document.createElement("div");
      row.className = "swap-row";
      const label = document.createElement("span");
      label.className = "swap-need";
      label.textContent = target.label;
      row.appendChild(label);
      target.options.forEach((opt, i) => {
        const btn = document.createElement("button");
        btn.className = "btn small swap-apply" + (i === 0 ? " primary" : "");
        btn.type = "button";
        btn.textContent = `→ ${opt.name}`;
        if (opt.note) btn.title = opt.note;
        btn.addEventListener("click", () => applySwap(target.canonical, opt));
        row.appendChild(btn);
      });
      swapList.appendChild(row);
    });

    const banner = $("swap-banner");
    if (applied.length) {
      banner.classList.remove("hidden");
      banner.textContent = `Step text updated for ${applied.length} swap${applied.length > 1 ? "s" : ""}. Use Undo to put it back.`;
    } else {
      banner.classList.add("hidden");
    }
  }

  function applySwap(canonical, option) {
    if (!currentRecipe) return;
    activeSwaps[canonical] = option;
    renderStep(); renderSwaps(); renderIngredients();
    const label = ingredientLabel(currentRecipe, canonical);
    showToast(`🔄 ${label} → ${option.name}`, 4000);
    setVoiceStatus(`Swapped ${label} for ${option.name}`);
    if (option.note) speak(option.note);
  }

  function undoSwap(canonical) {
    if (!currentRecipe) return;
    delete activeSwaps[canonical];
    renderStep(); renderSwaps(); renderIngredients();
    showToast("↩ Swap undone — original step text restored", 3000);
    setVoiceStatus("Swap undone");
  }

  /* ---------------- The shopping list: what to buy, not what to use ----------
   *
   * The kitchen panel answers "what can I cook?" and the swap panel answers "what
   * about the one thing I am missing?". Neither gets anyone to the shop, because
   * a recipe's ingredient list is not a shopping list. It includes the salt you
   * already own, it is written for the recipe's own yield rather than the pot in
   * front of you, and two dishes that both want garlic want one amount of garlic
   * between them, not two lines.
   *
   * The arithmetic lives in the engine (src/shopping.js), which is where the rule
   * that two different units are never added together is also tested. What is
   * decided here is only what the buttons mean: which dish's needs are being
   * added, and — the one judgement the engine cannot make for us — what "already
   * have" means at this moment.
   */
  const SHOP = window.CookalongShopping || null;
  const SHOPPING_KEY = "cookalong.shopping.v1";
  let shoppingList = [];

  /**
   * What the cook is treated as owning right now: the pantry they have saved,
   * plus the ingredient set of the match they came in from. The match's set is
   * the more specific answer when there is one, and the engine adds this recipe's
   * own pantry staples on top, which is what keeps the list agreeing with the
   * score on the card that sent you here.
   */
  function haveNow() {
    const have = new Set(pantry ? pantry.all() : []);
    if (currentHave) currentHave.forEach(c => have.add(c));
    return [...have];
  }

  /** How many this dish is being cooked for, whether or not it is open. */
  function servingsFor(recipe) {
    const base = (recipe && recipe.serves) || 1;
    // How many you are cooking for is a property of the kitchen, not of one
    // recipe, so the stepper's setting follows the cook from dish to dish.
    return SERV ? SERV.clampServings(wantedServings || base) : base;
  }

  function loadShopping() {
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem(SHOPPING_KEY) || "[]"); } catch (e) { saved = []; }
    shoppingList = Array.isArray(saved) ? saved.filter(i => i && i.key) : [];
  }

  function saveShopping() {
    try { localStorage.setItem(SHOPPING_KEY, JSON.stringify(shoppingList)); } catch (e) { /* private mode */ }
    renderShopping();
  }

  /** What this recipe still needs bought, for the yield on screen. */
  function needsToBuy(recipe) {
    if (!SHOP || !recipe) return [];
    return SHOP.itemsToBuy(recipe, {
      servings: servingsFor(recipe),
      have: haveNow(),
      profile: currentProfile(),
    }).items;
  }

  function addNeeds(items, label) {
    if (!SHOP) return null;
    if (!items.length) {
      showToast(`Nothing to buy for ${label} — your kitchen already covers it`, 3400);
      return {
        status: `Nothing to buy for ${label}`,
        say: `Nothing to buy for ${label} — your kitchen already covers it.`,
      };
    }
    shoppingList = SHOP.addItems(shoppingList, items);
    saveShopping();
    const remaining = SHOP.summary(shoppingList).remaining;
    const word = items.length === 1 ? "item" : "items";
    showToast(`🛒 Added ${items.length} ${word} for ${label} — ${remaining} to buy`, 3800);
    return {
      status: `${remaining} to buy`,
      say: `Added ${items.length} ${word} for ${label}. ${remaining} still to buy.`,
    };
  }

  function addMissingFromRecipe() {
    if (!SHOP) {
      return { status: "The shopping list is unavailable", say: "The shopping list engine did not load." };
    }
    if (!currentRecipe) {
      return {
        status: "Open a recipe and I'll list what it needs",
        say: "Open a recipe first, then ask me to add what is missing.",
      };
    }
    // This used to change the top bar and stop there — no voice, no transcript —
    // so the one command that turns a dish you cannot cook into a shopping trip
    // was also the one command that answered without saying anything.
    return addNeeds(needsToBuy(currentRecipe), currentRecipe.name);
  }

  /**
   * From a kitchen match card. The match already worked out which of the recipe's
   * ingredients the cook has, so the needs are exactly what the card marks as
   * missing — no second opinion about what is in the kitchen.
   */
  function addMissingFromMatch(m, recipe) {
    if (!SHOP || !recipe) return;
    const have = [...new Set([...(m.matched || []), ...haveNow()])];
    const items = SHOP.itemsToBuy(recipe, {
      servings: servingsFor(recipe),
      have,
      profile: currentProfile(),
    }).items;
    const reply = addNeeds(items, recipe.name);
    if (reply) answer(reply);
  }

  function shopRow(item) {
    const row = document.createElement("li");
    row.className = `shop-row${item.bought ? " bought" : ""}${item.asNeeded ? " asneeded" : ""}`;
    row.dataset.key = item.key;

    const tick = document.createElement("button");
    tick.type = "button";
    tick.className = "btn small shop-tick";
    tick.textContent = item.bought ? "↩ Undo" : "✓ Got it";
    tick.setAttribute("aria-label", `${item.bought ? "Un-tick" : "Tick off"} ${item.name}`);
    tick.addEventListener("click", () => toggleShopItem(item.key));

    // An amount that is not a number cannot be ticked off against a figure, so it
    // is labelled honestly and the recipe's own words are kept beside it — "a
    // handful" and "to taste" tell you different things about how much to buy.
    const qty = document.createElement("span");
    qty.className = "shop-qty";
    qty.textContent = item.asNeeded ? "as needed" : item.qty;

    const name = document.createElement("span");
    name.className = "shop-name";
    name.textContent = item.name;
    if (item.asNeeded && item.qty) {
      const words = document.createElement("span");
      words.className = "shop-for";
      words.textContent = ` (${item.qty})`;
      name.appendChild(words);
    }

    row.append(tick, qty, name);

    if (item.dishes > 1) {
      const dishes = document.createElement("span");
      dishes.className = "shop-for";
      dishes.textContent = `${item.dishes} dishes`;
      dishes.title = (item.forRecipeNames || []).join(", ");
      row.appendChild(dishes);
    }
    if (item.skipWith) {
      // The link back to the swap panel: you may not need to buy this at all.
      const skip = document.createElement("span");
      skip.className = "shop-skip";
      skip.textContent = `or use your ${item.skipWith.name}`;
      if (item.skipWith.note) skip.title = item.skipWith.note;
      row.appendChild(skip);
    }

    row.addEventListener("click", e => { if (e.target !== tick) toggleShopItem(item.key); });
    return row;
  }

  function renderShopping() {
    const list = $("shop-list");
    if (!list) return;
    const emptyEl = $("shop-empty");
    if (!SHOP) {
      list.innerHTML = "";
      if (emptyEl) emptyEl.textContent = "Shopping list unavailable — the engine did not load.";
      return;
    }

    list.innerHTML = "";
    const s = SHOP.summary(shoppingList);
    const count = $("shop-count");
    if (count) count.textContent = String(s.remaining);

    const summaryEl = $("shop-summary");
    if (summaryEl) {
      const bits = [];
      if (s.total) bits.push(`${s.remaining} to buy`, `${s.bought} already got`);
      if (s.asNeeded) bits.push(`${s.asNeeded} as needed`);
      if (s.skipable) bits.push(`${s.skipable} you could skip`);
      summaryEl.textContent = bits.join(" · ");
    }
    if (emptyEl) emptyEl.classList.toggle("hidden", s.total > 0);

    shoppingList.forEach(item => list.appendChild(shopRow(item)));
    renderShoppingBadge();
  }

  function renderShoppingBadge() {
    const badge = $("btn-shop-badge");
    if (!badge) return;
    const remaining = SHOP ? SHOP.summary(shoppingList).remaining : 0;
    badge.classList.toggle("has-items", remaining > 0);
    badge.title = remaining
      ? `${remaining} thing${remaining === 1 ? "" : "s"} still to buy`
      : "Shopping list — nothing on it yet";
    const text = $("shop-badge-text");
    if (text) text.textContent = remaining ? `${remaining} to buy` : "List";
  }

  function toggleShopItem(key) {
    if (!SHOP) return;
    const item = shoppingList.find(i => i.key === key);
    if (!item) return;
    shoppingList = SHOP.setBought(shoppingList, key, !item.bought);
    saveShopping();
    if (!item.bought) showToast(`✓ ${item.name} — got it`, 1800);
  }

  function clearShoppingBought() {
    if (!SHOP) return;
    const removed = SHOP.summary(shoppingList).bought;
    if (!removed) { showToast("Nothing is ticked off yet", 2400); return; }
    shoppingList = SHOP.clearBought(shoppingList);
    saveShopping();
    showToast(`🧺 Took ${removed} bought item${removed === 1 ? "" : "s"} off the list`, 3000);
  }

  function emptyShopping() {
    if (!SHOP || !shoppingList.length) { showToast("The list is already empty", 2400); return; }
    const gone = shoppingList.length;
    shoppingList = SHOP.clearAll();
    saveShopping();
    showToast(`🛒 Emptied the list — ${gone} item${gone === 1 ? "" : "s"} removed`, 3200);
  }

  function showShopping() {
    renderShopping();
    $("shopping-panel").classList.remove("hidden");
    // Land on the first thing to buy, so a remote can tick items off without
    // hunting for the first one.
    focusEl($("shop-list").querySelector(".shop-tick") || $("btn-shop-close"));
    $("shopping-panel").scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function hideShopping() {
    $("shopping-panel").classList.add("hidden");
    focusEl(defaultFocus());
  }

  function readShopping() {
    if (!SHOP) {
      return { status: "The shopping list is unavailable", say: "The shopping list engine did not load." };
    }
    showShopping();
    if (!shoppingList.length) {
      return {
        status: "The shopping list is empty",
        say: "Your shopping list is empty. Open a recipe and ask me to add what is missing.",
      };
    }
    return {
      status: `${SHOP.summary(shoppingList).remaining} to buy`,
      say: SHOP.speak(shoppingList),
    };
  }

  /* ---------------- Fire TV remote (D-pad) navigation ---------------- */
  const FOCUSABLE = 'button:not([disabled]), input, [tabindex]:not([tabindex="-1"])';
  let returnFocusId = null;

  function focusables() {
    return Array.from(document.querySelectorAll(FOCUSABLE)).filter(el => {
      if (el.closest(".hidden")) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  }

  function markFocus(el) {
    document.querySelectorAll(".tv-focus").forEach(n => n.classList.remove("tv-focus"));
    if (el && el.classList) el.classList.add("tv-focus");
  }

  function focusEl(el) {
    if (!el || !el.focus) return;
    el.focus({ preventScroll: true });
    markFocus(el);
    if (el.scrollIntoView) el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }

  /** Where focus lands when a view opens or the remote wakes up. */
  function defaultFocus() {
    if (!viewRecipe.classList.contains("hidden")) {
      return $("btn-next").disabled ? $("btn-prev") : $("btn-next");
    }
    if (returnFocusId) {
      const card = Array.from(document.querySelectorAll("#recipe-grid .card"))
        .find(c => c.dataset.recipeId === returnFocusId);
      if (card) return card;
    }
    return document.querySelector("#recipe-grid .card") || $("btn-voice");
  }

  /**
   * Move focus to the nearest focusable element in a direction, so a Fire TV
   * remote (arrows + OK + Back, no Tab key) can drive the whole app.
   */
  function moveFocus(dir) {
    const els = focusables();
    if (!els.length) return;
    const cur = document.activeElement;
    if (!cur || cur === document.body || !els.includes(cur)) { focusEl(defaultFocus()); return; }

    const cr = cur.getBoundingClientRect();
    const cx = cr.left + cr.width / 2;
    const cy = cr.top + cr.height / 2;
    let best = null;
    let bestScore = Infinity;
    for (const el of els) {
      if (el === cur) continue;
      const r = el.getBoundingClientRect();
      const dcx = (r.left + r.width / 2) - cx;
      const dcy = (r.top + r.height / 2) - cy;
      const primary = dir === "left" ? -dcx : dir === "right" ? dcx : dir === "up" ? -dcy : dcy;
      if (primary <= 2) continue;
      const cross = (dir === "left" || dir === "right") ? Math.abs(dcy) : Math.abs(dcx);
      const score = primary + cross * 3;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) focusEl(best);
  }

  let toastHandle = null;
  function showToast(message, ms = 2500) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.remove("hidden");
    if (toastHandle) clearTimeout(toastHandle);
    toastHandle = setTimeout(() => toast.classList.add("hidden"), ms);
  }

  filtersBox.addEventListener("click", e => { const chip = e.target.closest(".chip"); if (!chip) return; activateDiet(chip.dataset.diet); });
  $("btn-back").addEventListener("click", () => {
    // A running timer keeps counting and the step we reached is kept too: you
    // set them so you could walk away, so both are offered back on the home
    // screen instead of being quietly thrown out.
    hideTimers();
    releaseWakeLock();
    currentRecipe = null; currentMatch = null; currentHave = null; activeSwaps = {};
    viewRecipe.classList.add("hidden");
    viewHome.classList.remove("hidden");
    renderSwaps();
    renderResume();
    focusEl(defaultFocus());
  });
  $("btn-prev").addEventListener("click", () => { if (currentStep > 0) { currentStep -= 1; renderStep(); } });
  $("btn-next").addEventListener("click", () => { if (currentStep < scaledSteps().length - 1) { currentStep += 1; renderStep(); } });
  $("btn-timer").addEventListener("click", addStepTimer);
  $("btn-plan-toggle").addEventListener("click", () => {
    setPlanOpen(!planOpen);
    if (planOpen) {
      // Opening it is a request to use it, so land on the first pot's Start.
      const first = document.querySelector("#plan-list .plan-start");
      if (first) focusEl(first);
    }
  });
  $("plan-list").addEventListener("click", onPlanClick);
  $("plan-list").addEventListener("keydown", e => {
    // A row is a button as far as the remote is concerned, so OK has to work on
    // it — unless the press was meant for the row's own Start button.
    if (e.key !== "Enter" && e.key !== " ") return;
    const row = e.target.closest(".plan-row");
    if (!row || e.target.closest("button")) return;
    e.preventDefault();
    goToStep(Number(row.dataset.step));
  });
  $("timer-list").addEventListener("click", onTimerRowClick);
  $("btn-timer-pause-all").addEventListener("click", () => {
    const counting = rack ? rack.running().length : 0;
    if (!counting) { showToast("Nothing is counting right now.", 2500); return; }
    ensureRack().pauseAll();
    showToast(`⏸ Paused ${counting} timer${counting === 1 ? "" : "s"}`, 2500);
  });
  $("btn-timer-clear-done").addEventListener("click", () => {
    const cleared = rack ? rack.clearDone() : 0;
    finishedTimers = [];
    renderTimerAlert();
    showToast(cleared ? `Cleared ${cleared} finished timer${cleared === 1 ? "" : "s"}` : "No finished timers to clear", 2500);
  });
  $("btn-timer-close").addEventListener("click", () => {
    hideTimers();
    focusEl(defaultFocus());
  });
  $("btn-timer-dismiss").addEventListener("click", dismissTimerAlert);
  $("btn-timer-badge").addEventListener("click", () => {
    // Timers are global state rather than part of a view, so this works from the
    // home screen too — you set them so you could walk away.
    showTimers();
    const soonest = rack && rack.next();
    focusEl(soonest ? timerRowFocus(soonest.id) : $("btn-timer-close"));
    $("timer-display").scrollIntoView({ block: "center", behavior: "smooth" });
  });
  $("btn-speak").addEventListener("click", () => { if (currentRecipe) speak(scaledSteps()[currentStep]); });
  $("btn-shop-badge").addEventListener("click", showShopping);
  $("btn-shop-close").addEventListener("click", hideShopping);
  $("btn-shop-missing").addEventListener("click", () => {
    const reply = addMissingFromRecipe();
    if (reply) answer(reply);
  });
  $("btn-shop-clear-bought").addEventListener("click", clearShoppingBought);
  $("btn-shop-empty").addEventListener("click", emptyShopping);
  $("btn-shop-speak").addEventListener("click", () => {
    const reply = readShopping();
    if (reply) answer(reply);
  });
  $("btn-convo-badge").addEventListener("click", openConvo);
  $("btn-convo-close").addEventListener("click", closeConvo);
  $("btn-convo-clear").addEventListener("click", clearConvo);
  $("btn-convo-help").addEventListener("click", toggleConvoHelp);
  $("btn-servings-minus").addEventListener("click", () => changeServings(-1));
  $("btn-servings-plus").addEventListener("click", () => changeServings(1));
  $("btn-voice").addEventListener("click", toggleVoice);
  $("btn-mute").addEventListener("click", toggleMute);
  $("btn-selfcheck").addEventListener("click", openSelfCheck);
  $("btn-selfcheck-close").addEventListener("click", closeSelfCheck);
  $("btn-selfcheck-copy").addEventListener("click", copySelfCheckReport);
  $("btn-resume").addEventListener("click", resumeCooking);
  $("btn-resume-dismiss").addEventListener("click", () => {
    clearProgress();
    renderResume();
    showToast("Cleared — starting fresh next time", 2500);
  });
  $("btn-allergens-clear").addEventListener("click", () => {
    if (!activeAllergens.size) return;
    activeAllergens.clear();
    saveAllergens(); renderAllergenChips(); renderGrid(); renderRecipeAllergens();
    renderSwaps(); renderIngredients();
    if (kitchenResults.children.length) askKitchen(false);
    showToast("✓ Allergies cleared", 2500);
  });
  if (kitchenInput) {
    $("btn-kitchen-find").addEventListener("click", askKitchen);
    $("btn-pantry-add").addEventListener("click", saveKitchenInputToPantry);
    $("btn-pantry-clear").addEventListener("click", clearPantry);
    kitchenInput.addEventListener("keydown", e => { if (e.key === "Enter") askKitchen(); });
    // Typing means the cook is changing the question, so the chips and the hint
    // come back the moment the kitchen stops matching the answer on screen.
    kitchenInput.addEventListener("input", updateComposing);
  }

  /* Fire TV remote: arrows move focus, OK selects, Back returns. */
  const DIRS = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
  document.addEventListener("focusin", e => markFocus(e.target));
  document.addEventListener("keydown", e => {
    if (!$("timer-alert").classList.contains("hidden")) {
      // the alert owns the screen until it is dismissed
      if (e.key === "Escape" || e.key === "Backspace") { e.preventDefault(); dismissTimerAlert(); }
      else if (DIRS[e.key]) e.preventDefault();
      return;
    }
    if (!$("conversation-panel").classList.contains("hidden")) {
      // The panel is a modal, so the remote belongs to it: arrows must not walk
      // focus off it onto the page behind.
      if (e.key === "Escape" || e.key === "Backspace") { e.preventDefault(); closeConvo(); }
      else if (DIRS[e.key]) e.preventDefault();
      return;
    }
    if (!$("selfcheck").classList.contains("hidden")) {
      if (e.key === "Escape" || e.key === "Backspace") { e.preventDefault(); closeSelfCheck(); }
      else if (DIRS[e.key]) e.preventDefault();
      return;
    }

    const dir = DIRS[e.key];
    const inText = document.activeElement && document.activeElement.tagName === "INPUT";
    if (dir) {
      // inside a text field, left/right belong to the caret
      if (inText && (dir === "left" || dir === "right")) return;
      e.preventDefault();
      moveFocus(dir);
      return;
    }
    if (e.key === "Escape") {
      if (inText) { e.preventDefault(); kitchenInput.blur(); return; }
      if (!viewRecipe.classList.contains("hidden")) { e.preventDefault(); $("btn-back").click(); }
    }
  });

  /* ---------------- boot ---------------- */
  function boot() {
    // Measure the device before anything decides how to talk to the cook.
    refreshCapabilities();
    applyCapabilityUI();

    if (!engine) {
      kitchenResults.innerHTML =
        '<p class="kitchen-empty engine-error">Ingredient engine failed to load — ' +
        'kitchen matching and swaps are unavailable. Try a hard refresh.</p>';
      ["btn-kitchen-find", "btn-pantry-add", "btn-pantry-clear"].forEach(id => {
        const el = $(id);
        if (el) el.disabled = true;
      });
    }

    // Allergies must be known before the grid is drawn, or the first paint
    // would show recipes the cook has already asked us to hide.
    restoreAllergens();
    renderAllergenChips();
    // How many you are cooking for is a property of the kitchen, not of one
    // recipe, so it is restored once and then follows you from dish to dish.
    wantedServings = restoreServings();

    renderGrid();
    renderKitchenChips();
    renderIngredientSuggestions();
    initPantry();
    // The list outlives the recipe it was built from, so it is restored like the
    // pantry is rather than like a recipe's state.
    loadShopping();
    renderShopping();
    restoreMuteState();
    ensureRack();
    restoreTimers();
    renderTimers();
    renderResume();

    // The conversation outlives the session the same way the shopping list
    // does: a cook who walks away mid-answer should be able to come back and
    // read what was said.
    loadVoiceLog();
    renderConvo();
    renderConvoBadge();
    // Both places the app teaches its commands are rendered from the table, so
    // there is no hand-written list left to drift away from the matcher.
    renderCommandList($("cheatsheet-list"));
    renderCommandList($("convo-help-list"));

    restVoice();

    // The wake lock is dropped whenever the page is hidden, so take it back.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) releaseWakeLock();
      else if (currentRecipe) acquireWakeLock();
    });

    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("sw.js").catch(() => { /* offline unavailable */ });
    }

    showToast("Welcome to CookAlong TV! Choose a recipe or tell me what's in your kitchen.");
  }

  boot();
})();
