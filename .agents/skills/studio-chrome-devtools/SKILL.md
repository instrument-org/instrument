---
name: studio-chrome-devtools
description: Use when working with Chrome DevTools against the Studio Electron app in this repo. Load this for Studio-specific connection details and page selection. Especially relevant when the user mentions Electron, `chrome-devtools`, `chrome-devtools-cli`, browser views, smoke tests, or debug routes.
---

# Studio Chrome DevTools

How to drive and inspect the Studio Electron app. Use it alongside the generic `chrome-devtools` or `chrome-devtools-cli` skill for command syntax.

## Driving: `studio-drive.mjs`

```bash
DRIVE=.agents/skills/studio-chrome-devtools/scripts/studio-drive.mjs

node $DRIVE boot                                     # your own instance
node $DRIVE goto /release-notes
node $DRIVE state
node $DRIVE click --text "New skill"
node $DRIVE shot out.png --selector '[role=dialog]' --pad 8
node $DRIVE stop
```

Also `press`, `wait`, `modal`, `eval`. It speaks CDP directly, so there is no daemon to go stale and no reconnect to invalidate page ids, and it handles the things that otherwise fail quietly: real input, visible-only element matching, browser-side screenshot cropping, and a check that something is mounted before capturing.

For a control with no distinguishing text, mark it in one `eval` and click the mark, which keeps the real input path rather than falling back to `element.click()`:

```bash
node $DRIVE eval 'document.querySelectorAll("button[aria-haspopup=menu]")[3].setAttribute("data-probe", "kebab")'
node $DRIVE click --selector '[data-probe=kebab]'
```

`boot` starts an instance on a port derived from the checkout you are standing in. It will not fall back to 48160 — that is the conventional port and almost always a window a person is using, so driving it means their clicks fight yours and their quit ends your run. Pass `--port` to target one deliberately.

Route and modal commands go through `window.__studioDrive`, a dev-only handle the renderer attaches (`client/lib/studio-drive.ts`). A packaged build, and any checkout without that file, will not have it.

A plain `boot` uses the shared dev application-data directory, so what a run can reach depends on what that machine did last. `--workspace <fixture>` boots against a disposable one built from a committed description:

```bash
node $DRIVE boot --workspace documents
node $DRIVE goto /tasks/generated-pdf --workspace documents
```

It seeds when the fixture is absent or has changed (`--fresh` forces a rebuild) and reports the seeded task ids, so a script addresses a task by name instead of grepping for one. `--workspace` belongs on every command of the run: it picks the port and the instance record, so a fixture run and a plain dev run can both be up. `pnpm workspace:seed --list` shows what exists; `fixtures/workspaces/README.md` covers adding one.

## Page model

Studio is one window and one web contents: `AppChrome` and every open tab mount in the same page. Agent-browser tabs are renderer `<webview>` guests inside it, not separate DevTools targets. The app root carries `data-testid="app-page"`.

The renderer keeps the current route out of the window URL, and the main window restores its persisted tab session on load. So `location.hash` is not the route, and navigating the web contents to a route URL does not open it — the restored tabs paint over it. Use `state` to read where you are and `goto` to move.

In `state`, `path` is authoritative; `tabs[].pathname` mirrors it a moment later.

## States a dev build otherwise cannot reach

Both have a dev panel entry under the `dev` badge:

- **Updates > Simulate updated toast (reloads)** — the toast only fires when the app launches on a newer version than the last launch. The item queues the bump and reloads, the path a real update takes. It auto-dismisses in a few seconds, so capture promptly.
- **Force quit guard** — dev builds skip the running-agent quit prompt so hot reload is never blocked on a dialog nobody sees. In memory only, so a relaunch clears it; while on, a main-process rebuild waits on the dialog.

The quit prompt is a native `showMessageBox`, outside the web contents. CDP cannot capture it.

## Traps

- `element.click()` from an evaluated script dispatches a bare `click`, so it misses a handler mounted on an ancestor (how file cards and list rows are built) and every menu, popover and select, whose Radix triggers open on `pointerdown` and carry no click handler at all. It returns normally either way, so the run carries on against an unchanged UI. Use real input.
- `click --text` matches only what is visible, so a control scrolled out of a long list reports as missing rather than being scrolled to. Bring it into view first, or address it by selector.
- `use-stick-to-bottom` releases auto-follow on `wheel`, so assigning `scrollTop` is overridden immediately, and UI that only appears when scrolled off the live edge stays unreachable.
- `?` opens the shortcut guide only when focus is outside an editable and nothing is blocking. Pressing it while the composer has focus does nothing and reads as the tool failing.
- After a main-process edit, the relaunched Electron can lose the debug port to the dying instance (`bind() failed: Address already in use`) and come back with no endpoint. Restart the dev server.
- Studio sets Chromium's `allow-pre-commit-input` so CDP mouse input works against `<webview>` guests.

## The CLI, for interactive inspection

```bash
CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS=1 pnpm exec chrome-devtools start --browserUrl http://127.0.0.1:<port>
```

`bash .agents/skills/studio-chrome-devtools/scripts/connect-cli.sh [browserUrl] [urlFragment]` wraps the probe, start and page selection.

- `--browserUrl` belongs on `start`; later subcommands talk to the daemon.
- The daemon outlives invocations and keeps its old version after a package upgrade. `stop` then `start` to pick up a new one, or to clear a stale socket behind an `ENOENT`.
- `evaluate_script` requires an anonymous `function () { ... }` string, not an arrow or a bare expression. (`studio-drive eval` accepts either.)
- Input commands exist beyond the obvious ones: `press_key` takes combinations like `Control+Shift+R`, plus `type_text`, `handle_dialog`, `upload_file`, `screencast_start`.

## Reference

[references/repro-recipes.md](references/repro-recipes.md): replaying a recorded task instead of live-driving the agent, the `#/debug/*` pages, the composer's controlled-input gotcha where `fill` leaves the send button disabled, reading a `<webview>` guest's internal state, and why screenshot pixel math should never be hand-converted.
