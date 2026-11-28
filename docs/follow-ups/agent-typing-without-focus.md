# How much agent typing still takes the person's caret

**Status:** open · **Check after:** 2026-12-12 · **Last checked:** 2026-11-28

## What we're waiting to learn

An agent's typing into a page that does not hold the window's focus goes to the page itself, or to a cross-origin frame on its own debugger session, and leaves the person's caret where it was (`keyboard-without-focus.ts`). What those routes cannot carry still takes focus first. We want to know how often that happens in real use, for which reasons, and whether a reason worth a route of its own stands out. The commit that adds it is `studio: type into in-app pages without taking the window's focus`.

It has run on macOS and on Windows (2.0.7, the x64 build on a Windows ARM machine). Owed on Linux, in the first build that carries it: an agent fills a form and sends it with `press Tab` and `press Enter` while the person types in the message box, and every value and key arrives in the page while the person's text and caret stay whole. Keys are the route to watch there: a key the page never reports handling counts as delivered after a second, logged only at debug level (`did not report handling it`), so a key that never arrives fails quietly rather than taking focus.

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

Windows, 2.0.7 installed: agent-browser filled the booking form's seven fields, the cross-site card frame's two included, and sent it with `press Tab` and `press Enter` while the person typed 665 characters into the message box. Every value arrived and the form was submitted, the person's text came through whole with the caret still in the box, and the log read `typed without focus … text=57 keys=4` with no command taking focus, the same as on macOS.

Daily use, 2026-11-28, from the main logs of two Macs on the 2.0.10 and 2.1.0 betas (one log from 2026-11-17, the other from 2026-11-26): six `typed without focus` lines (149 characters, 9 keys) and three commands that took focus. Two were `no key translation`, both an agent's `press Meta+a` to select a search box's text before typing over it; one was `page did not answer`. Focus came back each time, and neither log has a `text sent without focus` line or a guest crash. Too few to rank reasons, but select-all is the one chord seen, and one of its fallbacks put a key in another tab that was counted as the person's ([agent-told-the-user-used-its-tab.md](agent-told-the-user-used-its-tab.md)). Still owed: the Linux run above, and more daily use before deciding whether `Meta+a` gets a route of its own.
