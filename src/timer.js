"use strict";

/**
 * CookAlong TV - Smart timer engine
 *
 * Natural-language duration parsing plus a small stateful timer. The timer is
 * driven by a wall-clock deadline rather than a decrementing counter, so it
 * cannot drift when the tab is throttled or the device sleeps.
 *
 * UMD bundle: works as a CommonJS module (Node tests / Alexa skill) and as
 * `window.CookalongTimer` in the Fire TV Web App.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.CookalongTimer = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {

  const UNIT_SECONDS = {
    second: 1, seconds: 1, sec: 1, secs: 1,
    minute: 60, minutes: 60, min: 60, mins: 60,
    hour: 3600, hours: 3600
  };

  const NUMBER_WORDS = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
    sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
    thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90
  };

  function parseNumber(token) {
    const digit = parseInt(token, 10);
    if (!Number.isNaN(digit)) return digit;
    if (token in NUMBER_WORDS) return NUMBER_WORDS[token];
    if (/^\d+$/.test(token)) return parseInt(token, 10);
    return null;
  }

  function parseISODuration(text) {
    const parts = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(String(text).trim());
    if (!parts) return null;
    const hours = parseInt(parts[1] || "0", 10);
    const minutes = parseInt(parts[2] || "0", 10);
    const seconds = parseInt(parts[3] || "0", 10);
    const total = hours * 3600 + minutes * 60 + seconds;
    return total > 0 ? total : null;
  }

  function parseDuration(text) {
    if (!text) return null;
    const iso = parseISODuration(text);
    if (iso !== null) return iso;
    const tokens = String(text).toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim().split(" ");
    let seconds = 0;
    let currentNumber = null;
    let matched = false;
    for (const token of tokens) {
      const unit = UNIT_SECONDS[token];
      if (unit !== undefined) {
        if (currentNumber === null) currentNumber = 1;
        seconds += currentNumber * unit;
        currentNumber = null;
        matched = true;
      } else {
        const n = parseNumber(token);
        if (n !== null) currentNumber = n;
        else if (token === "and" || token === "a") { if (token === "a" && currentNumber === null) currentNumber = 1; }
      }
    }
    if (!matched && seconds === 0) return null;
    if (seconds === 0) return null;
    return seconds;
  }

  class Timer {
    constructor(durationSeconds, onTick = null) {
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("Timer duration must be a positive number of seconds");
      this.totalSeconds = Math.round(durationSeconds);
      this.remainingSeconds = this.totalSeconds;
      this.state = "idle";
      this._onTick = onTick;
      this._handle = null;
      this._deadline = null;
    }

    start() {
      if (this.state === "running") return this;
      if (this.remainingSeconds <= 0) { this.state = "done"; return this; }
      this.state = "running";
      this._deadline = Date.now() + this.remainingSeconds * 1000;
      this._tick();
      return this;
    }

    /** Recompute remaining time from the wall clock (immune to throttling). */
    _sync() {
      if (this._deadline == null) return;
      this.remainingSeconds = Math.max(0, Math.round((this._deadline - Date.now()) / 1000));
    }

    _tick() {
      if (this.state !== "running") return;
      this._sync();
      if (this.remainingSeconds <= 0) {
        this.state = "done";
        this._handle = null;
        this._deadline = null;
        if (this._onTick) this._onTick(this);
        return;
      }
      if (this._onTick) this._onTick(this);
      // wake up on the next whole-second boundary so the digits tick cleanly
      const msLeft = this._deadline - Date.now();
      this._handle = setTimeout(() => this._tick(), Math.max(50, msLeft % 1000 || 1000));
    }

    pause() {
      if (this._handle) clearTimeout(this._handle);
      this._handle = null;
      if (this.state === "running") { this._sync(); this.state = "paused"; }
      return this;
    }

    resume() { return this.start(); }

    stop() {
      if (this._handle) clearTimeout(this._handle);
      this._handle = null;
      this._deadline = null;
      this.remainingSeconds = 0;
      this.state = "done";
      return this;
    }

    format() {
      const total = Math.max(0, this.remainingSeconds);
      const m = Math.floor(total / 60);
      const s = total % 60;
      return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }

    speak() {
      const total = Math.max(0, this.remainingSeconds);
      const m = Math.floor(total / 60);
      const s = total % 60;
      const parts = [];
      if (m > 0) parts.push(`${m} minute${m === 1 ? "" : "s"}`);
      if (s > 0) parts.push(`${s} second${s === 1 ? "" : "s"}`);
      return parts.length ? parts.join(" and ") : "0 seconds";
    }

    /** Snapshot for localStorage so a running timer survives a reload. */
    toJSON() {
      return {
        totalSeconds: this.totalSeconds,
        remainingSeconds: this.remainingSeconds,
        state: this.state,
        deadline: this._deadline
      };
    }

    /**
     * Restore from a snapshot. A timer that was still running when the page
     * went away is re-derived from its deadline, so time spent with the app
     * closed is accounted for rather than lost. It comes back paused — the
     * cook decides when to resume.
     */
    static fromJSON(snapshot, onTick = null) {
      if (!snapshot || !Number.isFinite(snapshot.totalSeconds) || snapshot.totalSeconds <= 0) return null;
      const timer = new Timer(snapshot.totalSeconds, onTick);
      const deadline = Number(snapshot.deadline);
      const saved = Number(snapshot.remainingSeconds);

      if (snapshot.state === "running" && Number.isFinite(deadline)) {
        timer.remainingSeconds = Math.max(0, Math.round((deadline - Date.now()) / 1000));
        timer._deadline = deadline;
      } else {
        timer.remainingSeconds = Number.isFinite(saved)
          ? Math.max(0, Math.min(timer.totalSeconds, Math.round(saved)))
          : timer.totalSeconds;
      }
      timer.state = timer.remainingSeconds <= 0 ? "done" : "paused";
      return timer;
    }
  }

  return { parseDuration, Timer };
});
