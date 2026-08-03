---
name: studio-chrome-devtools
description: Use when working with Chrome DevTools against the Studio Electron app in this repo. Load this for Studio-specific connection details and page selection. Especially relevant when the user mentions Electron, `chrome-devtools`, `chrome-devtools-cli`, browser views, smoke tests, or debug routes.
---

# Studio Chrome DevTools

This skill explains how to connect Chrome DevTools tooling to the Studio Electron app in this repo.

Use it alongside the generic `chrome-devtools` or `chrome-devtools-cli` skill for the actual commands and tool syntax.

## Start here: `studio-drive.mjs`

For driving the app rather than inspecting it, prefer the helper:

```bash
node .agents/skills/studio-chrome-devtools/scripts/studio-drive.mjs boot
node .agents/skills/studio-chrome-devtools/scripts/studio-drive.mjs goto /release-notes
node .agents/skills/studio-chrome-devtools/scripts/studio-drive.mjs click --text "New skill"
node .agents/skills/studio-chrome-devtools/scripts/studio-drive.mjs shot out.png --selector '[role=dialog]'
node .agents/skills/studio-chrome-devtools/scripts/studio-drive.mjs stop
```

It talks to the debug port directly, so there is no CLI daemon to go stale, and it handles the things that otherwise fail quietly: real mouse and key input, visible-only element matching, browser-side screenshot cropping, and a check that something is actually mounted before it captures.

**In a worktree that predates this script, run it from the worktree anyway.** The checkout it drives is the one your shell is standing in, resolved with `git rev-parse --show-toplevel`, not the one the file lives in. So invoking another checkout's copy by absolute path is fine, and `boot` still starts *your* worktree's app on *your* worktree's port. Copying the script in also works and is tidier.

**Boot your own instance; do not reach for port 48160.** That is the conventional port, so it is almost always a window a person is using: driving it means their clicks fight yours and their quit ends your run. `boot` claims a free port above it and records it per checkout, and every other command reads that record. There is no fallback to 48160 — pass `--port 48160` if you genuinely mean that instance.

Route and modal commands go through `window.__studioDrive`, a dev-only handle the renderer attaches (`client/lib/studio-drive.ts`). `state` is how you find out where the app actually is; see Page Model below for why you cannot read that off the URL.

## Connection

Studio exposes a remote debugging endpoint on port `48160`.

- CLI: start with `CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS=1 pnpm exec chrome-devtools start --browserUrl http://127.0.0.1:48160`
- MCP config: launch `pnpm exec chrome-devtools-mcp` with `--browserUrl=http://127.0.0.1:48160`

Useful probe endpoints:

- `http://127.0.0.1:48160/json/version`
- `http://127.0.0.1:48160/json/list`

The `chrome-devtools-mcp` package is installed as a dev dependency at the monorepo root. Always invoke it via `pnpm exec`, never a global install:

```bash
CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS=1 pnpm exec chrome-devtools <subcommand>
```

Important CLI nuances:

- `CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS=1` suppresses the CLI's package update notice.
- `--browserUrl` belongs on `chrome-devtools start`, not on `list_pages`, `take_snapshot`, or other subcommands.
- After `start`, later subcommands talk to the local CLI daemon and do not need `--browserUrl`.
- `pnpm exec chrome-devtools start` may print very little on success. Verify with `pnpm exec chrome-devtools list_pages`.
- All subsequent subcommands operate on the currently selected page. Use `select_page <id>` to switch pages.
- `list_pages --output-format=json` returns `{ pages: [{ id, url, selected }], extensionServiceWorkers: [] }`.
- The daemon persists across invocations. `chrome-devtools status` shows its pid, socket, and version; `chrome-devtools stop` kills it. After updating the `chrome-devtools-mcp` package, run `stop` then `start` so the daemon picks up the new version (a running daemon keeps its old version until restarted).

If the CLI wrapper reports an `ENOENT` socket error under the sandbox, retry outside the sandbox. In this repo, the Electron endpoint itself is usually fine. The failure is often the local CLI daemon socket, not Studio; `chrome-devtools stop` followed by `start` clears a stale socket.

## Quick Start Script

Use the helper script in this skill to probe Studio, start the CLI bridge, and list pages:

```bash
bash .agents/skills/studio-chrome-devtools/scripts/connect-cli.sh
```

To also select a likely page by URL fragment and immediately snapshot it:

```bash
bash .agents/skills/studio-chrome-devtools/scripts/connect-cli.sh \
  http://127.0.0.1:48160 \
  '#/debug/components'
```

What the script does:

1. Probes `/json/version` and `/json/list` on Studio's Electron debug port.
2. Runs `pnpm exec chrome-devtools start --browserUrl ...`.
3. Runs `pnpm exec chrome-devtools list_pages --output-format=json`.
4. If a URL hint was provided, selects the first page whose URL contains that hint and runs `take_snapshot`.

Run this script outside the sandbox. In Cursor Shell calls, use `required_permissions: ["all"]`. If the raw `/json/*` probes work but the CLI still fails with `ENOENT`, the daemon socket is the problem.

