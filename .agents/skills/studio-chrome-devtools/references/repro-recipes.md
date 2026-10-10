# Reproducing bugs in the live Studio UI

Learnings from driving Studio live to reproduce and verify a browser-panel layout bug. Read this before hand-rolling a reproduction with `fill`/`click`/ `evaluate_script` from scratch -- most of the friction below has a working recipe already.

## Check the debug pages before hand-inspecting the DOM

The `/debug/*` routes (`node $DRIVE goto /debug/browser-views`, or the Debug links in the Developer Mode dev panel) are worth checking before reaching for `evaluate_script` archaeology:

- **`/debug/browser-views`** -- every live agent-controlled browser: URL, target id, profile dir, CDP-attached state, loading/crashed state, screencast state, webContents id, listener counts, downloads, plus each task's cleanup machine. Its RPCs are Developer-Mode-only. Each card's "View" button (`rpcClient.debug.browserViewManager.openAsTab`) opens the owning task's page, where its browser is.
- **`/debug`** -- index of all debug tools (components, errors, notifications, browser views).

If what you need isn't visible there, that's a signal the debug page could be extended (cheap, high-leverage) rather than a one-off script.

## Driving the chat input

Only type into the composer when the composer _is_ the thing under test. To get a prompt in front of an agent, `rpc workspace.message.create` (main SKILL.md) skips the entire input path and hands back the session id you will want afterwards.

`chrome-devtools fill <uid> <text>` writes the DOM directly. Studio's composer is a ProseMirror editor (`prompt-editor.tsx`) that owns its document, so a raw DOM write is not a reliable way in: the send button can stay disabled even though the editor visually shows your text. Symptom: `fill` "succeeds" but nothing is sent and the button reports `disabled: true`.

Working recipe (real keyboard events, so the editor sees the change):

```bash
node $DRIVE click --selector '[contenteditable=true]'
node $DRIVE press 'Meta+a'
node $DRIVE press Backspace
node $DRIVE type "your message here"
node $DRIVE press Enter
```

Other CLI gotchas hit along the way:

- Pass bare uids (`2_145`), not the `uid=2_145` form shown in snapshot output -- the latter fails with "Element uid not found".
- There is no `press` subcommand; it's `press_key <key>`.
- uids invalidate on navigation/DOM change (including a task switch or a new message arriving) -- re-run `take_snapshot` before reusing one.

## Waiting for a turn to finish

Never `sleep` for this, and never regex the page text for a spinner. Both are guesses about how long a turn takes, and a guess that comes back short produces a half-written transcript that reads like a bug in what you were testing.

```bash
node $DRIVE wait --idle --chat <chat-id>
```

It blocks on the same state the app's own indicators read (the chat's `state` from `chats.byId`, or with `--task <session-id>` that task's row in `chats.tasks`) and returns when nothing there is at work. The main SKILL.md covers what "no live agent" means and the `sawBusy` field.

## Inspecting a `<webview>` guest's real internal state

Agent-browser tabs are renderer `<webview>` guests, not separate DevTools page targets (see main SKILL.md). To read state _inside_ the guest (its own `window`, not the host page's), use the `<webview>` element's own `executeJavaScript` from the host page context:

```bash
pnpm exec chrome-devtools evaluate_script "async function() {
  const webviews = Array.from(document.querySelectorAll('webview'));
  // Match by partition, not DOM order -- the pool can hold guests for
  // several chats and sessions at once. Partition encodes the chat and session:
  // persist:browser-route:<chatId>%2F<sessionId>
  const target = webviews.find(w => w.getAttribute('partition')?.includes('<chat-id>'));
  if (!target) return { error: 'not found' };
  return JSON.parse(await target.executeJavaScript(
    'JSON.stringify({w: window.innerWidth, h: window.innerHeight})'
  ));
}"
```

This is how a real layout mismatch (guest's internal viewport vs. its on-screen container) gets caught -- comparing this against the container's `getBoundingClientRect()` from the host side is what actually proves a visual bug rather than guessing from a screenshot.

## Screenshot coordinate math

`take_screenshot` output is in **device pixels** (scaled by `devicePixelRatio`), not CSS pixels. Studio's own UI can additionally be scaled by its app-level zoom (`ZoomRoot`, user-adjustable). Eyeballing pixel offsets in a screenshot and converting by hand is error-prone and was a time sink here.

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

And measure the specific element(s) you care about with `getBoundingClientRect()` (already in CSS pixels, already accounts for ancestor zoom) rather than converting screenshot pixels back to CSS pixels. Only use the screenshot for a final human-readable visual confirmation, not as a measurement source.
