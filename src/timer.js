"use strict";

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
  }
  start() {
    if (this.state === "running") return this;
    if (this.remainingSeconds <= 0) { this.state = "done"; return this; }
    this.state = "running";
    this._tick();
    return this;
  }
  _tick() {
    if (this.state !== "running") return;
    if (this.remainingSeconds <= 0) { this.state = "done"; if (this._onTick) this._onTick(this); return; }
    if (this._onTick) this._onTick(this);
    this._handle = setTimeout(() => { this.remainingSeconds -= 1; this._tick(); }, 1000);
  }
  pause() { if (this._handle) clearTimeout(this._handle); if (this.state === "running") this.state = "paused"; return this; }
  resume() { return this.start(); }
  stop() { if (this._handle) clearTimeout(this._handle); this.remainingSeconds = 0; this.state = "done"; return this; }
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
}

module.exports = { parseDuration, Timer };
