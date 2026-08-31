# Studio

Electron desktop app.

## Dev hot reload

`pnpm dev` hot reloads all 3 targets (`watch` in `electron.vite.config.ts`). Renderer = HMR; main edits auto-rebuild + relaunch, preload edits auto-rebuild + full-reload the renderer. Don't tell user to manually restart for main-process changes (menus, IPC, windows) — save = auto-relaunch.

`DISABLE_DEV_RELAUNCH=true` drops the main/preload half, leaving those two at the bytes they booted with while the renderer keeps HMR. It exists for an instance an agent is driving, where a relaunch is a hard kill that takes the run's state, every task `<webview>`, and any agent turn in flight — see `.agents/skills/studio-chrome-devtools/SKILL.md`. `studio-drive.mjs boot` sets it; nothing else does, so a hand-started instance behaves as above.

## Dependencies vs devDependencies

electron-builder bundles `dependencies` into the asar. Renderer-only packages go in `devDependencies` (Vite bundles them); putting them in `dependencies` bloats the app by tens of MB.

- `dependencies`: main-process runtime only (`hono`, `better-auth`, `xstate`, `ws`, native addons)
- `devDependencies`: renderer-only (React, Radix, `motion` if renderer-only)

## Project

Renderer: React 19, TanStack Router file routes, shadcn UI, oRPC to main process. Main process calls the remote API (accounts, plans, Stripe); UI never hits it directly, only via main-process RPC.

- No `cursor: pointer` for links (desktop app).
- Use shadcn Tailwind colors (`bg-background`), not raw colors.
- `rpcClient` `.call()` throws unless wrapped with `safe` from `@orpc/client`; use only for imperative calls outside React.
- Queries: `useQuery` + `rpcClient.method.name.queryOptions({ input })`. Skip conditionally with `skipToken`.
- Streams: `live.*` and `events.*` both take `experimental_liveOptions`, but `events.*` has no `data` until something fires, so treat it as a trigger. A live procedure and its non-live twin are separate cache keys.
- External links: `<ExternalLink href="..." />` or `rpcClient.utils.openExternalLink`.
- Route matching: `useMatchRoute`, never pathname strings.
- After adding/removing/renaming files under `src/client/routes`, run `pnpm --filter @instrument-org/studio run routes:generate`. Don't hand-edit `routeTree.gen.ts`.
- RPC types: `RPCInput`/`RPCOutput` from `@/client/rpc/client`. Never redeclare inferable types.
- Persisted renderer state (`atomWithStorage`) takes a `studio.<name>.v<n>` key. The namespace keeps it apart from everything else sharing the origin; the version is what lets the value's meaning change later, since bumping it makes an old one ignored rather than read as something it is not. That failure is silent — a pane width stored in pixels and later read as a fraction is a pane a hundred times too small.

## Windows

Two top-level windows, each its own `BrowserWindow` / web contents, both loaded from the same renderer bundle. `client/main.tsx` picks the root by `window.api.windowType` (set via the `--windowType` preload arg):

- **main** — renders `<MainWindow />`: the full multi-tab app (chrome + tabs in one web contents). This is what "single web contents" below refers to.
- **onboarding** — renders `<App />`: a small (480×600), fixed-size, non-resizable "Welcome" window (`windows/onboarding.ts`) that runs the single-router onboarding flow at `/onboarding`. Shown before the main window on first run; dismissing it without completing quits the app.

They share renderer state that's `localStorage`-backed at the same origin (e.g. `zoomAtom`, theme), so anything scoped to a single window (tab commands, main-only chrome) must not assume the onboarding window is present.

Closing the last window quits the app on **every** platform, macOS included, and runs the same running-agent confirmation as Cmd+Q (`lib/quit-guard.ts`). Nothing outlives the last window; see `docs/decisions/2026-07-25-quit-when-the-last-window-closes.md`.

## App-wide modals

`AppShell`/`AppChrome` is a single web contents (the **main** window; see Windows), so modals are plain `<Dialog>`s at the chrome root, not separate overlay views.

- **App-wide** (`login`, `welcome`, `settings`, `project`, `skill`, `delete-task`, `shortcut-guide`): a Jotai atom (`atoms/<name>-modal.ts`, created via `studioModalAtom()` from `atoms/studio-modal.ts`) + `openX()` setter callable from anywhere + a component in `components/studio-modals/<name>-modal.tsx`, all mounted once via `<StudioModals />` in `app-chrome.tsx`. At most one app-wide modal is open at a time: opening one replaces whichever is open (never stacks) — e.g. sign-in triggered from inside settings closes settings. The exception is a modal created with `replaceable: false` (the `welcome` onboarding gate), which holds the slot until it closes itself; opening another over it is ignored.
- **Contextual** (`delete-project`): `<Dialog>` inline next to its trigger with local `useState`. Use for a small number of co-located triggers.
- `useBlockTabNavigation(open)` opts a modal out of tab shortcuts (Cmd+T/W/etc.) while open.

## Copy

