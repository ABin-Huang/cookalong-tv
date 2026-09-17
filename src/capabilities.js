"use strict";

/**
 * CookAlong TV - device capability detection
 *
 * This app's whole promise is hands-free spoken guidance, and that promise is
 * only kept if the device can actually say words. The dangerous failure is not
 * a missing API - it is a present API that does nothing:
 *
 *   speechSynthesis missing          -> obvious, we can announce it
 *   speechSynthesis present, no voice-> speak() resolves and stays silent
 *
 * The second is what a Fire TV does. Amazon Silk exposes the API and installs
 * no voices, so every utterance is a no-op with no error to catch. Reading the
 * user agent would not help: the same Silk build behaves differently across
 * device generations, and a UA string is a guess where a measurement is
 * available. So everything here measures the environment it is handed, and
 * `looksLikeTv` is kept as a hint for the report only - never as the thing
 * that decides the UI.
 *
 * UMD bundle: works as a CommonJS module (Node tests) and as
 * `window.CookalongCapabilities` in the Fire TV Web App.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.CookalongCapabilities = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {

  const STORAGE_PROBE_KEY = "cookalong.probe.v1";

  /** Advisory only, for the diagnostic report. Never drives behaviour. */
  function looksLikeTv(userAgent) {
    return /FireTV|AFT[A-Z0-9]|Silk\/|BRAVIA|SmartTV|HbbTV|NetCast|Tizen|Web0S|CrKey/i
      .test(String(userAgent || ""));
  }

  function readVoices(synth) {
    try {
      return typeof synth.getVoices === "function" ? (synth.getVoices() || []) : [];
    } catch (e) {
      // A throwing getVoices() is indistinguishable from having none.
      return [];
    }
  }

  /**
   * Whether the cook will actually hear anything.
   *
   * Presence of the API proves nothing; only a non-empty voice list does. The
   * caller re-probes after `voiceschanged`, because some platforms populate the
   * list asynchronously.
   */
  function detectSpeech(env) {
    const synth = env && env.speechSynthesis;
    if (!synth) return { status: "unavailable", voices: 0, speakable: false };

    const voices = readVoices(synth);
    if (!voices.length) return { status: "no-voices", voices: 0, speakable: false };
    return { status: "ok", voices: voices.length, speakable: true };
  }

  /** Whether the in-page microphone button can work. On a TV browser: no. */
  function detectRecognition(env) {
    const Ctor = env && (env.SpeechRecognition || env.webkitSpeechRecognition);
    return Ctor
      ? { status: "ok", supported: true }
      : { status: "unavailable", supported: false };
  }

  function detectWakeLock(env) {
    const wl = env && env.wakeLock;
    const supported = !!wl && typeof wl.request === "function";
    return { status: supported ? "ok" : "unavailable", supported };
  }

  /** Progress and pantry depend on storage; prove it by writing, not guessing. */
  function detectStorage(env) {
    const store = env && env.localStorage;
    if (!store) return { status: "unavailable", writable: false };
    try {
      store.setItem(STORAGE_PROBE_KEY, "1");
      store.removeItem(STORAGE_PROBE_KEY);
      return { status: "ok", writable: true };
    } catch (e) {
      // Private mode / quota / disabled: writes throw.
      return { status: "unavailable", writable: false };
    }
  }

  function detect(env) {
    const e = env || {};
    return {
      userAgent: String(e.userAgent || ""),
      tvLikely: looksLikeTv(e.userAgent),
      speech: detectSpeech(e),
      recognition: detectRecognition(e),
      wakeLock: detectWakeLock(e),
      storage: detectStorage(e),
    };
  }

  /**
   * Collapse the probes into one decision: is spoken guidance a real channel,
   * or is the screen the only one?
   *
   * Every branch names what will actually happen, so the UI can say it out
   * loud. A silent no-op is the one outcome we are trying to make impossible.
   */
  function summarize(caps) {
    const c = caps || {};
    const speech = c.speech || { status: "unavailable", voices: 0, speakable: false };
    const recognition = c.recognition || { status: "unavailable", supported: false };

    const spokenPrimary = !!speech.speakable;
    const canListen = !!recognition.supported;

    let headline;
    let action;
    if (spokenPrimary) {
      headline = "Spoken guidance is available. Steps will be read aloud.";
      action = canListen
        ? "This screen can also listen: use the Voice button, or the remote's Alexa button."
        : "This screen cannot listen itself - use the remote's Alexa button to talk.";
    } else if (speech.status === "no-voices") {
      headline = "This device reports no installed voices, so spoken guidance would be silent.";
      action = "Large on-screen text is the primary channel instead. Say \u201cAlexa, open CookAlong\u201d to hear steps.";
    } else {
      headline = "This device has no speech engine, so spoken guidance is unavailable.";
      action = "Large on-screen text is the primary channel instead. Say \u201cAlexa, open CookAlong\u201d to hear steps.";
    }

    return {
      mode: spokenPrimary ? "voice" : "screen",
      spokenPrimary,
      canListen,
      headline,
      action,
      silenceRisk: !spokenPrimary,
    };
  }

  const yesno = value => (value ? "yes" : "no");

  /**
   * A paste-ready diagnostic block.
   *
   * This is friction-log evidence rather than decoration: it is generated on
   * the device that misbehaved, so nobody has to reconstruct the environment
   * from memory days later, and a bug report can carry the exact probes.
   */
  function formatReport(caps, summary, meta) {
    const c = caps || {};
    const s = summary || summarize(c);
    const m = meta || {};
    const speech = c.speech || {};
    const row = (label, value) => label.padEnd(24) + value;

    return [
      "CookAlong TV - device check",
      row("when", m.at || "(unknown)"),
      row("user agent", c.userAgent || "(unavailable)"),
      row("looks like a TV", yesno(c.tvLikely) + " (hint only)"),
      "",
      row("speechSynthesis", speech.status || "unknown"),
      row("installed voices", String(speech.voices || 0)),
      row("spoken guidance", s.spokenPrimary ? "available" : "NOT available"),
      row("SpeechRecognition", (c.recognition || {}).status || "unknown"),
      row("screen wake lock", (c.wakeLock || {}).status || "unknown"),
      row("localStorage", (c.storage || {}).status || "unknown"),
      "",
      "guidance channel: " + s.mode,
      s.headline,
      s.action,
    ].join("\n");
  }

  return {
    detect,
    detectSpeech,
    detectRecognition,
    detectWakeLock,
    detectStorage,
    summarize,
    formatReport,
    looksLikeTv,
  };
});
