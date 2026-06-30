# In-page tabs / unified shell — handoff

## State

- Branch `jmack/fp-1157-unify-sidebar-with-main-tab-view` (PR #39, draft).
- Green: `pnpm exec turbo run check:types check:lint --filter=@instrument-org/studio`
  and the Studio vitest suite (93 tests). **Not fully boot-verified.**
- History note: this work was authored in a worktree and reconciled onto this
  branch; a second agent's lint/dev-panel commits sit on top of it.

## Verify FIRST: window zoom (Electron correctness)

Zoom lives in `apps/studio/src/electron-main/windows/main/controls.ts`
(`zoomIn`/`zoomOut`/`resetZoom` → `webContents.setZoomLevel`), driven by the menu
accelerators (Cmd +/-/0) and overlay-aware.

It works in **dev**, where the renderer is served from a localhost URL. Suspected
gap: the **built/packaged app** loads the renderer from a non-localhost (file://)
URL, where Chromium zoom handling differs (per-origin zoom persistence, file://
quirks). Verify zoom in a packaged build; it may need `webFrame.setZoomLevel`
and/or per-URL handling rather than `webContents.setZoomLevel`.

## Also fix: traffic-light vertical centering vs zoom

`trafficLightPosition: { x: 12, y: 12 }` in `windows/main/index.ts` is fixed.
When content zooms, the macOS traffic-light buttons look vertically off-center
relative to the toolbar. Aesthetic; adjust the position to track the current
zoom / toolbar height.

## What changed (high level)

- Main→renderer imperative pushes moved to RPC (tab commands stream over
  `tabs.live.commands`; the agent-browser pool reconciles to
  `agentBrowser.live.targets`). `window.api.onTabCommand` /
  `onAgentBrowserCommand` removed from the preload.
- `TabsManager` deleted: studio overlay → `electron-main/studio-overlay`
  singleton; window zoom/focus/back-forward → `windows/main/controls`. Overlay is
  still WebContentsView-backed (slated to become a React modal).
- Agent browser is a renderer `<webview>` shown in the task artifact panel
  (`browser-panel.tsx` + a body-mounted pool in `lib/agent-browser-pool.ts`).
- Tab state is renderer-owned (jotai `atomWithStorage`); closed tabs restore
  their back/forward history (`lib/tab-router.ts` snapshots the live
  memory-history entries array).
- Browser UX: globe toggle in the prompt input; tab back/forward via Cmd+[ /
  Cmd+] and mouse thumb buttons (shell via `use-mouse-back-forward`, guest via an
  injected page script + `navigateFocusedGuest` for keyboard); guest right-click
  context menu (`browser-view/guest-interactions.ts`); panel chrome matched to
  the artifact aesthetic with slot-tracking during the entry animation.

## Known follow-ups

- Boot-verify everything: menus/zoom/overlay flows, mouse thumb buttons (shell +
  inside the guest), guest context menu, slide-in tracking, closed-tab reopen.
- Replay creates a session that becomes a back/forward target within a tab; make
  the replay navigation `replace` to stop hopping between a task's sessions.
- `electron.vite.config.ts` must keep a **single** preload entry; an earlier
  multi-entry attempt referenced a since-deleted guest preload.

## Key files

- `electron-main/windows/main/controls.ts` — zoom/focus/back-forward
- `electron-main/windows/main/index.ts` — window + traffic lights
- `electron-main/browser-view/manager.ts`, `guest-interactions.ts` — guest CDP,
  input, context menu
- `client/components/task/browser-panel.tsx`, `lib/agent-browser-pool.ts` —
  panel + guest pool
- `client/lib/tab-router.ts`, `components/app-shell.tsx` — tab routers + host
