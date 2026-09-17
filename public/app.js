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
  let timer = null;
  let voiceListening = false;
  let voiceMuted = false;
  let currentMatch = null;      // the kitchen match a recipe was opened from, if any
  let activeSwaps = {};         // canonical -> substitution option currently applied

  const MUTE_KEY = "cookalong.muted.v1";

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
    const filtered = activeDiet === "any" ? recipes : recipes.filter(r => r.diet.includes(activeDiet));
    if (!filtered.length) { grid.innerHTML = `<p class="empty">No recipes match “${esc(activeDiet)}” — try another filter.</p>`; return; }
    filtered.forEach(r => grid.appendChild(cardFor(r)));
  }

  function openRecipe(id, match) {
    currentRecipe = recipes.find(r => r.id === id) || null;
    if (!currentRecipe) return;
    currentStep = 0;
    currentMatch = match || null;
    activeSwaps = {};
    hideTimer();   // a timer already counting keeps running across recipes
    viewHome.classList.add("hidden");
    viewRecipe.classList.remove("hidden");
    $("recipe-title").textContent = currentRecipe.name;
    const n = currentRecipe.nutrition;
    $("recipe-meta").textContent = `${currentRecipe.prepTimeMinutes} min · serves ${currentRecipe.serves}` +
      (n ? ` · 🔥 ${n.kcal} kcal · P ${n.protein}g / C ${n.carbs}g / F ${n.fat}g per serving` : "");
    renderStep(); renderProgress(); renderSwaps(); renderTimer();
    window.scrollTo(0, 0);
    returnFocusId = id;
    focusEl(defaultFocus());
    speak(`Starting ${currentRecipe.name}. ${displaySteps()[0]}`, true);
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
    const steps = displaySteps();
    const total = steps.length;
    $("step-label").textContent = `Step ${currentStep + 1} of ${total}`;
    $("step-text").textContent = steps[currentStep];
    $("btn-prev").disabled = currentStep === 0;
    $("btn-next").disabled = currentStep === total - 1;
    updateTimerButton(); renderProgress();
    showToast(`${currentRecipe.name} — Step ${currentStep + 1}`);
  }

  function renderProgress() {
    const box = $("progress");
    if (!currentRecipe) { box.innerHTML = ""; return; }
    box.innerHTML = currentRecipe.steps.map((_, i) => `<span class="dot ${i <= currentStep ? "done" : ""}"></span>`).join("");
  }

  function defaultTimerSeconds() {
    const min = (currentRecipe && currentRecipe.prepTimeMinutes) || 5;
    return Math.max(60, Math.min(30 * 60, min * 60));
  }
  function fmt(seconds) {
    return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }
  function updateTimerButton() {
    const btn = $("btn-timer");
    if (!currentRecipe) return;
    btn.textContent = `⏱ Set timer ${fmt(defaultTimerSeconds())}`;
  }
  function showTimer() { $("timer-display").classList.remove("hidden"); }
  function hideTimer() { $("timer-display").classList.add("hidden"); }

  /* ---- Timer: deadline-based engine + persistence + audible alarm ---- */
  const T = window.CookalongTimer || null;
  const TIMER_KEY = "cookalong.timer.v1";

  function saveTimer() {
    try {
      if (!timer) localStorage.removeItem(TIMER_KEY);
      else localStorage.setItem(TIMER_KEY, JSON.stringify(timer.toJSON()));
    } catch (e) { /* private mode */ }
  }

  const TIMER_LABELS = { idle: "ready", running: "counting down", paused: "paused", done: "done" };

  function renderTimer() {
    const time = $("timer-time");
    const state = $("timer-state");
    const badge = $("btn-timer-badge");
    const secs = timer ? timer.remainingSeconds : defaultTimerSeconds();
    time.textContent = fmt(secs);
    if (state) state.textContent = timer ? (TIMER_LABELS[timer.state] || timer.state) : "ready";

    $("btn-timer-start").disabled = !!timer && timer.state === "running";
    $("btn-timer-pause").disabled = !timer || timer.state !== "running";

    const pending = timer && timer.remainingSeconds > 0 &&
      (timer.state === "running" || timer.state === "paused");
    badge.classList.toggle("hidden", !pending);
    if (pending) {
      $("timer-badge-icon").textContent = timer.state === "running" ? "⏱" : "⏸";
      $("timer-badge-text").textContent = fmt(timer.remainingSeconds);
    }
  }

  function onTimerTick(t) {
    if (t.state === "done") {
      localStorage.removeItem(TIMER_KEY);
      renderTimer();
      playChime();
      speak("Timer done! Time to check your food.");
      showToast("⏰ Timer done! Time to check your food.", 6000);
      showTimerAlert("Timer done!", "Time to check your food.");
      return;
    }
    renderTimer();
    saveTimer();
  }

  function ensureTimer() {
    if (!timer) timer = new T.Timer(defaultTimerSeconds(), onTimerTick);
    return timer;
  }

  /**
   * Rebuild the timer at a given remaining time. `state` lets a restored
   * timer come back visibly paused instead of looking untouched.
   */
  function setTimerSeconds(seconds, state = "idle") {
    if (!T) return;
    if (timer) timer.stop();
    timer = new T.Timer(seconds, onTimerTick);
    if (state === "paused") timer.state = "paused";
    renderTimer();
    saveTimer();
  }

  function startTimer() {
    if (!T) { showToast("Timer engine not loaded.", 3000); return; }
    if (!timer || timer.state === "done") timer = new T.Timer(defaultTimerSeconds(), onTimerTick);
    showTimer();
    timer.start();
    renderTimer();
    saveTimer();
  }

  function pauseTimer() {
    if (timer && timer.state === "running") { timer.pause(); handleTimerAfterPause(); }
  }

  function handleTimerAfterPause() {
    renderTimer();
    saveTimer();
  }

  function resetTimer() {
    if (timer) timer.stop();
    timer = new T.Timer(defaultTimerSeconds(), onTimerTick);
    renderTimer();
    saveTimer();
  }

  function restoreTimer() {
    if (!T) return;
    let snapshot = null;
    try { snapshot = JSON.parse(localStorage.getItem(TIMER_KEY) || "null"); } catch (e) { snapshot = null; }
    if (!snapshot) { renderTimer(); return; }

    const restored = T.Timer.fromJSON(snapshot, onTimerTick);
    if (!restored) { localStorage.removeItem(TIMER_KEY); renderTimer(); return; }

    if (restored.state === "done") {
      localStorage.removeItem(TIMER_KEY);
      timer = null;
      renderTimer();
      showToast("⏰ Your timer finished while you were away.", 6000);
      showTimerAlert("Timer finished", "This one ran out while you were away.");
      return;
    }

    setTimerSeconds(restored.remainingSeconds, "paused");
    showToast(`⏱ Timer restored — ${fmt(restored.remainingSeconds)} left. Press Start to resume.`, 5000);
  }

  function showTimerAlert(title, body) {
    $("timer-alert-title").textContent = title;
    $("timer-alert-body").textContent = body;
    $("timer-alert").classList.remove("hidden");
    $("btn-timer-dismiss").focus({ preventScroll: true });
    markFocus($("btn-timer-dismiss"));
  }

  function dismissTimerAlert() {
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
  if (window.speechSynthesis) { loadVoices(); window.speechSynthesis.onvoiceschanged = loadVoices; }
  function pickVoice() {
    return voices.find(v => v.lang === "en-US" && /female|Samantha|Zira|Google US English/i.test(v.name)) || voices.find(v => v.lang === "en-US") || null;
  }
  function speak(text, interrupt = false) {
    if (voiceMuted) return;
    if (!window.speechSynthesis) return;
    if (interrupt) window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "en-US"; utter.rate = 0.98;
    const v = pickVoice(); if (v) utter.voice = v;
    window.speechSynthesis.speak(utter);
  }
  function setVoiceStatus(text) { const el = $("voice-text"); if (el) el.textContent = text; }

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
        if (currentStep < displaySteps().length - 1) { currentStep += 1; renderStep(); speak(`Step ${currentStep + 1}. ${displaySteps()[currentStep]}`); return; }
        speak(`That was the last step. Enjoy your ${currentRecipe.name}!`); return;
      }
    }
    if (t.includes("previous") || t.includes("back")) {
      if (currentRecipe && currentStep > 0) { currentStep -= 1; renderStep(); speak(`Step ${currentStep + 1}. ${displaySteps()[currentStep]}`); return; }
    }
    if (t.includes("repeat") || t.includes("say that again")) { if (currentRecipe) { speak(displaySteps()[currentStep]); setVoiceStatus("Repeating step"); return; } }
    if (t.includes("read") || t.includes("speak")) { if (currentRecipe) { speak(displaySteps()[currentStep]); return; } }
    if (t.includes("timer")) {
      if (t.includes("set")) {
        $("btn-timer").click();
        const secs = defaultTimerSeconds();
        setVoiceStatus(`Timer set for ${fmt(secs)}`);
        speak(`Timer set for ${Math.round(secs / 60)} minutes`);
        return;
      }
      if (t.includes("start")) { startTimer(); setVoiceStatus("Timer started"); return; }
      if (t.includes("pause")) { pauseTimer(); setVoiceStatus("Timer paused"); return; }
      if (t.includes("cancel") || t.includes("stop")) { pauseTimer(); setVoiceStatus("Timer cancelled"); return; }
    }
    setVoiceStatus("I didn't catch that. Try next step, or set a timer.");
  }

  function toggleVoice() {
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
    const profile = activeDiet === "any" ? undefined : { diets: [activeDiet], allergens: [] };
    const matches = engine.topMatches(have, recipes, 25, 5, profile);
    if (!matches.length) {
      kitchenResults.innerHTML = `<p class="kitchen-empty">Nothing scores high enough with only: ${esc(recognized.map(engine.displayName).join(", "))}. Add more ingredients for better matches.</p>`;
      return;
    }
    kitchenResults.innerHTML = "";
    matches.forEach(m => kitchenResults.appendChild(kitchenMatchCard(m, profile)));
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

  function kitchenMatchCard(m, profile) {
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

    card.querySelector(".match-cook").addEventListener("click", () => openRecipe(r.id, m));
    card.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") openRecipe(r.id, m); });
    return card;
  }

  /* ---------------- Recipe: live ingredient swaps ---------------- */
  const swapList = $("swap-list");
  const swapPanel = $("swap-panel");

  function currentProfile() {
    return activeDiet === "any" ? undefined : { diets: [activeDiet], allergens: [] };
  }

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
    renderStep(); renderSwaps();
    const label = ingredientLabel(currentRecipe, canonical);
    showToast(`🔄 ${label} → ${option.name}`, 4000);
    setVoiceStatus(`Swapped ${label} for ${option.name}`);
    if (option.note) speak(option.note);
  }

  function undoSwap(canonical) {
    if (!currentRecipe) return;
    delete activeSwaps[canonical];
    renderStep(); renderSwaps();
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
    // a running timer keeps counting: you set it so you could walk away
    hideTimer();
    currentRecipe = null; currentMatch = null; activeSwaps = {};
    viewRecipe.classList.add("hidden");
    viewHome.classList.remove("hidden");
    renderSwaps();
    focusEl(defaultFocus());
  });
  $("btn-prev").addEventListener("click", () => { if (currentStep > 0) { currentStep -= 1; renderStep(); } });
  $("btn-next").addEventListener("click", () => { if (currentStep < displaySteps().length - 1) { currentStep += 1; renderStep(); } });
  $("btn-timer").addEventListener("click", () => {
    // don't clobber a timer that is already counting
    if (!timer || timer.state === "done") setTimerSeconds(defaultTimerSeconds());
    showTimer();
    renderTimer();
    focusEl($("btn-timer-start").disabled ? $("btn-timer-pause") : $("btn-timer-start"));
  });
  $("btn-timer-start").addEventListener("click", startTimer);
  $("btn-timer-pause").addEventListener("click", pauseTimer);
  $("btn-timer-reset").addEventListener("click", resetTimer);
  $("btn-timer-dismiss").addEventListener("click", dismissTimerAlert);
  $("btn-timer-badge").addEventListener("click", () => {
    if (currentRecipe) { viewHome.classList.add("hidden"); viewRecipe.classList.remove("hidden"); }
    showTimer();
    $("timer-display").scrollIntoView({ block: "center", behavior: "smooth" });
    focusEl($("btn-timer-start"));
  });
  $("btn-speak").addEventListener("click", () => { if (currentRecipe) speak(displaySteps()[currentStep]); });
  $("btn-voice").addEventListener("click", toggleVoice);
  $("btn-mute").addEventListener("click", toggleMute);
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
    if (!engine) {
      kitchenResults.innerHTML =
        '<p class="kitchen-empty engine-error">Ingredient engine failed to load — ' +
        'kitchen matching and swaps are unavailable. Try a hard refresh.</p>';
      ["btn-kitchen-find", "btn-pantry-add", "btn-pantry-clear"].forEach(id => {
        const el = $(id);
        if (el) el.disabled = true;
      });
    }

    renderGrid();
    renderKitchenChips();
    renderIngredientSuggestions();
    initPantry();
    restoreMuteState();
    restoreTimer();
    renderTimer();

    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("sw.js").catch(() => { /* offline unavailable */ });
    }

    showToast("Welcome to CookAlong TV! Choose a recipe or tell me what's in your kitchen.");
  }

  boot();
})();
