# CDP keyboard input goes to the focused widget, not the target you sent it on

**Status:** mitigated by a focus gate; the class is only removed by translating input to JS (not done). Last updated 2026-08-14.

## Symptom

An agent driving a task browser sent a multi-line block of text with `agent-browser keyboard inserttext` and `agent-browser keyboard type`. The text was never entered into the page. It went into Studio's own prompt input instead, and because the prompt editor submits on unmodified Enter, every newline in the payload submitted a message. A two-command sequence over a twenty-line document queued roughly forty-five messages.

This reads like a CDP target mix-up or an escape from the guest's web contents. It is neither. The commands were addressed to the correct target and dispatched on that target's own debugger the whole time.

## Root cause

Chromium routes keyboard input to **the widget holding keyboard focus in the WebContents focus tree**, not to the WebContents whose debugger carried the command. A `<webview>` guest is an inner WebContents of the Studio renderer, so guest and host share one focus tree. Whenever the host holds focus, keyboard input dispatched on the guest's debugger is delivered to the host renderer.

Measured against Electron 42.3.3 with a standalone two-element repro (a host `<input>` and a `<webview>` containing a `<textarea>`), input dispatched on the guest's debugger every time:

| Condition | guest `document.hasFocus()` | Input landed in |
| --- | --- | --- |
| guest focused | true | guest |
| host element focused | false | **host** |
| after `guest.webContents.focus()` | false | **host** |
| after renderer-side `webviewElement.focus()` | true | guest (no caret) |
| after a CDP click into the guest | true | guest |
| after page-level `.focus()` inside the guest | false | **host** |

Both `Input.insertText` and `Input.dispatchKeyEvent` behave identically. Mouse, scroll, and touch commands do not: they are routed by hit-testing against the target's own surface and reach the guest regardless of focus, which is why a CDP click is the one thing that reliably reclaims focus.

Three consequences worth keeping:

- `webContents.focus()` on a guest does not move keyboard focus. Only renderer-side DOM focus on the `<webview>` element does.
- A page-level `focus()` call inside the guest does not cross the process boundary, so an agent that focuses an element with `Runtime.evaluate` has a caret but no keyboard focus, and its next keystroke leaves the guest entirely.
- Restoring focus to a host element converts a working typing session into one that types into the app.

## Why the focus guard amplified it

The focus guard exists to stop a guest from pulling focus out of whatever the user is typing in, which is a real and frequently hit annoyance during agent navigation. Its mechanism is to keep host focus while agent CDP activity is driving a guest.

That is in direct conflict with the routing rule above: the guard wants host focus during agent activity, and CDP typing requires guest focus during agent activity, over one shared lever. The guard did not create the bug (any host focus at all is sufficient, including the user simply clicking their own chat box) but it made it deterministic and sticky. It bounced back the focus the agent's own click acquired, so the agent could never recover, and it re-focused the last host element the user touched, which aimed the payload at the prompt input.

## Current behavior

Two changes, both in `apps/studio/src/electron-main/browser-view/`:

1. `dispatch-command.ts` refuses `Input.dispatchKeyEvent`, `Input.insertText`, and `Input.imeSetComposition` when the guest does not hold keyboard focus, with an error telling the caller to click the target element first. Focus is asked of the guest document (`document.hasFocus()`) rather than derived from our own bookkeeping, because neither `webContents` focus state nor renderer-reported DOM focus is authoritative here. Every failure path, including a probe that does not answer within a second, reads as "no focus".
2. `focus-guard.ts` splits "the agent is driving this guest" (used for attributing side effects such as a `window.open`) from "reject this guest's focus transfer". Only navigation-class commands are rejected now. Input commands take focus normally, and host focus is restored once the target has been quiet for the settle tail, so a click-then-type burst is one stretch of agent work rather than a fight over the caret.

Net effect: keystrokes can no longer be delivered to the app's own window. The ordinary click-then-type flow still works, because the click reclaims focus. When the user takes focus between the two, the command fails with an actionable error instead of typing into their window.

## What this does not fix

Agent typing still costs the user their caret for the duration of the typing, because it requires guest focus. That is unavoidable while we dispatch real CDP keyboard input.

The class is only removed by translating keyboard input into JavaScript executed inside the guest (synthetic `beforeinput`/`input` pairs, `setRangeText` for form fields, Range surgery for contenteditable), which never touches the focus tree. A comparable Electron-based product with the same `<webview>`-guest architecture does exactly this for every input command, refusing anything outside a four-method allowlist, and its own error text names preserving focus as the reason. The cost is that synthetic events carry `isTrusted: false`, which matters most on the sign-in pages we deliberately support, and that a translator has to reimplement hit-testing, focus semantics, scroll chaining, and text editing, while still failing on cross-origin iframes.

Two measurements worth having before anyone attempts it:

- `execCommand('paste')` returns false inside a guest (blocked for untrusted script) and a bare synthetic `ClipboardEvent` carries a null `clipboardData`, so a naive translator silently breaks paste. Constructing the event with a `DataTransfer` via `ClipboardEventInit` does deliver the payload, so the main process would have to read the clipboard and inject it.
- `execCommand('selectAll')` works normally.

## Related

- [in-app-browser.md](../architecture/in-app-browser.md) covers the guest's ownership and the focus model.
