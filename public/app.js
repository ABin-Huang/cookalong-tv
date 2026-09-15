"use strict";

/**
 * CookAlong TV 2.0 — Fire TV Web App front-end logic.
 *   - Browse / diet-filter recipes (10-foot TV UI)
 *   - "What's in my kitchen": say or tap ingredients, get scored matches
 *   - Missing-ingredient swaps that rewrite the cooking steps live
 *   - Pantry memory (localStorage) + smart timer
 *   - Voice layer: Web Speech API with click/tap fallback, plus spoken
 *     feedback via speechSynthesis so the demo never depends on the cloud.
 */
(() => {
  const recipes = window.COOKALONG_RECIPES || [];
  const Ing = window.CookalongIngredients || {};
  const $ = id => document.getElementById(id);

  const viewHome = $("view-home");
  const viewRecipe = $("view-recipe");
  const grid = $("recipe-grid");
  const filtersBox = $("filters");
  const panelBrowse = $("panel-browse");
  const panelPantry = $("panel-pantry");
  const matchResults = $("match-results");
  const matchEmpty = $("match-empty");

  const PANTRY_KEY = "cookalong.pantry.v1";
  const PROFILE_KEY = "cookalong.profile.v1";

  let activeDiet = "any";
  let mode = "browse";
  let currentRecipe = null;
  let currentStep = 0;
  let substitutions = new Map(); // canonical -> {name, note}
  let displaySteps = [];
  let timer = null;

  /* ---------- pantry memory ---------- */

  function loadPantry() {
    try {
      const raw = JSON.parse(localStorage.getItem(PANTRY_KEY) || "[]");
      return new Set(Array.isArray(raw) ? raw : []);
    } catch (_) { return new Set(); }
  }
  const haves = loadPantry();
  function savePantry() {
    try { localStorage.setItem(PANTRY_KEY, JSON.stringify([...haves])); } catch (_) {}
  }

  /* ---------- dietary profile (diets + allergens) ---------- */

  function loadProfile() {
    try {
      const raw = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}");
      return {
        diets: new Set(Array.isArray(raw.diets) ? raw.diets : []),
        allergens: new Set(Array.isArray(raw.allergens) ? raw.allergens : [])
      };
    } catch (_) { return { diets: new Set(), allergens: new Set() }; }
  }
  const profile = loadProfile();
  function saveProfile() {
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify({ diets: [...profile.diets], allergens: [...profile.allergens] }));
    } catch (_) {}
  }
  // Plain object shape expected by the engine.
  function currentProfile() {
    return { diets: [...profile.diets], allergens: [...profile.allergens] };
  }
  function renderProfileChips() {
    document.querySelectorAll(".pchip").forEach(chip => {
      const set = chip.dataset.kind === "diets" ? profile.diets : profile.allergens;
      chip.classList.toggle("active", set.has(chip.dataset.value));
      chip.setAttribute("aria-pressed", String(set.has(chip.dataset.value)));
    });
  }

  /* ================================================================ *
   * Browse mode
   * ================================================================ */

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
        <p class="card-meta">${recipe.prepTimeMinutes} min · serves ${recipe.serves} · ${recipe.steps.length} steps</p>
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
    const p = currentProfile();
    const filtered = recipes.filter(r => {
      if (activeDiet !== "any" && !r.diet.includes(activeDiet)) return false;
      return Ing.recipeMatchesProfile ? Ing.recipeMatchesProfile(r, p) : true;
    });
    if (!filtered.length) {
      grid.innerHTML = `<p class="empty">No recipes match “${activeDiet}” and your dietary needs — try another filter.</p>`;
      return;
    }
    filtered.forEach(r => grid.appendChild(cardFor(r)));
  }

  /* ================================================================ *
   * Pantry / smart-match mode
   * ================================================================ */

  // Build the quick-pick pool from the dataset, most-used ingredients first.
  const SUGGESTION_ORDER = (() => {
    const count = new Map();
    recipes.forEach(r => (r.ingredients || []).forEach(ing => {
      if (!ing.pantry) count.set(ing.canonical, (count.get(ing.canonical) || 0) + 1);
    }));
    return [...count.keys()].sort((a, b) => count.get(b) - count.get(a));
  })();

  function renderSuggestions() {
    const box = $("ingredient-suggestions");
    box.innerHTML = "";
    SUGGESTION_ORDER.filter(c => !haves.has(c)).slice(0, 14).forEach(canon => {
      const b = document.createElement("button");
      b.className = "chip suggest-chip";
      b.textContent = `+ ${Ing.displayName ? Ing.displayName(canon) : canon}`;
      b.addEventListener("click", () => { addHave(canon); runMatch(); });
      box.appendChild(b);
    });
  }

  function renderHaves() {
    const box = $("pantry-haves");
    box.innerHTML = "";
    if (!haves.size) {
      box.innerHTML = `<span class="haves-empty">nothing yet — speak, type or tap below</span>`;
      return;
    }
    [...haves].forEach(canon => {
      const chip = document.createElement("span");
      chip.className = "have-chip";
      chip.innerHTML = `${Ing.displayName ? Ing.displayName(canon) : canon} <button aria-label="remove">×</button>`;
      chip.querySelector("button").addEventListener("click", () => {
        haves.delete(canon); savePantry(); renderHaves(); renderSuggestions(); runMatch();
      });
      box.appendChild(chip);
    });
  }

  function addHave(raw) {
    const { recognized, unknown } = Ing.parseIngredientList ? Ing.parseIngredientList(raw) : { recognized: [], unknown: [] };
    recognized.forEach(c => haves.add(c));
    savePantry();
    renderHaves();
    renderSuggestions();
    if (unknown.length) setVoiceStatus(`Heard “${raw}” — not sure about: ${unknown.join(", ")}`, false);
    return recognized;
  }

  function scoreClass(score) { return score >= 80 ? "hi" : score >= 50 ? "mid" : "lo"; }

  function matchCardFor(m) {
    const r = m.recipe;
    const card = document.createElement("article");
    card.className = "card match-card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");

    const p = currentProfile();
    const haveTags = m.matched.map(c =>
      `<span class="tag tag-have">✓ ${Ing.displayName(c)}</span>`).join("");
    const subTags = m.missingSubstitutable.map(c => {
      const sub = Ing.findSubstitute(r, c, p);
      return `<span class="tag tag-sub">⇄ no ${Ing.displayName(c)} → ${sub ? sub.name : "swap"}</span>`;
    }).join("");
    const hardTags = m.missingHard.map(c =>
      `<span class="tag tag-miss">✗ ${Ing.displayName(c)}</span>`).join("");

    card.innerHTML = `
      <div class="match-top">
        <div class="match-score score-${scoreClass(m.score)}">${m.score}%</div>
        <div class="card-body">
          <h3>${r.name}</h3>
          <p class="card-meta">${r.prepTimeMinutes} min · serves ${r.serves} · ${r.steps.length} steps</p>
        </div>
      </div>
      <div class="match-bar"><div class="match-bar-fill score-${scoreClass(m.score)}" style="width:${m.score}%"></div></div>
      <div class="tag-row">${haveTags}${subTags}${hardTags}</div>`;
    card.addEventListener("click", () => openRecipe(r.id));
    card.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") openRecipe(r.id);
    });
    return card;
  }

  function runMatch() {
    if (!haves.size) {
      matchResults.innerHTML = "";
      matchEmpty.classList.remove("hidden");
      return;
    }
    matchEmpty.classList.add("hidden");
    const p = currentProfile();
    const { matches: all, excluded } = Ing.matchRecipesWithExclusions
      ? Ing.matchRecipesWithExclusions([...haves], recipes, p)
      : { matches: Ing.matchRecipes([...haves], recipes, p), excluded: [] };
    const picks = all.filter(m => m.score >= 30).slice(0, 6);
    matchResults.innerHTML = "";
    if (!picks.length) {
      matchResults.innerHTML = `<p class="empty">Not enough overlap yet — add another staple like rice, pasta or chicken.</p>`;
      return;
    }
    picks.forEach(m => matchResults.appendChild(matchCardFor(m)));
    const best = picks[0];
    const profileNote = excluded.length
      ? ` · ${excluded.length} hidden by your diet/allergies` : "";
    setVoiceStatus(
      `Best match: ${best.recipe.name} (${best.score}%)` +
      (best.missingSubstitutable.length
        ? ` — missing ${best.missingSubstitutable.map(Ing.displayName).join(", ")}, all swappable for your needs`
        : best.missingHard.length ? ` — still need ${best.missingHard.map(Ing.displayName).join(", ")}` : " — you are ready to cook") + profileNote,
      false);
    return picks;
  }

  /* ================================================================ *
   * Recipe view + live substitutions
   * ================================================================ */

  function openRecipe(id) {
    currentRecipe = recipes.find(r => r.id === id) || null;
    if (!currentRecipe) return;
    currentStep = 0;
    substitutions = new Map();
    if (timer) { timer.stop && timer.stop(); clearInterval(timer); timer = null; hideTimer(); }
    viewHome.classList.add("hidden");
    viewRecipe.classList.remove("hidden");
    $("recipe-title").textContent = currentRecipe.name;
    $("recipe-meta").textContent =
      `${currentRecipe.prepTimeMinutes} min · serves ${currentRecipe.serves} · ${currentRecipe.steps.length} steps`;
    $("substitution-banner").classList.add("hidden");
    renderIngredients();
    rebuildSteps();
    window.scrollTo(0, 0);
  }

  function renderIngredients() {
    const list = $("ingredient-list");
    list.innerHTML = "";
    currentRecipe.ingredients.forEach(ing => {
      const row = document.createElement("div");
      const swapped = substitutions.get(ing.canonical);
      const owned = ing.pantry || haves.has(ing.canonical);
      row.className = "ing-row";

      if (swapped) {
        row.classList.add("is-swapped");
        row.innerHTML = `
          <span class="ing-name"><s>${ing.qty} ${ing.name}</s> → <b>${swapped.name}</b></span>
          <span class="ing-note">${swapped.note}</span>
          <button class="btn small ghost btn-undo">Undo</button>`;
        row.querySelector(".btn-undo").addEventListener("click", () => undoSwap(ing.canonical));
      } else if (owned) {
        row.classList.add("is-have");
        row.innerHTML = `
          <span class="ing-name">✓ ${ing.qty} ${ing.name}</span>
          ${ing.pantry ? '<span class="ing-note">pantry staple</span>' : '<button class="btn small ghost btn-used">Mark used</button>'}`;
        const used = row.querySelector(".btn-used");
        if (used) used.addEventListener("click", () => consumeIngredient(ing.canonical));
      } else {
        row.classList.add("is-missing");
        const sub = Ing.findSubstitute(currentRecipe, ing.canonical, currentProfile());
        const blocked = !sub && hasIncompatibleOption(currentRecipe, ing.canonical);
        row.innerHTML = `
          <span class="ing-name">✗ ${ing.qty} ${ing.name}</span>
          ${sub ? `<button class="btn small btn-swap">⇄ Swap for ${sub.name}</button>`
                 : blocked ? '<span class="ing-note warn-note">no safe swap for your diet/allergies</span>'
                           : '<span class="ing-note">needed</span>'}`;
        const swap = row.querySelector(".btn-swap");
        if (swap) swap.addEventListener("click", () => applySwap(ing.canonical));
      }
      list.appendChild(row);
    });
  }

  function rebuildSteps() {
    let steps = [...currentRecipe.steps];
    substitutions.forEach((sub, canonical) => {
      const ing = currentRecipe.ingredients.find(i => i.canonical === canonical);
      const names = ing ? [ing.name, Ing.displayName(canonical), Ing.displayName(canonical).replace(/s$/, "")] : [];
      const out = Ing.substituteInSteps(steps, names, sub.name);
      steps = out.steps;
    });
    displaySteps = steps;
    renderStep();
  }

  // True when a swap chain exists but every option is blocked by the profile.
  function hasIncompatibleOption(recipe, canonical) {
    if (!Ing.listSubstitutes) return false;
    const { chosen, rejected } = Ing.listSubstitutes(recipe, canonical, currentProfile());
    return !chosen && rejected.length > 0;
  }

  function applySwap(canonical) {
    const sub = Ing.findSubstitute(currentRecipe, canonical, currentProfile());
    if (!sub) {
      showToast(hasIncompatibleOption(currentRecipe, canonical)
        ? `Every swap for ${Ing.displayName(canonical)} conflicts with your diet/allergies.`
        : `No known swap for ${Ing.displayName(canonical)}.`);
      return;
    }
    substitutions.set(canonical, sub);
    renderIngredients();
    rebuildSteps();
    const banner = $("substitution-banner");
    banner.classList.remove("hidden");
    banner.innerHTML = `⇄ Swapped <b>${Ing.displayName(canonical)}</b> → <b>${sub.name}</b>. ${sub.note}`;
    showToast(`Swapped ${Ing.displayName(canonical)} for ${sub.name}`, 4000);
    speak(`No problem. Use ${sub.name} instead. ${sub.note}`);
  }

  function undoSwap(canonical) {
    substitutions.delete(canonical);
    renderIngredients();
    rebuildSteps();
    if (!substitutions.size) $("substitution-banner").classList.add("hidden");
  }

  function consumeIngredient(canonical) {
    haves.delete(canonical);
    savePantry();
    renderIngredients();
    showToast(`${Ing.displayName(canonical)} marked as used — pantry updated.`);
    speak(`Okay, ${Ing.displayName(canonical)} is used up. I will remember that.`);
  }

  function renderStep() {
    if (!currentRecipe) return;
    const total = displaySteps.length;
    $("step-label").textContent = `Step ${currentStep + 1} of ${total}`;
    $("step-text").textContent = displaySteps[currentStep];
    $("btn-prev").disabled = currentStep === 0;
    $("btn-next").disabled = currentStep === total - 1;
    showToast(`${currentRecipe.name} — Step ${currentStep + 1}`);
  }

  /* ================================================================ *
   * Timer (unchanged behaviour)
   * ================================================================ */

  function defaultTimerSeconds() {
    const min = (currentRecipe && currentRecipe.prepTimeMinutes) || 5;
    return Math.max(60, Math.min(30 * 60, min * 60));
  }
  function showTimer() { $("timer-display").classList.remove("hidden"); }
  function hideTimer() { $("timer-display").classList.add("hidden"); }

  function setTimerSeconds(seconds) {
    if (timer) { clearInterval(timer); timer = null; }
    const time = $("timer-time");
    time.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    time.dataset.seconds = seconds;
  }

  function startTimer() {
    const time = $("timer-time");
    showTimer();
    timer = setInterval(() => {
      let remaining = parseInt(time.dataset.seconds, 10) - 1;
      if (remaining <= 0) {
        clearInterval(timer); timer = null;
        time.textContent = "00:00";
        showToast("⏰ Timer done! Time to check your food.", 6000);
        speak("Timer done. Time to check your food.");
        return;
      }
      time.dataset.seconds = remaining;
      time.textContent = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
    }, 1000);
  }

  /* ================================================================ *
   * Voice: recognition + spoken feedback (graceful fallback)
   * ================================================================ */

  const voiceStatusText = $("voice-status-text");
  function setVoiceStatus(text, listening) {
    voiceStatusText.textContent = text;
    $("btn-mic").classList.toggle("listening", !!listening);
    $("btn-mic").setAttribute("aria-pressed", String(!!listening));
  }

  function speak(text) {
    try {
      if (!("speechSynthesis" in window)) return;
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.02;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (_) {}
  }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let listening = false;

  if (SR) {
    recognition = new SR();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = e => {
      const said = e.results[0][0].transcript;
      setVoiceStatus(`You said: “${said}”`, false);
      handleVoiceCommand(said);
    };
    recognition.onend = () => { listening = false; setVoiceStatus(voiceStatusText.textContent, false); };
    recognition.onerror = ev => {
      listening = false;
      setVoiceStatus(`Mic unavailable (${ev.error || "error"}) — typing and tapping still work`, false);
    };
  } else {
    $("btn-mic").title = "Speech recognition is not supported in this browser; use the text box.";
  }

  function toggleListening() {
    if (!recognition) {
      setVoiceStatus("Voice input unsupported here — type ingredients in the box instead.", false);
      $("pantry-input") && $("pantry-input").focus();
      return;
    }
    if (listening) { recognition.stop(); listening = false; return; }
    try {
      recognition.start();
      listening = true;
      setVoiceStatus("Listening… say “I have mushrooms, rice and onion”", true);
    } catch (_) {}
  }

  // Command router shared by speech and typed commands.
  function handleVoiceCommand(raw) {
    const said = String(raw || "").toLowerCase().trim();
    if (!said) return;

    // Dietary profile: "I'm vegan" / "I'm allergic to dairy" / "I'm not vegan".
    const dietHit = (Ing.SUPPORTED_DIETS || []).find(d => said.includes(d));
    const allergenHit = (Ing.COMMON_ALLERGENS || []).find(a => said.includes(a));
    if (/\b(i'?m|i am|make me|set (?:my )?diet to)\b/.test(said) && (dietHit || allergenHit)) {
      const remove = /\b(not|no longer|remove)\b/.test(said);
      if (dietHit) remove ? profile.diets.delete(dietHit) : profile.diets.add(dietHit);
      if (allergenHit) remove ? profile.allergens.delete(allergenHit) : profile.allergens.add(allergenHit);
      saveProfile(); renderProfileChips(); renderGrid(); runMatch();
      const what = dietHit || allergenHit;
      speak(remove ? `Okay, ${what} restriction removed.` : `Got it. I will keep everything ${what.replace("-", " ")} friendly.`);
      setVoiceStatus(remove ? `Removed ${what}` : `Profile: avoiding ${what}`, false);
      return;
    }

    // Step navigation while cooking.
    if (currentRecipe && /\b(next|continue|go on|下一步)\b/.test(said)) { nextStep(); return; }
    if (currentRecipe && /\b(previous|back|go back|上一步)\b/.test(said) && !/^back$/.test(said)) { prevStep(); return; }

    // Timers: "set a timer for 5 minutes".
    const tm = said.match(/timer.*?(\d+)\s*(minute|min|second|sec)/);
    if (tm) {
      const n = parseInt(tm[1], 10);
      const sec = /sec/.test(tm[2]) ? n : n * 60;
      setTimerSeconds(sec); showTimer();
      speak(`Timer set for ${n} ${tm[2]}${n === 1 ? "" : "s"}`);
      return;
    }

    // Missing-ingredient swap: "no parmesan" / "I don't have parmesan" / "没有奶酪".
    const noMatch = said.match(/(?:no|without|don'?t have|do not have|i'?m out of|missing|没有|没了|缺)(?:\s+the\s+)?\s+(.+)/);
    if (currentRecipe && noMatch) {
      const canon = Ing.normalizeIngredient(noMatch[1]);
      if (canon && currentRecipe.ingredients.some(i => i.canonical === canon)) {
        applySwap(canon); return;
      }
    }

    // "Find recipes / what can I make" triggers matching.
    if (/\b(find|show|what can i (make|cook)|match|能做|可以做)\b/.test(said)) {
      switchMode("pantry");
      const picks = runMatch();
      if (picks) speak(`Your best match is ${picks[0].recipe.name}, ${picks[0].score} percent match.`);
      return;
    }

    // Otherwise treat the utterance as an ingredient list.
    const { recognized } = Ing.parseIngredientList(said);
    if (recognized.length) {
      recognized.forEach(c => haves.add(c));
      savePantry(); renderHaves(); renderSuggestions();
      switchMode("pantry");
      const picks = runMatch();
      speak(picks && picks.length
        ? `Added. Your best match is ${picks[0].recipe.name} at ${picks[0].score} percent.`
        : `Got ${recognized.length} ingredients. Add a few more for a better match.`);
    } else {
      setVoiceStatus(`Didn't catch an ingredient in “${raw}”. Try “I have chicken and rice”.`, false);
    }
  }

  /* ================================================================ *
   * Small view helpers
   * ================================================================ */

  function switchMode(next) {
    mode = next;
    document.querySelectorAll(".mode-tab").forEach(t =>
      t.classList.toggle("active", t.dataset.mode === mode));
    panelBrowse.classList.toggle("hidden", mode !== "browse");
    panelPantry.classList.toggle("hidden", mode !== "pantry");
    if (mode === "pantry") { renderHaves(); renderSuggestions(); runMatch(); }
  }

  function nextStep() {
    if (currentRecipe && currentStep < displaySteps.length - 1) {
      currentStep += 1; renderStep();
      speak(displaySteps[currentStep]);
    }
  }
  function prevStep() {
    if (currentRecipe && currentStep > 0) { currentStep -= 1; renderStep(); }
  }

  let toastHandle = null;
  function showToast(message, ms = 2500) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.remove("hidden");
    if (toastHandle) clearTimeout(toastHandle);
    toastHandle = setTimeout(() => toast.classList.add("hidden"), ms);
  }

  /* ================================================================ *
   * Events
   * ================================================================ */

  document.querySelectorAll(".mode-tab").forEach(tab =>
    tab.addEventListener("click", () => switchMode(tab.dataset.mode)));

  filtersBox.addEventListener("click", e => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    filtersBox.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    activeDiet = chip.dataset.diet;
    renderGrid();
  });

  // Dietary profile chips (multi-select): re-run everything that depends on them.
  document.querySelectorAll(".pchip").forEach(chip => {
    chip.addEventListener("click", () => {
      const set = chip.dataset.kind === "diets" ? profile.diets : profile.allergens;
      const v = chip.dataset.value;
      set.has(v) ? set.delete(v) : set.add(v);
      saveProfile(); renderProfileChips();
      renderGrid(); runMatch();
      speak(set.has(v) ? `Got it, avoiding ${v.replace("-", " ")} from now on.` : `Okay, removed ${v.replace("-", " ")}.`);
    });
  });

  $("btn-mic").addEventListener("click", toggleListening);

  $("btn-pantry-add").addEventListener("click", () => {
    const input = $("pantry-input");
    if (input.value.trim()) { addHave(input.value); input.value = ""; runMatch(); }
  });
  $("pantry-input").addEventListener("keydown", e => {
    if (e.key === "Enter") {
      addHave(e.target.value); e.target.value = ""; runMatch();
    }
  });
  $("btn-find").addEventListener("click", () => {
    const picks = runMatch();
    if (picks) speak(`I found ${picks.length} options. Best is ${picks[0].recipe.name}.`);
  });
  $("btn-clear-haves").addEventListener("click", () => {
    haves.clear(); savePantry(); renderHaves(); renderSuggestions();
    matchResults.innerHTML = ""; matchEmpty.classList.remove("hidden");
    setVoiceStatus("Kitchen cleared. Add ingredients to start.", false);
  });

  $("btn-back").addEventListener("click", () => {
    if (timer) { clearInterval(timer); timer = null; hideTimer(); }
    currentRecipe = null;
    viewRecipe.classList.add("hidden");
    viewHome.classList.remove("hidden");
  });
  $("btn-prev").addEventListener("click", prevStep);
  $("btn-next").addEventListener("click", nextStep);
  $("btn-timer").addEventListener("click", () => { setTimerSeconds(defaultTimerSeconds()); showTimer(); });
  $("btn-timer-start").addEventListener("click", startTimer);
  $("btn-timer-pause").addEventListener("click", () => { if (timer) { clearInterval(timer); timer = null; } });
  $("btn-timer-reset").addEventListener("click", () => {
    if (timer) { clearInterval(timer); timer = null; }
    setTimerSeconds(defaultTimerSeconds());
  });

  // Remote D-pad: arrows navigate steps; Enter on nothing-special is harmless.
  document.addEventListener("keydown", e => {
    if (viewRecipe.classList.contains("hidden")) return;
    if (e.key === "ArrowRight") { e.preventDefault(); $("btn-next").click(); }
    if (e.key === "ArrowLeft") { e.preventDefault(); $("btn-prev").click(); }
  });

  /* ---------- init ---------- */

  renderProfileChips();
  renderGrid();
  renderHaves();
  renderSuggestions();
  showToast("Welcome to CookAlong TV! Browse recipes, or tell it what is in your kitchen.");
})();
