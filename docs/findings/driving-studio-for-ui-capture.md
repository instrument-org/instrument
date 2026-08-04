# Driving Studio over CDP: what makes it flaky

## Symptom

Scripted runs against the dev app (screenshot capture for a UI review queue, smoke tests, repro work) spend most of their time on the harness rather than on the thing being tested. The failures are quiet: a click that returns success and does nothing, a screenshot that is a valid PNG of a black rectangle, a route that reports as loaded while the app shows something else.

The traps below are ordered by how much time each one cost in a real capture run over 15 product surfaces.

## Root causes

### Icon-only controls have no accessible name

Three labelling conventions are in use, and they are not interchangeable:

- `aria-label` — zoom in/out, the page-number input.
- An `sr-only` span — the scroll-to-latest control (`ui/message-scroller.tsx`).
- A `<TooltipContent>` and nothing else — the document viewer's thumbnail toggle, page prev/next, and find.

The third gives the button no accessible name at all, so it appears in a CDP snapshot as a bare `button` with nothing to match on. The only way to pick one is by index or geometry, and index is wrong the moment a conditional control renders: guessing the thumbnail toggle in the viewer toolbar lands on the close button, which silently tears down the thing being captured.

This is an accessibility bug first. A screen reader gets the same nothing the automation does. Nine sites, five files, worst in `components/document-viewers/viewer-toolbar.tsx`.

### There is no way to put the app into a given state

The renderer does not reflect the current route in its URL, and the main window restores its persisted tab session on load. Together that means:

- `location.hash` is not the route. Checking it reports `#/` no matter what is on screen.
- Navigating the renderer to a route URL does not open that route. The page loads and the restored tabs paint over it.

So a script has to reach every surface the way a person does: click the sidebar, open the task header's Files tab, walk the dev panel's Pages menu, open Settings. Each of those is a multi-step click chain that has to be rediscovered per surface, and each step is a chance to land somewhere else.

### `element.click()` does not reach React handlers on composite rows

Dispatching a click from `evaluate_script` works on a plain `<button>`, but a file card or list row carries its handler on an ancestor, and the synthetic event does not trigger it. It returns normally, so the script continues against an unchanged UI. Real CDP input (`click <uid>` from a snapshot) works.

Same class of problem: `use-stick-to-bottom` releases auto-follow on a real `wheel` gesture, so assigning `scrollTop` is immediately overridden. Any transient that only exists while scrolled away from the live edge (the scroll-to-latest activity ring) is unreachable without dispatching `wheel`.

### Blank frames are indistinguishable from real ones

An occluded window, or one mid-reload, produces a screenshot that is a well-formed PNG of uniform background. Nothing in the response says so. Two consecutive captures came back byte-identical before the cause was obvious.

### Any repo write resets the app mid-run

A commit or file change anywhere in the checkout triggers an HMR sweep that returns the app to its start route. In a scripted run that reads as "the click stopped working", and the natural response is to debug the click.

### Some states are unreachable in dev by construction

- The post-update toast requires `lastLaunchedVersion` in the dev preferences store to be older than the running version plus `FORCE_DEV_AUTO_UPDATE=true`. Reproducing it means writing to a developer's real config.
- The running-agent quit confirmation short-circuits on `is.dev` (`lib/create-workspace-actor.ts`), and is a native `dialog.showMessageBox` besides, so it is outside the web contents CDP can see at all.

The dev panel's Updates submenu simulates download, error, and no-updates, but not either of these.

### Tooling gaps in the CDP CLI

- The subcommand list is long enough to be worth reading to the end. `press_key`, `type_text`, `handle_dialog`, `upload_file` and `screencast_start` are all there and easy to miss, and reaching for a synthetic `KeyboardEvent` instead only works when the handler is a document-level listener, as the `?` shortcut guide happens to be.
- `click_at` is behind `--experimentalVision`.
- The daemon does not notice when the app it was pointed at dies. The resulting error names Chrome, not Studio, which sends you to look at the wrong process.
- `take_screenshot` writes device pixels while `getBoundingClientRect()` returns CSS pixels. Documented in the studio-chrome-devtools repro recipes, but every run still rebuilds the same crop arithmetic.