Quote a name the user chose — a folder, project, skill, or their own search text — in curly quotes: `Remove “${name}”?`. Straight quotes are syntax: SQL identifiers, CSS selectors, `throw`s, prompt text for the model.

## UI zoom

The whole main window scales with CSS `zoom` on `ZoomRoot` (`zoomAtom`, user-adjustable 0.5x–2x). `zoom` compounds down the tree and floating-ui doesn't yet correct for an ancestor's zoom, so anything positioned, sized, or measured against the viewport needs care when zoom ≠ 1 — and it's silently fine at the 1x default, so check other levels. `docs/architecture/responsive-layout.md` and `use-app-zoom.ts` carry the full rationale and the per-unit rules; what you need before reading them:

- Size a dialog with `DialogContent`'s `maxWidth`/`maxHeight` props (intrinsic sizes, e.g. `maxWidth="42rem"`), never a `max-w-*`/`max-h-*` class: `cn()` merges the class over the primitive's own and takes the window cap away with it. Same for `TooltipContent`'s `maxWidth` and `PopoverContent`'s `maxHeight` — a popover given no `maxHeight` takes the room Radix measured for it, so tall content wants a scroll rather than a taller panel.
- Floating content stays clear of the toolbar band, which on macOS is where the traffic lights are drawn over the web contents: `ChromeInsetProvider` (mounted in `app-chrome.tsx`) declares its depth and `useChromeCollisionPadding` is the default `collisionPadding` on every Radix content primitive. It reaches menus that set `avoidCollisions={false}` too, since Radix hands the padding to the `size` middleware either way. Zero outside the main window, and inert for a `Select` left on `position="item-aligned"`.
- Reuse `useAppZoomStyle` + `zoomMaxSize` on any new floating/portalled UI, or `use-portal-container.tsx` when portalling into the zoomed tree, instead of hand-rolling zoom math. A full-window overlay wants `fixed inset-0` and no viewport units at all (`task/transcript-viewer.tsx`, `task/file-viewer-modal.tsx`).
- A virtualizer inside self-zoomed content must measure in layout px: pass `measureElement: (el) => el.offsetHeight` and an `observeElementRect` reading `offsetWidth`/`offsetHeight`. The defaults read `getBoundingClientRect`, which is on-screen px.
- Never add a `container-type` above a portal target. floating-ui counts it as a containing block for fixed content and Chrome doesn't, so every menu/popover silently shifts by that element's offset. `@container/app-content` sits below the portal target for exactly this reason.
- Routes lay out against that `@container/app-content` container (`TabView` puts it around them), never viewport media queries.
- Both windows (see Windows) use the same `ZoomRoot` + `zoomAtom`: the onboarding window wires it via `OnboardingZoomRoot`. `ZoomToast` (a transient corner readout on any zoom change) is mounted once per window, outside `ZoomRoot`, so keep it in sync in both roots.

## Tests

Three Vitest projects, chosen by extension: `*.test.ts` node, `*.test.tsx` jsdom, `*.browser.test.tsx` real Chromium. `vitest.config.ts` says what each one can see and why it is configured as it is. Reach for the cheapest that can observe the behavior, knowing jsdom has no layout engine and never delivers `selectionchange`: anything measured, scrolled, or driven by the browser's own selection passes there whether the code works or not.

Render through the helpers rather than `render` directly. Each carries the docblock that says when to pick it:

- `renderWithProviders` / `renderWithDefaultStore` — `src/tests/render.tsx`. The second is for code that writes through `getDefaultStore()`, which every `openX()` modal setter does.
- `renderInBrowser` — `src/tests/render-browser.tsx`.
- `ariaSnapshot` — `src/tests/aria-snapshot.ts`. Structure rather than pixels, and the only honest test for an icon-only control.

Confirm an assertion fails against the unfixed code before keeping it. A DOM test passes for reasons unrelated to what it claims to cover far more easily than a node test does.

Browser tests need `pnpm exec playwright install chromium` once, then `pnpm test:browser`; a failure leaves a Playwright trace under `__traces__/`.

Outside the three projects, `vitest.smoke.config.ts` (`pnpm smoke-test`) runs the packaged-app boot smoke test CI gates releases on, saving screenshots under `smoke-test-screenshots/`.

## Where things are

- **Client**: `src/client`, file routes in `src/client/routes/` (`_app/` = layout/auth).
- **UI**: shadcn in `src/client/components/ui`; shared in `src/client/components/`.
- **Debug**: `_app/debug/` and the settings modal's Debug tab (`components/settings/debug-section.tsx`) — experimentation only.
- **RPC**: main handlers in `src/electron-main/rpc/routes/`; client in `src/client/rpc/client.ts` (MessageChannel only).
- **Platform API**: main-process only, `src/electron-main/platform-api/`; UI reads via RPC (`user.me`, `plans.get`).
- **Browser build**: `web/` runs this same renderer as a plain web page with the Electron boundary replaced by fixtures (`pnpm dev:web`, port 5180). Development only, never packaged. Adding a screen's data means adding fixtures there; see `docs/architecture/studio-in-the-browser.md`.
