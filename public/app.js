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
    renderStep(); renderProgress(); renderSwaps(); renderIngredients();
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
    if (kitchenResults.children.length) runKitchenMatch();   // re-rank against the new profile
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
   */
  function stepSeconds() {
    if (!currentRecipe || !T || !T.stepDurationSeconds) return null;
    const steps = scaledSteps();
    return T.stepDurationSeconds(steps[currentStep] || "");
  }

  /** What the ⏱ button should offer: the step's own time, else the recipe's. */
  function suggestedTimerSeconds() {
    return stepSeconds() || defaultTimerSeconds();
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
  function stepTimerLabel() {
    if (!currentRecipe) return "";
    return `${currentRecipe.name} · step ${currentStep + 1}`;
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
   * Start a timer for the step on screen. Pressing it twice for the same step
   * restarts that timer rather than stacking a duplicate — one step, one timer —
   * and everything else already counting carries on untouched.
   */
  function addStepTimer() {
    if (!ensureRack()) { showToast("Timer engine not loaded.", 3000); return; }
    const seconds = suggestedTimerSeconds();
    const label = stepTimerLabel();
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
    focusEl(timerRowFocus(entry.id));
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

  function defaultVoiceStatus() {
    if (capSummary && !capSummary.spokenPrimary) {
      return "Spoken guidance unavailable here — steps stay on screen. Say “Alexa, open CookAlong” to hear them.";
    }
    return 'Say "Alexa, open CookAlong" — or just use the remote';
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

  function handleVoiceCommand(transcript) {
    const t = transcript.toLowerCase();
    if (viewHome.classList.contains("hidden") === false) {
      const recipe = recipes.find(r => t.includes(r.name.toLowerCase()));
      if (recipe) { openRecipe(recipe.id); setVoiceStatus(`Opening ${recipe.name}`); return; }
    }
    if (t.includes("vegan")) { activateDiet("vegan"); setVoiceStatus("Filtered to vegan recipes"); return; }
    if (t.includes("vegetarian")) { activateDiet("vegetarian"); setVoiceStatus("Filtered to vegetarian recipes"); return; }
    if (t.includes("gluten")) { activateDiet("gluten-free"); setVoiceStatus("Filtered to gluten-free recipes"); return; }
    if (t.includes("all recipes") || t.includes("show everything")) { activateDiet("any"); setVoiceStatus("Showing all recipes"); return; }
    if (/what can i (?:cook|make)|what's in my kitchen|what is in my kitchen|i have|i've got|i have got|my fridge has|冰箱里有|我家里有|家里有/.test(t)) {
      if (viewRecipe.classList.contains("hidden") === false) { $("btn-back").click(); }
      kitchenInput.value = t;
      runKitchenMatch();
      setVoiceStatus("Matching recipes to your kitchen");
      return;
    }
    if (t.includes("next")) {
      if (currentRecipe) {
        if (currentStep < displaySteps().length - 1) { currentStep += 1; renderStep(); speak(`Step ${currentStep + 1}. ${scaledSteps()[currentStep]}`); return; }
        speak(`That was the last step. Enjoy your ${currentRecipe.name}!`); return;
      }
    }
    if (t.includes("previous") || t.includes("back")) {
      if (currentRecipe && currentStep > 0) { currentStep -= 1; renderStep(); speak(`Step ${currentStep + 1}. ${scaledSteps()[currentStep]}`); return; }
    }
    if (t.includes("repeat") || t.includes("say that again")) { if (currentRecipe) { speak(scaledSteps()[currentStep]); setVoiceStatus("Repeating step"); return; } }
    if (t.includes("read") || t.includes("speak")) { if (currentRecipe) { speak(scaledSteps()[currentStep]); return; } }
    if (t.includes("timer")) {
      if (t.includes("set") || t.includes("add") || t.includes("start a")) {
        const secs = suggestedTimerSeconds();
        addStepTimer();
        setVoiceStatus(`Timer added for ${humanDuration(secs)}`);
        speak(`Timer added for ${humanDuration(secs)}`);
        return;
      }
      if (t.includes("pause") || t.includes("stop") || t.includes("cancel")) {
        const counting = rack ? rack.running().length : 0;
        if (counting) ensureRack().pauseAll();
        setVoiceStatus(counting
          ? `${counting} timer${counting === 1 ? "" : "s"} paused`
          : "Nothing was counting");
        if (counting) speak(`Paused ${counting === 1 ? "the timer" : `${counting} timers`}`);
        return;
      }
      if (t.includes("start") || t.includes("resume")) {
        const next = rack && rack.next();
        if (next) {
          rack.start(next.id);
          setVoiceStatus(`Started ${next.label || "the timer"}`);
          speak(`Started ${next.label || "the timer"}`);
        } else {
          setVoiceStatus("There is no timer waiting to start");
          speak("There is no timer waiting to start");
        }
        return;
      }
      // "what timers are running" — the answer a single-timer app cannot give.
      const live = rack ? rack.active() : [];
      if (live.length) {
        const soonest = live[0];
        setVoiceStatus(`${live.length} timer${live.length === 1 ? "" : "s"} — next ${fmt(soonest.timer.remainingSeconds)}`);
        speak(`You have ${live.length} timer${live.length === 1 ? "" : "s"} going. ` +
          `Next is ${soonest.label || "a timer"}, ${soonest.timer.speak()} left.`);
      } else {
        setVoiceStatus("No timers are running");
        speak("No timers are running");
      }
      return;
    }
    setVoiceStatus("I didn't catch that. Try next step, or set a timer.");
  }

  function toggleVoice() {
    // No in-page microphone on this device: route to the panel that explains
    // how to talk, instead of a control whose only outcome is a complaint.
    if (capSummary && !capSummary.canListen) { openSelfCheck(); return; }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { showToast("Voice recognition isn't supported in this browser.", 4000); return; }
    if (voiceListening && window.__recognition) { window.__recognition.stop(); return; }
    const recognition = new SR();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = event => {
      const transcript = event.results[0][0].transcript;
      showToast(`🎙 "${transcript}"`, 3000);
      handleVoiceCommand(transcript);
      voiceListening = false;
      $("btn-voice").classList.remove("active");
    };
    recognition.onerror = () => { voiceListening = false; $("btn-voice").classList.remove("active"); setVoiceStatus("Voice error — try again"); };
    recognition.onend = () => { voiceListening = false; $("btn-voice").classList.remove("active"); };
    window.__recognition = recognition;
    recognition.start();
    voiceListening = true;
    $("btn-voice").classList.add("active");
    setVoiceStatus("Listening… speak a command");
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
  const pantryChips = $("pantry-chips");
  const PANTRY_KEY = "cookalong.pantry.v1";
  const QUICK_INGREDIENTS = ["chicken", "garlic", "rice", "tomato", "broccoli", "eggs", "mushrooms", "tofu", "shrimp", "beef", "bananas", "lemon", "pasta", "carrot", "onion"];
  let pantry = null;

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

  function runKitchenMatch() {
    if (!engine) { showToast("Ingredient engine not loaded.", 3500); return; }
    const { recognized, unknown } = engine.parseIngredientList(kitchenInput.value);
    if (!recognized.length) {
      const got = unknown.length
        ? ` — I didn't get: ${esc(unknown.join(", "))}`
        : "";
      kitchenResults.innerHTML = `<p class="kitchen-empty">I couldn't recognise any ingredients. Try things like “chicken, garlic, rice”${got}.</p>`;
      return;
    }

    const have = Array.from(new Set([...recognized, ...(pantry ? pantry.all() : [])]));
    const profile = currentProfile();

    // The exclusion-aware call is the point: it reports not just which recipes
    // fit, but which ones were removed and for what reason. Without it an
    // allergy filter silently shrinks the list with no explanation.
    const { matches: scored, excluded } = engine.matchRecipesWithExclusions(have, recipes, profile);
    const matches = scored.filter(m => m.score >= 25).slice(0, 5);
    const allergyHidden = excluded.filter(m =>
      (m.excludedReasons || []).some(r => r.startsWith("contains ")));

    kitchenResults.innerHTML = "";
    if (allergyHidden.length) {
      const reasons = [...new Set(allergyHidden.flatMap(m => m.excludedReasons))].join(" · ");
      const note = document.createElement("p");
      note.className = "kitchen-hidden";
      note.textContent = `🚫 ${allergyHidden.length} recipe${allergyHidden.length === 1 ? "" : "s"} hidden — ${reasons}.`;
      kitchenResults.appendChild(note);
    }

    if (!matches.length) {
      // Built as a node rather than by concatenating innerHTML, so the banner
      // above survives the "nothing scored high enough" case too.
      const empty = document.createElement("p");
      empty.className = "kitchen-empty";
      empty.textContent = `Nothing scores high enough with only: ${recognized.map(engine.displayName).join(", ")}. Add more ingredients for better matches.`;
      kitchenResults.appendChild(empty);
      return;
    }
    matches.forEach(m => kitchenResults.appendChild(kitchenMatchCard(m, profile, have)));
    speak(`I found ${matches.length} recipes you can make.`);
    setVoiceStatus(`Found ${matches.length} matches for your kitchen`);
    showToast(`🧺 ${matches.length} recipe${matches.length > 1 ? "s" : ""} matched`, 3000);
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
    if (kitchenResults.children.length) runKitchenMatch();
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

  function kitchenMatchCard(m, profile, haveSet) {
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
    card.innerHTML = `
      <div class="match-head">
        <h4>${esc(r.name)}</h4>
        <span class="match-score">${esc(m.score)}%${kcal ? ` · 🔥 ${kcal}` : ""}</span>
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
      <button class="btn primary match-cook" type="button">Cook it</button>`;

    const toggle = card.querySelector(".match-why-toggle");
    const body = card.querySelector(".match-why-body");
    toggle.addEventListener("click", () => {
      const open = body.classList.toggle("hidden");
      toggle.setAttribute("aria-expanded", String(!open));
      toggle.textContent = open ? `Why ${m.score}%?` : "Hide breakdown";
    });

    card.querySelector(".match-cook").addEventListener("click", () => openRecipe(r.id, m, haveSet));
    card.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") openRecipe(r.id, m, haveSet); });
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
    if (kitchenResults.children.length) runKitchenMatch();
    showToast("✓ Allergies cleared", 2500);
  });
  if (kitchenInput) {
    $("btn-kitchen-find").addEventListener("click", runKitchenMatch);
    $("btn-pantry-add").addEventListener("click", saveKitchenInputToPantry);
    $("btn-pantry-clear").addEventListener("click", clearPantry);
    kitchenInput.addEventListener("keydown", e => { if (e.key === "Enter") runKitchenMatch(); });
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
    restoreMuteState();
    ensureRack();
    restoreTimers();
    renderTimers();
    renderResume();

    voiceStatusLive = false;
    setDefaultVoiceStatus();

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
