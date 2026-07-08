# Reproducing bugs in the live Studio UI

Learnings from driving Studio live to reproduce and verify a browser-panel
layout bug. Read this before hand-rolling a reproduction with `fill`/`click`/
`evaluate_script` from scratch -- most of the friction below has a working
recipe already.

## Prefer replay over driving the agent live

If the bug involves a specific task/session that already ran (an agent tool
call sequence, not a fresh scenario), **replay it** instead of re-typing a
prompt and waiting for a live LLM turn. Replay re-executes the same tool calls
(via `workspace.debug.replaySession`, a `replay-stub` model -- no real LLM
call) deterministically, in seconds, for free.

1. Turn on **Developer Mode** first (Settings -> General). The task actions
   menu only shows "Replay chat" when `useDeveloperMode()` is true
   (`actions-menu.tsx`).
2. Open the task, click the `...` actions menu -> **Replay chat**.
3. Choose **New task** (isolates the repro from the original) or **New
   session** (same task), and a playback speed (**Instant** for repro work).
4. The replay lands you on the new task/session automatically.

Only fall back to live-driving the chat (typing a prompt and waiting for a
real agent turn) when the bug needs fresh, non-deterministic agent behavior --
e.g. testing whether an agent _chooses_ a different workaround now that a path
is blocked, which is not something a replay of an old transcript can show.

## Check the debug pages before hand-inspecting the DOM

Developer Mode also unlocks `#/debug/*` routes -- check these before reaching
for `evaluate_script` archaeology:

- **`#/debug/browser-views`** -- every live agent-controlled browser guest:
  URL, title, CDP-attached state, loading/crashed state, screencast state,
  webContents id, listener counts. Has a "View" button
  (`rpcClient.debug.browserViewManager.openAsTab`) that opens the guest as a
  normal devtools-visible tab if you need a direct CDP session on it.
- **`#/debug`** -- index of all debug tools (components, errors,
  notifications, browser views).

If what you need isn't visible there, that's a signal the debug page could be
extended (cheap, high-leverage) rather than a one-off script.

## Driving the chat input

`chrome-devtools fill <uid> <text>` sets the DOM value directly. Studio's
composer textarea is React-controlled, so a raw DOM write does **not** update
the component's state -- the send button stays disabled even though the
textarea visually shows your text. Symptom: `fill` "succeeds" but nothing is
sent and the button reports `disabled: true`.

Working recipe (real keyboard events, so React sees the change):

```bash
pnpm exec chrome-devtools click <textarea-uid>
pnpm exec chrome-devtools press_key "Control+a"
pnpm exec chrome-devtools press_key "Backspace"
pnpm exec chrome-devtools type_text "your message here" --submitKey Enter
```

Other CLI gotchas hit along the way:

- Pass bare uids (`2_145`), not the `uid=2_145` form shown in snapshot output --
  the latter fails with "Element uid not found".
- There is no `press` subcommand; it's `press_key <key>`.
- uids invalidate on navigation/DOM change (including a task switch or a new
  message arriving) -- re-run `take_snapshot` before reusing one.

## Waiting for a turn to finish

There's no push signal exposed to devtools for "this turn is done" today, so
polling with `sleep` + `take_snapshot` is the current option. Prefer short
sleeps (10-20s) with a snapshot check for the final assistant message over one
long sleep -- turns vary widely in length and you want to fail fast on a stuck
turn rather than wait out a worst-case guess.

## Inspecting a `<webview>` guest's real internal state

Agent-browser tabs are renderer `<webview>` guests, not separate DevTools
page targets (see main SKILL.md). To read state _inside_ the guest (its own
`window`, not the host page's), use the `<webview>` element's own
`executeJavaScript` from the host page context:

```bash
pnpm exec chrome-devtools evaluate_script "async function() {
  const webviews = Array.from(document.querySelectorAll('webview'));
  // Match by partition, not DOM order -- the pool can hold guests for
  // multiple tasks at once. Partition encodes the task/session id:
  // persist:browser-route:<taskId>/<sessionId>
  const target = webviews.find(w => w.getAttribute('partition')?.includes('<task-id>'));
  if (!target) return { error: 'not found' };
  return JSON.parse(await target.executeJavaScript(
    'JSON.stringify({w: window.innerWidth, h: window.innerHeight})'
  ));
}"
```

This is how a real layout mismatch (guest's internal viewport vs. its
on-screen container) gets caught -- comparing this against the container's
`getBoundingClientRect()` from the host side is what actually proves a
visual bug rather than guessing from a screenshot.

## Screenshot coordinate math

`take_screenshot` output is in **device pixels** (scaled by
`devicePixelRatio`), not CSS pixels. Studio's own UI can additionally be
scaled by its app-level zoom (`ZoomRoot`, user-adjustable). Eyeballing pixel
offsets in a screenshot and converting by hand is error-prone and was a time
sink here.

Instead, get ground truth directly:

```bash
pnpm exec chrome-devtools evaluate_script "function() {
  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
  };
}"
```

And measure the specific element(s) you care about with
`getBoundingClientRect()` (already in CSS pixels, already accounts for
ancestor zoom) rather than converting screenshot pixels back to CSS pixels.
Only use the screenshot for a final human-readable visual confirmation, not
as a measurement source.
