# How much agent typing still takes the person's caret

**Status:** open · **Check after:** 2026-11-26 · **Last checked:** never

## What we're waiting to learn

An agent's typing into a page that does not hold the window's focus goes to the page itself, or to a cross-origin frame on its own debugger session, and leaves the person's caret where it was (`keyboard-without-focus.ts`). What those routes cannot carry still takes focus first. We want to know how often that happens in real use, for which reasons, and whether a reason worth a route of its own stands out. The commit that adds it is `studio: type into in-app pages without taking the window's focus`.

## The signal

- `typed without focus targetId=… text=N keys=M` in the main log, one line per tab once its typing has been quiet for three seconds: how much went the focus-free way.
- `typing <method> takes focus targetId=…: <reason>`, one per command that fell back, with the reason: `focus in a frame of its own` (a frame the debugger never attached), `no text field has focus`, `no key translation` (a chord, IME, a key outside the US layout table), `page did not answer`, `page fired no input event`.
- `reclaimed keyboard focus` and `refused Input…` after a fallback say whether taking focus then worked.
- A `render-process-gone` for a guest straight after a `typed without focus` line would mean `webContents.insertText` reached a page state the check missed; it crashes a renderer with nothing focused.

## Where to look

The main log of a build in daily use: `apps/studio/.logs/` in development, the rotating logs under the app's userData in a packaged build, and the logs attached to problem reports.

## What each answer means

- Fallbacks are a small share of `typed without focus` and spread across reasons: keep it as it is.
- `no key translation` dominates: read which keys, and add them to the translation or carry chords another way.
- `page fired no input event` is common on one site: that site's editor takes text some other way, worth a probe of its own.
- `focus in a frame of its own` shows up: agent-browser typed into a frame it had not attached, so the frame lookup needs another way in.
- Any guest crash after focus-free typing: find the page state and widen the check before anything else.

## Result

Not checked yet.
