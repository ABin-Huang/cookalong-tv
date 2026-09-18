# CookAlong TV — Devpost submission pack

Everything needed to finish the "Incomplete submission" on
`Build, Ship, Shape: Amazon Developer Hackathon`.

Deadline shown on the page: **October 23, 3:00pm EDT** (= October 24, 03:00 China time).

Three parts:

1. [Track declaration](#1-track-declaration) — paste into the submission form
2. [The story](#2-the-story) — replaces every section of the current draft
3. [Demo video script](#3-demo-video-script) — a 2:45 shot list you can film in one take

> **Why the current draft is being replaced.** It describes an app that does not
> exist: "Family profiles so each member gets their own favorites" was never
> built, and the draft never mentions ingredient matching, hands-free mode, or
> the cross-session memory — which are the three things the judging guidance
> actually asks for. Judges open the repo. The story has to survive that.

---

## 1. Track declaration

Paste verbatim.

```text
Track: Fire TV

Mini-challenges entered:
  [x] Fire TV — multimodal: voice + D-pad + visuals in one experience
  [x] Alexa+ — an agentic workflow that orchestrates across services
      and keeps context across sessions

Demo device: <fill in — e.g. Fire TV Stick 4K>, 1080p, 10-foot UI at 1920x1080
Voice surfaces: in-app browser speech (Fire TV Silk) AND an Alexa skill
                sharing the same conversation model
```

> Fill in the demo device honestly. The layout is *verified* at 1920×1080 and
> 720p in headless Chromium, which is the claim the repo can back; the physical
> device is whatever you actually record on.

**Why Fire TV, in one line:** cooking is the one screen activity where the user's
hands are full, wet, or covered in flour — so a TV app that needs a remote is a
TV app that does not get used. This is the track where "multimodal" is not a
feature list but the whole point.

---

## 2. The story

### Tagline

```text
Tell it what is in your fridge. It decides dinner, hands you the shopping list,
and then talks you through every step with your hands full and the remote on the
sofa.
```

### Inspiration

Following a recipe on a phone is a mess, and everyone who cooks has made peace
with it: flour on the touchscreen, eyes flicking between a 6-inch screen and a
hot pan, one hand on a spatula and the other dragging a scrollbar. The TV is
already the biggest screen in the room and it is already in the kitchen — but
every recipe app on it still assumes you will pick up a remote.

So we started from the constraint rather than the feature: **the cook must never
have to touch anything, and must never have to lie to the app.** Both of those
turn out to be engineering problems, not UI problems.

The second one turned out to matter more. Every cooking app we tried would
happily say "you have everything you need" about a dish missing three things, or
offer a cheese swap to someone who had just said they were allergic to dairy. An
app that is confidently wrong while your hands are full is worse than no app.

### What it does

**It answers the question you actually have.** Say *"I have chicken, rice and
garlic"* and it ranks recipes by how well they fit what is on the counter —
scoring each ingredient as main, secondary, or pantry staple — then names one
dish and tells you what is missing. Not a list of percentages. A decision.

**It knows the difference between "sort out dinner" and "use up my kitchen."**
Two requests that look similar and are not:

- *"Sort out dinner"* → picks the best dish, tallies shopping, finds the longest
  wait, and reports the whole plan in one answer.
- *"Use up what is in my kitchen"* → a **different objective**. It will only
  answer with a dish that needs **zero shopping**. If nothing clears that bar it
  says so and names the dish that is *one swap away* — it does not quietly
  promote it to "ready" and send you to the shop you asked to avoid.

**It asks before it acts.** Opening a recipe is free — Back undoes it. Editing
your global shopping list is not, so the agent proposes the plan, says what it
would do, and **waits for a yes**. Nothing on your list changes because a
sentence sounded like a command.

**It cooks with you hands-free.** Turn on hands-free and the microphone re-opens
itself after every answer. An entire dish, start to finish, with no button, no
remote, no touch. On a device with no installed voice — which is what a Fire TV
is — there is nothing to wait for, and it re-opens immediately instead of hanging.
If it genuinely cannot hear you twice in a row it switches itself off and tells
you, rather than failing, apologising, re-opening, and failing forever.

**It says when it is not sure.** The top bar rests in a named state instead of
implying a live microphone. A failed listen ends in words, not a stuck spinner.
Device check prints what the device can actually do, so a bug report can be
pasted instead of described.

**It remembers where you were.** An Alexa session ends every time the
conversation pauses — and cooking is nothing but pauses. Check the oven, come
back, say *"keep cooking"*, and you are back on step 3 of 7 with your swaps
still applied, your diet and allergies intact, and your fridge still full.

**It speaks the cook's language.** Not a hard-coded one: the app listens in
Chinese and answers in Chinese, and the taught command list switches with it.

### How we built it

**One engine, three surfaces.** Every rule lives in a plain UMD module under
`src/` with no DOM and no ASK dependency: the matching engine, the plan engine
(the clock), the shopping engine, the timer, the servings scaler, and a new
**conductor** (`src/agent.js`). The browser loads them as scripts; the Alexa
skill requires the same files; the tests run them in plain Node. The node
build (`scripts/build-web.js`) regenerates `public/*-engine.js` from `src/`, and
a test fails if the two ever drift — so the web app and the voice skill cannot
disagree about what is in a recipe.

**The conductor composes, it does not act.** `compose()` returns a plan and has
no side effects at all: open this recipe, add these four things, the longest wait
is 18 minutes on step 6. The app only executes after the cook says yes. That one
decision is what makes an agentic workflow safe to put in a kitchen — a
proposal you can decline, instead of a fait accompli you have to undo.

**One command table, generated twice.** Voice commands are data, not `if`
statements. The same table renders the on-screen cheatsheet, the 💬 help panel,
and the utterance matcher — so a phrase can never be advertised without a
handler. The conductor's two jobs are generated from its own goal list and
injected above the kitchen matcher, because *"use up what's in my kitchen"*
contains *"what's in my kitchen"* and ordering is load-bearing.

**Honest refusals are enforced by tests, not by good intentions.** The engine
returns `closest` and a reason instead of a best-effort match, and the tests
assert the two refusal wordings are never conflated.

**We verified it in a real browser, not in our heads.** `scripts/verify-browser.js`
drives headless Chromium at 1920×1080, presses the real buttons, and asserts on
what a person would see: that the step card is still on screen at 720p, that
focus lands inside the panel so a D-pad can reach it, that the badge counts down,
that the microphone really does re-open by itself, and that a mode which cannot
hear anything stops instead of looping. **68 browser checks and 325 unit tests.**

### Challenges we ran into

**The app argued with itself.** Spoken answers were being picked up by the open
microphone, treated as new commands, and answered again — forever. Fixed
structurally: the microphone is closed *before* the app speaks, and the answer
path is a single function so no code path can silently skip the half of the
exchange the screen is supposed to show.

**`onend` does not always arrive.** Hands-free hangs off "the app has stopped
talking". `speechSynthesis.onend` is the obvious signal and it is not reliable —
we measured it: `onstart` fires, `onend` never does, and `speaking` stays `true`
indefinitely. A feature whose liveness rested on that one event would simply stop
listening and never say why. So the re-arm takes `onend` as a *fast path* and
also arms a bound from what the sentence costs to read; past that bound it stops
believing the flag and hands the turn back. Saying a word or two early is a
nuisance; never listening again is a broken app.

**Two surfaces, one session.** The Fire TV screen and the Alexa skill have to
agree on the current step. We solved it by making them share the engines rather
than syncing two implementations, and by testing the boundary — a contract test
now fails if an intent is declared in the interaction model but not answered by a
handler. That test exists because 7 intents were once dead on a real device while
every unit test stayed green.

**10-foot design is subtraction.** Every element has to justify itself from the
couch. The rest of the ranking folds away under the decision instead of competing
with it, and the composing aids step aside once the question is answered.

**Persistence that does not delete your profile.** Naive persistence is worse
than none: a session that ends before the cook says anything would write an empty
state over the saved one. Ours writes nothing when there is nothing to write, and
every persistence failure is logged and swallowed — losing memory degrades the
app, throwing on every request would kill it.

### Accomplishments that we are proud of

- **A genuinely hands-free cook, proven in a test.** Not "supports voice" — the
  browser harness asserts the microphone re-opens with **no second press**, and
  separately asserts that a mode which cannot hear anything **switches itself off
  after two silent opens** instead of looping.
- **An agent that answers a different question differently.** "Use up my
  kitchen" refuses to recommend anything needing a shop, and says which dish is
  one swap away rather than rounding up.
- **A refusal we can point at.** Allergy and diet constraints survive every path,
  including a resumed session and a swap — a dairy-allergic cook is offered
  nutritional yeast, never cheddar.
- **Real measurements instead of adjectives.** 325 unit tests, 68 browser checks
  at 1920×1080 and 720p, plus a recorded probe of what `speechSynthesis` actually
  does on the device class we target.

### What we learned

- **Voice + a shared screen beats either alone.** The screen removes the
  ambiguity of a pure voice assistant ("did it hear me?"); the voice removes the
  mess of touching a screen with dough on your hands.
- **The hard part of an agent is not the orchestration, it is the exit.** Composing
  ranking + plan + shopping into one turn took an afternoon. Deciding when to
  refuse, and what to say instead, took the rest of the project.
- **Platform APIs need measuring, not trusting.** We found the `onend` gap by
  writing a probe and reading the output, not by reading the spec.
- **A demo is a test.** Anything we could not assert in the browser harness, we
  could not reliably show on a device either.

### What's next

- **Real Alexa Timers API**, so a timer can ring the TV when the app is closed.
  Today the timer is on-screen only, and the skill says so out loud rather than
  pretending.
- **Shopping list hand-off** to Alexa's own list and Amazon Fresh.
- **More cuisines and regional recipes**, plus scaling beyond servings.
- **Camera-assisted prep checks** — hold the pan up and ask "does this look
  right?".

### Built with

```text
Amazon Fire TV, Fire TV Web App (HTML5), Alexa Skills Kit, Alexa+,
ask-sdk-core, ask-sdk-dynamodb-persistence-adapter, Amazon DynamoDB,
Node.js, JavaScript (ES2020), CSS (10-foot UI), Web Speech API
(SpeechRecognition + SpeechSynthesis), Playwright, Service Worker / PWA
```

Devpost tags: `alexa+`, `alexa-skills-kit`, `amazon-fire-tv`,
`ask-sdk-dynamodb-persistence-adapter`, `node.js`, `html5`, `css`, `pwa`,
`web-speech-api`

---

## 3. Demo video script

Target **2:45**. One take, screen recording + voice-over. The rule for every
beat: **show the thing, then say why it matters.** Do not narrate menus.

Two things to have ready before recording: the app already open on the kitchen
home screen at 1920×1080, and hands-free **off** (turn it on live — it is a
better demo).

| Time | On screen | Say |
| --- | --- | --- |
| 0:00–0:15 | Hand holding a flour-covered phone over a pan; cut to the TV on the counter. | "This is how everyone cooks — one hand on the pan, one hand smearing flour on a phone. The biggest screen in the house is already in the kitchen. It just never learned to be useful." |
| 0:15–0:40 | Home screen. Type/press the kitchen chips: **chicken, rice, garlic**. The decision banner names one dish; the rest folds away underneath. | "Tell it what's actually on the counter. It scores every ingredient — main, secondary, pantry staple — and names **one** dish instead of a leaderboard. The rest of the ranking is folded away, because a decision is what you came for." |
| 0:40–0:55 | Press **Add what's missing** on the match card. Badge goes 0 → 4. | "One press turns the dish into a shopping list, built by the same engine the voice uses." |
| 0:55–1:25 | Ask: **"use up what's in my kitchen"**. The refusal line appears naming the dish that is one swap away. | "Now a different question that sounds the same. This one means *don't send me to the shop* — so it only answers with a dish that needs nothing bought. Nothing clears that bar, so it says so, and names the one that's a single swap away. It does not round up and call it ready." |
| 1:25–1:45 | Ask: **"sort out dinner"**. The conductor answers with a dish, one shopping line, and the longest wait. It asks one question. Answer **"yes"** — the recipe opens on step 1 and the list fills in. | "And this one means *decide for me*. The agent composes the match, the clock and the shopping in a single turn: here's the dish, here's what to buy, here's your longest wait. Then it stops and asks. Opening a recipe is free; editing your shopping list isn't — so it waits for a yes." |
| 1:45–2:05 | Press **🙌 Hands-free**. The button turns green. Then **never touch anything again** — say "next step", "next step", "set a timer for 18 minutes". Each answer is spoken, and the mic re-opens on its own. | "Now the part that makes this a kitchen app. Hands-free. The microphone re-opens itself after every answer — watch, I never touch the remote again. And if it really can't hear me twice in a row, it turns itself off and tells me, instead of retrying forever." |
| 2:05–2:25 | Cut to a **new session**: reopen the app, say **"keep cooking"**. It lands back on step 3 of 7 with the swap still applied. | "Here's the thing nobody else solves. An Alexa session ends every time you stop talking — and cooking is nothing but pauses. Ask it to keep cooking and you're back where you were: same step, same swap, same diet, and it still knows what's in your fridge." |
| 2:25–2:40 | Switch language to **中文**; the taught command list switches and a Chinese command moves the step. | "It also listens in your language, not a hard-coded one — the command list and the microphone switch together." |
| 2:40–2:45 | Terminal: `npm test` → **325 pass**, `npm run verify:browser` → **68/68**. | "325 unit tests, 68 checks driven through a real browser at TV resolution. We didn't just build the demo — we built the thing that proves the demo." |

**Filming notes**

- Record at 1920×1080. Do not crop the top bar — it is the app's honesty surface
  and it is the thing that reads as craft on a big screen.
- Speak the commands into the actual microphone where possible; the transcript
  appears on screen and that is part of the proof.
- If hands-free misbehaves on your recording machine's audio setup, fall back to
  the browser harness output for that beat — but do not fake it.
- No music under the voice-over. The spoken answers are the content.
