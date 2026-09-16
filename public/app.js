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

  function cardFor(recipe) {
    const card = document.createElement("article");
    card.className = "card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Start cooking ${recipe.name}`);
    const tags = recipe.diet.length ? recipe.diet.join(" · ") : "Everyone";
    card.innerHTML = `<div class="card-body"><h3>${recipe.name}</h3><p class="card-meta">${recipe.prepTimeMinutes} min · serves ${recipe.serves} · ${recipe.stepCount || recipe.steps.length} steps</p><p class="card-diet">${tags}</p></div>`;
    card.addEventListener("click", () => openRecipe(recipe.id));
    card.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") openRecipe(recipe.id); });
    return card;
  }

  function renderGrid() {
    grid.innerHTML = "";
    const filtered = activeDiet === "any" ? recipes : recipes.filter(r => r.diet.includes(activeDiet));
    if (!filtered.length) { grid.innerHTML = `<p class="empty">No recipes match “${activeDiet}” — try another filter.</p>`; return; }
    filtered.forEach(r => grid.appendChild(cardFor(r)));
  }

  function openRecipe(id) {
    currentRecipe = recipes.find(r => r.id === id) || null;
    if (!currentRecipe) return;
    currentStep = 0;
    pauseTimer(); hideTimer();
    viewHome.classList.add("hidden");
    viewRecipe.classList.remove("hidden");
    $("recipe-title").textContent = currentRecipe.name;
    $("recipe-meta").textContent = `${currentRecipe.prepTimeMinutes} min · serves ${currentRecipe.serves}`;
    renderStep(); renderProgress();
    window.scrollTo(0, 0);
    speak(`Starting ${currentRecipe.name}. ${currentRecipe.steps[0]}`, true);
  }

  function renderStep() {
    if (!currentRecipe) return;
    const total = currentRecipe.steps.length;
    $("step-label").textContent = `Step ${currentStep + 1} of ${total}`;
    $("step-text").textContent = currentRecipe.steps[currentStep];
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
  function setTimerSeconds(seconds) {
    pauseTimer();
    const time = $("timer-time");
    time.textContent = fmt(seconds);
    time.dataset.seconds = seconds;
  }
  function startTimer() {
    const time = $("timer-time");
    if (!time.dataset.seconds) setTimerSeconds(defaultTimerSeconds());
    showTimer();
    if (timer) { clearInterval(timer); timer = null; }
    timer = setInterval(() => {
      let remaining = parseInt(time.dataset.seconds, 10);
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(timer); timer = null;
        time.textContent = "00:00";
        speak("Timer done! Time to check your food.");
        showToast("⏰ Timer done! Time to check your food.", 6000);
        return;
      }
      time.dataset.seconds = remaining;
      time.textContent = fmt(remaining);
    }, 1000);
  }
  function pauseTimer() { if (timer) { clearInterval(timer); timer = null; } }
  function resetTimer() { pauseTimer(); setTimerSeconds(defaultTimerSeconds()); }

  let voices = [];
  function loadVoices() { voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : []; }
  if (window.speechSynthesis) { loadVoices(); window.speechSynthesis.onvoiceschanged = loadVoices; }
  function pickVoice() {
    return voices.find(v => v.lang === "en-US" && /female|Samantha|Zira|Google US English/i.test(v.name)) || voices.find(v => v.lang === "en-US") || null;
  }
  function speak(text, interrupt = false) {
    if (!window.speechSynthesis) return;
    if (interrupt) window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "en-US"; utter.rate = 0.98;
    const v = pickVoice(); if (v) utter.voice = v;
    window.speechSynthesis.speak(utter);
  }
  function setVoiceStatus(text) { const el = $("voice-text"); if (el) el.textContent = text; }

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
    if (t.includes("next")) {
      if (currentRecipe) {
        if (currentStep < currentRecipe.steps.length - 1) { currentStep += 1; renderStep(); speak(`Step ${currentStep + 1}. ${currentRecipe.steps[currentStep]}`); return; }
        speak(`That was the last step. Enjoy your ${currentRecipe.name}!`); return;
      }
    }
    if (t.includes("previous") || t.includes("back")) {
      if (currentRecipe && currentStep > 0) { currentStep -= 1; renderStep(); speak(`Step ${currentStep + 1}. ${currentRecipe.steps[currentStep]}`); return; }
    }
    if (t.includes("repeat") || t.includes("say that again")) { if (currentRecipe) { speak(currentRecipe.steps[currentStep]); setVoiceStatus("Repeating step"); return; } }
    if (t.includes("read") || t.includes("speak")) { if (currentRecipe) { speak(currentRecipe.steps[currentStep]); return; } }
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

  let toastHandle = null;
  function showToast(message, ms = 2500) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.remove("hidden");
    if (toastHandle) clearTimeout(toastHandle);
    toastHandle = setTimeout(() => toast.classList.add("hidden"), ms);
  }

  filtersBox.addEventListener("click", e => { const chip = e.target.closest(".chip"); if (!chip) return; activateDiet(chip.dataset.diet); });
  $("btn-back").addEventListener("click", () => { pauseTimer(); hideTimer(); currentRecipe = null; viewRecipe.classList.add("hidden"); viewHome.classList.remove("hidden"); });
  $("btn-prev").addEventListener("click", () => { if (currentStep > 0) { currentStep -= 1; renderStep(); } });
  $("btn-next").addEventListener("click", () => { if (currentStep < currentRecipe.steps.length - 1) { currentStep += 1; renderStep(); } });
  $("btn-timer").addEventListener("click", () => { setTimerSeconds(defaultTimerSeconds()); showTimer(); });
  $("btn-timer-start").addEventListener("click", startTimer);
  $("btn-timer-pause").addEventListener("click", pauseTimer);
  $("btn-timer-reset").addEventListener("click", resetTimer);
  $("btn-speak").addEventListener("click", () => { if (currentRecipe) speak(currentRecipe.steps[currentStep]); });
  $("btn-voice").addEventListener("click", toggleVoice);
  document.addEventListener("keydown", e => {
    if (viewRecipe.classList.contains("hidden")) return;
    if (e.key === "ArrowRight") $("btn-next").click();
    if (e.key === "ArrowLeft") $("btn-prev").click();
  });

  renderGrid();
  showToast("Welcome to CookAlong TV! Choose a recipe to start.");
})();
