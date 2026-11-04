# How the walkthrough skill is built, and why

For an agent changing this skill. [SKILL.md](SKILL.md) says how to use it.

## Sources

- **[rrweb](https://github.com/rrweb-io/rrweb)** records the page as DOM snapshots and mutations and replays them into a frame. Both sides come through the internal repo: the capture is its recorder (`packages/recorder`), built for recordings of instrument.page pages, and the player bundles `@rrweb/replay`.
- **[Stageshow](https://benji.org/stageshow)** by Benji Taylor, a skill for illustrative product demos built as React stages a script drives beat by beat. This skill takes its staging: a cursor that moves like a hand, in shallow arcs timed by distance, presses you can see, a camera that sits over the scene and pushes in on the important bit and back out, and a contact sheet (`film.mjs`) to look at before sharing. Where Stageshow draws a faux UI, this records the real app.
- **Playwright's Chromium** (the one Studio's tests use) builds, films and renders takes; **ffmpeg** makes the MP4s and GIFs.

## One recording, many cuts

A take records two tracks while a script drives Studio: rrweb's events (what the page did) and a script track (what the driver meant: chapters, captions, presses, keys, camera pushes, stills). Everything shown is built from those afterwards, so a take is re-cut, re-captioned or re-framed without driving Studio again.

The replay is the app's own DOM, so it is sharp at any zoom (a camera push is a CSS scale, which the browser draws again at the new size), and a still is HTML an agent can read. A take costs under 1 MB for its first snapshot, fonts and pictures included, then about 1.5 MB a minute, so one shared page holds about four minutes.

One engine ([player/engine.js](player/engine.js)) serves every cut at a different clock: the chaptered player and the looping snippets in real time, the renderer one frame at a time. Each frame seeks the replay to a recording time with `replayer.pause(t)` (forward seeks apply only the new events) and draws the script track's cursor, presses, keycaps, captions and camera over it.

## What review of the first takes settled

- Snippets, a short loop per chapter, are the cut people want, for an email, a changelog or a release thread. Clicking one opens it large.
- Movement and camera pushes are what make a take read, so the camera frames the work by itself (below) rather than waiting for the script to ask.
- Typing runs at about 38 characters a second; slower read as sluggish.
- Nothing is laid over the replay but the cursor, keys, captions and camera: a chapter counter on the frame read as clutter.
- HTML takes are for sharing inside the team, on instrument.page. A replay is the live DOM, hidden text included, so anything public goes out as MP4, GIF or images, and wants a demo macOS user and a demo account: Files shows the home folder and drive names, and a model greets the signed-in person by name.
- When a replay does not draw, fix the replay. A fallback to still pictures was built and dropped.

## Recording

[scripts/act.mjs](scripts/act.mjs) runs inside a `studio-drive run` script. `prepare` evaluates [scripts/in-page.js](scripts/in-page.js) and [vendor/capture.js](vendor/capture.js) in Studio's renderer. The recorder's capture posts its batches to `window.parent`, which at the top level is the window itself, so a listener there hands them to a CDP binding (`__walkthroughSink`) and they land in `events.jsonl`. The capture runs with `maskInputs: false`, since everything typed is the script's own text.

- Targets are found by the name a person sees, the way `studio-drive snapshot` prints it, and one covered by something else is refused rather than clicked through.
- The pointer is a real CDP pointer, so the app's own hover states happen. It moves on an eased arc taking `clamp(300 + 0.75 × distance, 340, 820)` ms. Typing jitter comes from a fixed seed, so a take types the same way each time.
- Presentation mode hides the development pills, swaps the signed-in account's photo, and trims the address bar to the workspace (`rootCrumb`).
- Native menu shortcuts (⌘I and the like) are handled by the menu bar, which CDP cannot reach: walk through the context menu instead.
- Files loads pictures over `instrument-local://`, which a shared page cannot fetch, so `in-page.js` keeps each one as data while recording. `<video>` frames and the in-app browser's pages, which run in their own processes, are not in a DOM recording at all.

## Building

[scripts/build.mjs](scripts/build.mjs) turns `recording/` into a take's pages:

- **Pictures** are kept once each and named by a token; the player swaps each token for a blob URL.
- **Fonts** are inlined from the faces the page actually loaded (the resource timing buffer fills up during a take, so it cannot list them), and any font source left pointing at the development server is dropped.
- **This machine** is scrubbed from every file: the checkout and home paths, the home folder's name, drive names, the clean room's folder and the account photo.
- **Test ids** are removed. Content blockers hide elements by them: 1Blocker on iOS hides anything whose `data-testid` starts with "app", and Studio's whole page sits in `data-testid="app-page"`, so clips played as an empty frame with only the cursor moving. The blocker's stylesheet is user-origin `!important`, which no page CSS outranks, so the only fix is not to match. A rule like this cannot be seen from a desktop, so it was found on the phone, by taking away one attribute, class, sibling or child of the hidden element at a time until it showed.
- **Waits** for an agent's answer play at 3x, from 2.2 s after Enter until 1.6 s before the next still, where that gap runs over 6 s.
- Each chapter's poster is a still taken in it, and each still gets an outline from its accessibility snapshot, the few hundred words an agent needs instead of the whole page.

## The camera

`cameraPlan` in [player/engine.js](player/engine.js) frames the work by itself. Each press is a beat, framed with what it was on (its dialog, menu or popover). Neighboring beats in one chapter merge while they are less than 1.5 s apart and still a small part of the screen. A shot is padded by 48 px and zooms up to 1.7x, and is skipped when it would zoom less than 1.15x. A chapter opens wide for a moment, a shot pulls out a beat after the last thing done there, a pull-out with the next push close behind pans across instead, and the script's own `act.camera` pushes win over the automatic shots.

## Playing and rendering

- rrweb leaves a frame's document open after it rebuilds one, and an open document keeps the frame loading, so the engine closes it on `fullsnapshot-rebuilded`.
- The replay runs with `pauseAnimation: false`, so CSS animations play on the engine's clock.
- [scripts/render.mjs](scripts/render.mjs) seeks the player to each frame and captures it with the DevTools protocol (`Emulation.setDeviceMetricsOverride`, `Page.captureScreenshot`) at twice the pixels, scaled down to 1080p. Playwright's own screenshot waits on fonts inside the replay frames and can hang there.
- A looping replay rewrites its frames' documents on every loop, so the page's network never goes quiet. instrument.page's link-preview render waits for quiet and takes the picture as the page stands when the wait runs out.

## Where things live

| Path | What |
|---|---|
| `scripts/walkthrough.mjs` | the CLI: seed, open, take, build, film, render, share |
| `scripts/act.mjs` | the driver a walk script calls |
| `scripts/in-page.js` | runs in Studio: finding targets, presentation, stills, picture capture |
| `scripts/build.mjs` | recording to take: pictures, fonts, scrubbing, test ids, chapters, warps, pages |
| `scripts/film.mjs`, `scripts/render.mjs`, `scripts/browser.mjs` | contact sheet, MP4 and GIF, the headless browser they share |
| `player/` | the engine and the chapters, snippets and render pages, bundled into `vendor/player.js` and `vendor/player.css` |
| `player/capture-entry.ts` | the recorder's capture, wired to the CDP binding, bundled into `vendor/capture.js` |
| `vendor/build.mjs` | builds the bundles from a checkout of the internal repo |

`player/`, `vendor/` and `scripts/in-page.js` are left out of type-aware lint (`.oxlintrc.json`): their imports resolve only in the internal repo, and in-page.js runs inside Studio's page.