## Studio Page Model

Studio is a single window / single web contents: `AppChrome` (sidebar + chrome) and every open tab are all mounted in the same page. There's no separate shell window, no shield `data:` page, and no per-tab `WebContentsView` — that multi-view model was removed when the chrome was hoisted into one web contents. `list_pages` should show one Studio page (URL starts `#/...`), plus a separate onboarding window if that flow is active, plus any real debug/devtools pages.

Agent-browser tabs are renderer `<webview>` guests inside that same page, not separate DevTools-visible pages.

The renderer does not put the current route in the window URL, and the main window restores its persisted tab session on load. Two consequences worth knowing before you debug something that is not broken:

- `location.hash` is not the route. Use `studio-drive.mjs state`, which reports the active tab's real pathname, its tabs, and any open dialog's title.
- Navigating the web contents to a route URL does not open that route: it loads, then the restored tabs paint over it. Use `goto`.

In `state` output, `path` is authoritative and `tabs[].pathname` is the tab bar's mirror of it, which lands a moment later.

## How To Pick The Right Page

1. Run `list_pages` and pick the Studio page (ignore any onboarding window unless that's what you're testing).
2. If multiple Studio-looking pages appear, prefer the one whose URL matches the route the user is looking at right now.
3. After selecting, run `take_snapshot` to confirm you landed in the right renderer.

## Stable Marker In The Renderer

The rendered app root has `data-testid="app-page"` (`app-chrome.tsx`). Use it in snapshots or script evaluation to confirm you're on the right root.

## Recommended Workflow

1. Ensure Studio is already running with the debug port available.
2. Prefer `bash .agents/skills/studio-chrome-devtools/scripts/connect-cli.sh`.
3. Choose the correct page by URL fragment such as `#/tasks/...` or `#/debug/...`.
4. Run `take_snapshot`.
5. Verify you see the expected root marker or route content before clicking or typing.

## States a dev build otherwise cannot reach

Two states are gated in ways that make them invisible to a normal dev run. Both now have a dev panel entry under the `dev` badge:

- **Updates > Simulate updated toast (reloads)** — the post-update toast only fires when the app launches on a version newer than the last launch. The item queues the bump and reloads, which is the same path a real update takes; the toast auto-dismisses after a few seconds, so capture promptly.
- **Force quit guard** — dev builds skip the running-agent quit prompt so hot reload is never blocked on a dialog nobody sees. The checkbox opts back in. It is in memory only, so a relaunch clears it; while it is on, a main-process rebuild will wait on the dialog.

The quit prompt is a native `showMessageBox`, so it is outside the web contents entirely. CDP cannot capture it; use an OS screen capture.

## Evaluating JavaScript

Use `evaluate_script` (not `evaluate_js`) to run code in the selected page:

```bash
pnpm exec chrome-devtools evaluate_script "function() {
  return document.title;
}"
```

Important: the argument must be a named `function()` declaration string, not an arrow function or bare expression. The function must return a JSON-serializable value.

## Interaction Notes

- Read the whole subcommand list before hand-rolling input. `press_key` (accepts combinations like `Control+Shift+R`), `type_text`, `handle_dialog`, `upload_file`, and `screencast_start` are all there and easy to miss partway down `--help`.
- An unmodified hotkey can be declined on purpose. `?` opens the shortcut guide only when focus is outside an editable and no modal is blocking, so pressing it while the prompt composer holds focus does nothing and looks like the tool failed. Blur first, then press.
- `element.click()` from `evaluate_script` reaches a plain `<button>` but not a handler mounted on an ancestor, which is how file cards and list rows are built. It returns normally, so the script carries on against an unchanged UI. Use real input (`studio-drive.mjs click`, or the CLI's `click <uid>`).
- Anything driven by a real gesture needs one. `use-stick-to-bottom` releases auto-follow on `wheel`, so assigning `scrollTop` is immediately overridden and transient UI that only shows when scrolled away from the live edge stays unreachable.
- After editing main-process code, the dev server relaunches Electron and the new instance can lose the debug port to the dying one (`bind() failed: Address already in use`). The app comes back without a debug endpoint; restart the dev server.
- Studio enables Chromium's `allow-pre-commit-input` switch to make CDP mouse input work better with `<webview>` guests (agent-browser tabs).
- If an interaction fails, re-run `list_pages` and `take_snapshot` before retrying.
- For route-specific work, prefer selecting the page that already has the target route open over trying to navigate the wrong renderer into place.
- `pnpm exec chrome-devtools list_pages --output-format=json` is useful when a script needs stable page ids for the current CLI session.

## Reproducing A Bug End-To-End

See [references/repro-recipes.md](references/repro-recipes.md) for: replaying a recorded task instead of live-driving the agent (fast, free, deterministic), the `#/debug/*` pages, the chat composer's controlled-input gotcha (`fill` looks like it works but leaves the send button disabled), reading a `<webview>` guest's real internal state, and why screenshot pixel math should never be hand-converted.
