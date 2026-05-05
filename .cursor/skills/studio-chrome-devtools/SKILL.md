---
name: studio-chrome-devtools
description: Use when working with Chrome DevTools against the Studio Electron app in this repo. Load this for Studio-specific connection details, page selection, and multi-WebContentsView behavior. Especially relevant when the user mentions Electron, `chrome-devtools`, `chrome-devtools-cli`, shell window, main window, browser views, smoke tests, or debug routes.
---

# Studio Chrome DevTools

This skill explains how to connect Chrome DevTools tooling to the Studio Electron app in this repo.

Use it alongside the generic `chrome-devtools` or `chrome-devtools-cli` skill for the actual commands and tool syntax.

## Connection

Studio exposes a remote debugging endpoint on port `48160`.

- CLI: start with `chrome-devtools start --browserUrl http://127.0.0.1:48160`
- MCP config: launch `chrome-devtools-mcp` with `--browserUrl=http://127.0.0.1:48160`

Useful probe endpoints:

- `http://127.0.0.1:48160/json/version`
- `http://127.0.0.1:48160/json/list`

Important CLI nuances:

- `--browserUrl` belongs on `chrome-devtools start`, not on `list_pages`, `take_snapshot`, or other subcommands.
- After `start`, later subcommands talk to the local CLI daemon and do not need `--browserUrl`.
- `chrome-devtools start` may print very little on success. Verify with `chrome-devtools list_pages`.
- All subsequent subcommands operate on the currently selected page. Use `select_page <id>` to switch pages.
- `list_pages --output-format=json` returns `{ pages: [{ id, url, selected }], extensionServiceWorkers: [] }`.

If the CLI wrapper reports an `ENOENT` socket error under the sandbox, retry outside the sandbox. In this repo, the Electron endpoint itself is usually fine. The failure is often the local CLI daemon socket, not Studio.

## Quick Start Script

Use the helper script in this skill to probe Studio, start the CLI bridge, and list pages:

```bash
bash .cursor/skills/studio-chrome-devtools/scripts/connect-cli.sh
```

To also select a likely page by URL fragment and immediately snapshot it:

```bash
bash .cursor/skills/studio-chrome-devtools/scripts/connect-cli.sh \
  http://127.0.0.1:48160 \
  '#/debug/components'
```

What the script does:

1. Probes `/json/version` and `/json/list` on Studio's Electron debug port.
2. Runs `chrome-devtools start --browserUrl ...`.
3. Runs `chrome-devtools list_pages --output-format=json`.
4. If a URL hint was provided, selects the first non-shield page whose URL contains that hint and runs `take_snapshot`.

Run this script outside the sandbox. In Cursor Shell calls, use `required_permissions: ["all"]`. If the raw `/json/*` probes work but the CLI still fails with `ENOENT`, the daemon socket is the problem.

## Studio Page Model

Do not assume Studio is a single page.

The app commonly exposes multiple debuggable pages at once:

- a shell window at `#/shell`
- a main app window at other `#/...` routes
- debug routes such as `#/debug/...`
- extra `WebContentsView` instances
- a shield `data:` page used internally to prevent tab flicker

Always start with `list_pages`, then select by URL and only then inspect or interact.

## How To Pick The Right Page

Use these rules:

1. Ignore `data:text/html,<body bgcolor=...>` style pages. That is the internal shield view.
2. If you want the sidebar or shell chrome, pick the page whose URL contains `#/shell`.
3. If you want the main app, pick a non-shell Studio route such as `#/projects/...`, `#/debug/...`, or another `#/...` page that is not `#/shell`.
4. If multiple candidate pages exist, prefer the one whose URL matches the route the user is looking at right now.
5. After selecting a page, immediately run `take_snapshot` to confirm you landed in the right renderer.

## Stable Markers In The Renderer

When you need to confirm you are on the right Studio root:

- shell window contains `data-testid="shell-page"`
- main app window contains `data-testid="app-page"`

Use those markers in snapshots or script evaluation instead of trusting page order.

## Multi-WebContentsView Caveats

Studio uses multiple `WebContentsView`s, and some internal views can show up in page listings.

Important consequences:

- Do not rely on page index staying stable across runs.
- Do not rely on "first page" or "second page" semantics.
- Extra internal views may appear during tab transitions or browser-view work.
- A keep-mounted or hidden view can still exist even when it is not the user-visible target.

The smoke test in `apps/studio/smoke-test.spec.ts` is the model to follow: it finds windows by URL shape, not by index.

## Recommended Workflow

1. Ensure Studio is already running with the debug port available.
2. Prefer `bash .cursor/skills/studio-chrome-devtools/scripts/connect-cli.sh`.
3. Ignore the shield `data:` page.
4. Choose the correct page by URL fragment such as `#/shell` or `#/debug/...`.
5. Run `take_snapshot`.
6. Verify you see the expected root marker or route content before clicking or typing.

## Evaluating JavaScript

Use `evaluate_script` (not `evaluate_js`) to run code in the selected page:

```bash
chrome-devtools evaluate_script "function() {
  return document.title;
}"
```

Important: the argument must be a named `function()` declaration string, not an arrow function or bare
expression. The function must return a JSON-serializable value.

## Interaction Notes

- On Linux, Studio enables Chromium's `allow-pre-commit-input` switch to make CDP mouse input work better with occluded `WebContentsView`s.
- If an interaction fails, re-run `list_pages` and `take_snapshot` before retrying. A different view may now be selected or exposed.
- For route-specific work, prefer selecting the page that already has the target route open over trying to navigate the wrong renderer into place.
- `chrome-devtools list_pages --output-format=json` is useful when a script needs stable page ids for the current CLI session.
