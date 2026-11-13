# How much agent typing still takes the person's caret

**Status:** open · **Check after:** 2026-11-26 · **Last checked:** never

## What we're waiting to learn

An agent's typing into a page that does not hold the window's focus goes to the page itself, or to a cross-origin frame on its own debugger session, and leaves the person's caret where it was (`keyboard-without-focus.ts`). What those routes cannot carry still takes focus first. We want to know how often that happens in real use, for which reasons, and whether a reason worth a route of its own stands out. The commit that adds it is `studio: type into in-app pages without taking the window's focus`.

It has run only on macOS. Owed on Windows and Linux, in the first build that carries it: an agent fills a form and sends it with `press Tab` and `press Enter` while the person types in the message box, and every value and key arrives in the page while the person's text and caret stay whole. Keys are the route to watch there: a key the page never reports handling counts as delivered after a second, logged only at debug level (`did not report handling it`), so a key that never arrives fails quietly rather than taking focus.

## The signal

- `typed without focus targetId=… text=N keys=M` in the main log, one line per tab once its typing has been quiet for three seconds: how much went the focus-free way.
- `typing <method> takes focus targetId=…: <reason>`, one per command that fell back, with the reason: `focus in a cross-origin frame` (the page did not say which), `focus in a frame with no debugger session` (same site and another origin, so in the page's process, or not attached yet), `no text field has focus`, `no key translation` (a chord with Control, Alt or Meta, IME, a key outside the US layout table), `page did not answer`, `page fired no input event`.
- `text sent without focus targetId=…: the page did not say whether it fired an input event`: a commit taken to have landed without the check's answer. Read the page afterwards if it shows up.
- `reclaimed keyboard focus` and `refused Input…` after a fallback say whether taking focus then worked.
- A `render-process-gone` for a guest straight after a `typed without focus` line would mean `webContents.insertText` reached a page state the check missed; it crashes a renderer with nothing focused.

## Where to look

The main log of a build in daily use: `apps/studio/.logs/` in development, the rotating logs under the app's userData in a packaged build, and the logs attached to problem reports.

## What each answer means

- Fallbacks are a small share of `typed without focus` and spread across reasons: keep it as it is.
- `no key translation` dominates: read which keys, and add them to the translation or carry chords another way.
- `page fired no input event` is common on one site: that site's editor takes text some other way, worth a probe of its own.
- `focus in a frame with no debugger session` shows up: read which site. Same-site frames want a route of their own (they share the page's renderer, so `insertText` may reach them); a frame agent-browser had not attached means the lookup needs another way in.
- `text sent without focus … did not say` shows up beside text typed twice or not at all: the busy-page guess is wrong, so wait longer for the check's answer.
- Any guest crash after focus-free typing: find the page state and widen the check before anything else.
- On Windows or Linux, text arrives but `press Tab` or `press Enter` does not: `sendInputEvent` behaves differently there, so send keys through the focus-taking path on that system until it is understood.

## Result

Not checked yet.