### Capture runs depend on ambient state

Finding a task containing a PDF meant grepping the shared dev userData directory. With no catalog of fixture tasks, what a run could capture depended on what that developer happened to do last.

## What was done about it

Most of the list below has landed. `.agents/skills/studio-chrome-devtools/scripts/studio-drive.mjs` is the entry point, backed by `client/lib/studio-drive.ts` in the renderer:

- Icon-only controls carry an accessible name, guarded by `components/ui/icon-button-accessible-name.test.ts`.
- `window.__studioDrive` (dev builds, main window) exposes `goto`, `openModal`, `closeModal`, and a `state` that reports the real route, the tabs, and any open dialog's title.
- The script speaks CDP directly, so there is no daemon to go stale and no reconnect to invalidate page ids mid-run. Screenshots crop browser-side, and refuse to fire when nothing is mounted.
- `boot` claims a port of its own rather than attaching to the conventional one, so an agent and a person are never driving the same window.
- The dev panel can simulate the post-update toast and force the quit guard.

- `boot --workspace <fixture>` runs against a workspace built from a committed description (`fixtures/workspaces/`) rather than the shared dev application-data directory, so a run no longer depends on what that machine did last.

What is still open: an HMR freeze for scripted runs. The native quit dialog remains uncapturable by CDP by construction.

## What would help, in leverage order

**1. Give every icon-only control an `aria-label` mirroring its tooltip.** Nine sites. Cheapest fix here, removes the single worst failure mode, and is a real accessibility improvement rather than a test affordance. Worth a lint rule or a DOM test asserting every `<Button size="icon*">` has an accessible name, so the pattern does not come back.

**2. A dev-only renderer drive hook.** Something like `window.__studio` exposing `goto(route)`, `openTask(id)`, `openArtifact(path)`, and `openModal(name)`, guarded by `is.dev`. This is the largest win available: it collapses every multi-step click chain into one call, removes the tab-restore conflict, and makes a capture script readable. Everything else in this list gets smaller if this exists.

**3. A `studio-drive` helper alongside `connect-cli.sh`.** Wrap the operations every run reimplements, with the traps handled inside: boot with `ELECTRON_RUN_AS_NODE` cleared and a wait-for-CDP loop, idempotent daemon connect, `click-text` that filters to visible elements and uses real input, `rect` for measurement, and `shot` that screenshots, crops by a measured rect, and applies the dpr itself.

**4. Make `shot` refuse a blank frame.** Compare against the previous capture and check pixel variance; fail loudly rather than writing a black PNG. This turns the most confusing failure into an immediate one.

**5. A `press` primitive** over raw `Input.dispatchKeyEvent`, so hotkey-driven UI does not depend on the handler happening to be document-level.

**6. Two dev panel entries: simulate the post-update toast, and force the quit guard in dev.** Both are currently unreachable without touching a developer's config or building a package. The updater submenu is already the right home.

**7. An HMR freeze for scripted runs.** An env var or dev-panel toggle that suppresses renderer reloads while a capture is in flight, so an unrelated commit does not silently reset the run.

**8. More seeded fixtures.** The corpus and the seeder exist (`fixtures/workspaces/`, `docs/plans/active/seeded-test-workspaces.md`); what it holds is one documents fixture. A browser session and a long transcript are the next two worth recording.

**9. Teach `connect-cli.sh` to distinguish a dead app from a stale daemon** and restart the daemon on its own, rather than surfacing a Chrome error for a Studio problem.

## Related

- `.claude/skills/find-ui-changes/references/capturing-screenshots.md` — the workflow these traps were found in, including the pixel-space rule and the Notion upload path.
- `.agents/skills/studio-chrome-devtools/references/repro-recipes.md` — screenshot coordinate math and the composer controlled-input gotcha.
- `docs/findings/css-zoom-rect-vs-layout-px.md` — the other place rect and layout pixel spaces diverge.
