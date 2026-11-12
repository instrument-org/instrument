# CDP keyboard input goes to the focused widget, not the target you sent it on

**Status:** fixed for typing: text and keys go to the guest itself, or to a cross-origin frame on its own session, without taking the window's focus (`keyboard-without-focus.ts`); chords, IME and a few edge cases still reclaim focus, and an agent's click still takes it for the settle tail. Last updated 2026-11-12.

## Symptom

An agent driving the in-app browser sent a multi-line block of text with `agent-browser keyboard inserttext` and `agent-browser keyboard type`. The text was never entered into the page. It went into Studio's own prompt input instead, and because the prompt editor submits on unmodified Enter, every newline in the payload submitted a message. A two-command sequence over a twenty-line document queued roughly forty-five messages.

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

Typing for a guest that does not hold focus is sent to the guest rather than through the focus tree (`keyboard-without-focus.ts`, called from `dispatch-command.ts`):

- `Input.insertText` becomes `guest.webContents.insertText(text)`, which commits through the guest renderer's own input method: the commit CDP makes, addressed to the guest. The page sees trusted `beforeinput` and `input`, and line breaks arrive as one insertion leaves them.
- `Input.dispatchKeyEvent` becomes `guest.webContents.sendInputEvent` (keyDown, char, keyUp), translated from CDP's key fields into Electron's accelerator names. The page sees trusted `keydown`, `keypress`, `beforeinput`, `input` and `keyup`, the same sequence and the same values as CDP's for every key agent-browser's `press` sends (measured across a textarea, a form input, a contenteditable, ProseMirror and a React input), except that Electron also sets Shift on a capital letter or a shifted symbol.
- When the page's focus is in a cross-origin frame, the command goes out on that frame's own debugger session, where CDP input reaches the frame rather than the window's focus. Studio keeps each frame's session from the debugger's attach events (`entry.frameSessions`) and finds the frame through `DOM.describeNode` on the focused owner element.

Before any of that, a check in an isolated world finds where the page's focus is (through open shadow roots and same-origin frames) and listens for the events the page fires: text that fired no `input` is known not to have landed, and a key answers once the page has handled its last event, as CDP's own answer does. Measured in the running app with the person typing into the chat box throughout, an agent filled a name, an email, a React-controlled input, a multi-line textarea, a ProseMirror note and two card fields in a cross-origin frame, then pressed Tab and Enter to send the form; every value arrived, and the person's sentence, focus and caret stayed whole.

A guest that already holds focus is typed into through its debugger. What the routes above cannot carry reclaims focus first: in the page's own frames, macOS editing chords (sent with editing `commands`) and keys outside the US layout table; IME composition; a field in a frame the debugger never attached; and a commit the page fired no input event for. The main process asks the renderer (`browser.focus-guest`) to put DOM focus on the `<webview>` element, polls until the guest's `document.hasFocus()` agrees, then sends the command through the debugger, and refuses with an error telling the agent to click the field first when the guest never takes focus. `focus-guard.ts` lets input commands take focus (it refuses only the focus a navigation pulls) and hands it back to the host once the tab has been quiet for the settle tail. Each command that takes focus is logged with its reason, and each tab logs how much it was typed into without focus once its typing goes quiet.

## What this does not fix

A click still takes the caret. A CDP click is routed by hit-testing and focuses the guest, and the focus guard hands focus back only after the settle tail, so keys the person types in that tail go to the page. Typing alone (`fill`, `type`, `press`, `keyboard`) never takes it.

The reclaim lands text for a cross-origin frame in the wrong place. When agent-browser focuses a field inside such a frame while the guest does not hold focus, the page's `activeElement` becomes the frame's owner, but the renderer-side `webview.focus()` hands focus back to the main frame's last focused element, so the text lands there. Measured: a card number meant for a cross-origin iframe went into the page's note editor. The frame session route above avoids the reclaim for every frame agent-browser can address, since it addresses a frame's elements only after attaching to it.

`webContents.insertText` crashes the guest's renderer (exit 11) when the page's focus is inside a cross-origin frame, and on a freshly loaded page where nothing has been focused yet: Electron's `InsertText` (`shell/renderer/api/electron_api_web_frame.cc`) calls the frame widget's active input method controller without checking it for null. The isolated-world check never calls it without an editable element focused in a frame it can reach. Keys sent with `sendInputEvent` to such a page do not crash it.

A frame's focus reaches the page's `activeElement` through the browser process, so a focus agent-browser gives an element in a cross-origin frame and the typing right behind it race in principle. Every measured run saw the owner focused by the time the check ran.

## Routes that need no focus, measured

A standalone Electron 45.2.3 rig, 2026-11-12: a never-shown window whose host `<input>` held DOM focus and a caret, a `<webview>` guest with a textarea, a form input, a contenteditable, a ProseMirror composer and a React controlled input, and the composer again in a cross-origin iframe (an OOPIF). The rig first reproduced the table above (CDP `Input.insertText` on the guest's debugger landed in the host input until a renderer-side `webview.focus()`). Each route below landed in the guest with no leak, and the host kept its focus, value and caret, checked by sending a key on the host's own debugger afterwards:

- **In-page `el.focus()` then `document.execCommand('insertText', false, text)`**, through `Runtime.evaluate` on the guest's debugger: lands in every fixture, React state included, at the caret an earlier CDP click left. It fires one trusted `input` event and no `beforeinput` or key events, so editors that listen only for `beforeinput` (Lexical, Slate) are untested. The guest's `document.hasFocus()` stays false and the in-page `focus()` fires no `focus` event. On logged-out chatgpt.com it filled the composer and enabled its send button.
- **`guest.webContents.insertText(text)`**: lands in every fixture with trusted `beforeinput` and `input` events, React state included, at the caret an earlier CDP click left after host focus was handed back; the text is in place when the promise resolves. With nothing focused in the page nothing lands anywhere, and it crashes the renderer in the two cases above.
- **`guest.webContents.sendInputEvent`** (keyDown, char, keyUp): lands in every fixture with fully trusted `keydown`, `keypress`, `beforeinput` and `input`; Unicode and emoji through `char`, Backspace and Tab work. Meta+A did nothing in a textarea, so macOS editing chords still need the `commands` field and the focus reclaim. It cannot reach an element inside an OOPIF: nothing landed anywhere.
- **CDP `Input.*` on an OOPIF's own session** lands in the frame without focus, key events included, while the same command on the guest's main frame leaked to the host.
- **A `WebContentsView` in the same window** never leaked to the host (CDP keyboard input to an outermost WebContents does not follow the window's focus tree), but in the never-shown window its key events, from CDP or `sendInputEvent`, were dropped; only `Input.insertText` landed. A shown, focused window was not tried.

Translating input into in-page JavaScript, which a comparable Electron product with the same `<webview>` architecture does for every input command, was the other way out. It was not taken: synthetic events carry `isTrusted: false`, which matters most on the sign-in pages we support, and a translator reimplements text editing while still failing on cross-origin frames. `execCommand('paste')` returns false inside a guest and a bare synthetic `ClipboardEvent` carries a null `clipboardData`; constructing it with a `DataTransfer` does deliver the payload. Paste and IME composition were not tried on any focus-free route.

## Related

- [in-app-browser.md](../architecture/in-app-browser.md) covers the guest's ownership and the focus model.
