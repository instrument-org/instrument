---
name: studio-chrome-devtools
description: Use when working with Chrome DevTools against the Studio Electron app in this repo. Load this for Studio-specific connection details and page selection. Especially relevant when the user mentions Electron, `chrome-devtools`, `chrome-devtools-cli`, browser views, smoke tests, or debug routes.
---

# Studio Chrome DevTools

This skill explains how to connect Chrome DevTools tooling to the Studio Electron app in this repo.

Use it alongside the generic `chrome-devtools` or `chrome-devtools-cli` skill for the actual commands and tool syntax.

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

## Evaluating JavaScript

Use `evaluate_script` (not `evaluate_js`) to run code in the selected page:

```bash
pnpm exec chrome-devtools evaluate_script "function() {
  return document.title;
}"
```

Important: the argument must be a named `function()` declaration string, not an arrow function or bare expression. The function must return a JSON-serializable value.

## Interaction Notes

- Studio enables Chromium's `allow-pre-commit-input` switch to make CDP mouse input work better with `<webview>` guests (agent-browser tabs).
- If an interaction fails, re-run `list_pages` and `take_snapshot` before retrying.
- For route-specific work, prefer selecting the page that already has the target route open over trying to navigate the wrong renderer into place.
- `pnpm exec chrome-devtools list_pages --output-format=json` is useful when a script needs stable page ids for the current CLI session.

## Reproducing A Bug End-To-End

See [references/repro-recipes.md](references/repro-recipes.md) for: replaying a recorded task instead of live-driving the agent (fast, free, deterministic), the `#/debug/*` pages, the chat composer's controlled-input gotcha (`fill` looks like it works but leaves the send button disabled), reading a `<webview>` guest's real internal state, and why screenshot pixel math should never be hand-converted.
