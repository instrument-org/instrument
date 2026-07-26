# Studio

Electron desktop app.

## Dev hot reload

`pnpm dev` hot reloads all 3 targets (`watch: {}` in `electron.vite.config.ts`). Renderer = HMR; main/preload edits auto-rebuild + relaunch. Don't tell user to manually restart for main-process changes (menus, IPC, windows) — save = auto-relaunch.

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
- External links: `<ExternalLink href="..." />` or `rpcClient.utils.openExternalLink`.
- `cn` helper from `@/client/lib/utils` for conditional/composed classes.
- Route matching: `useMatchRoute`, never pathname strings.
- After adding/removing/renaming files under `src/client/routes`, run `pnpm --filter @instrument-org/studio run routes:generate`. Don't hand-edit `routeTree.gen.ts`.
- RPC types: `RPCInput`/`RPCOutput` from `@/client/rpc/client`. Never redeclare inferable types.

## Windows

Two top-level windows, each its own `BrowserWindow` / web contents, both loaded from the same renderer bundle. `client/main.tsx` picks the root by `window.api.windowType` (set via the `--windowType` preload arg):

- **main** — renders `<MainWindow />`: the full multi-tab app (chrome + tabs in one web contents). This is what "single web contents" below refers to.
- **onboarding** — renders `<App />`: a small (480×600), fixed-size, non-resizable "Welcome" window (`windows/onboarding.ts`) that runs the single-router onboarding flow at `/onboarding`. Shown before the main window on first run; dismissing it without completing quits the app.

They share renderer state that's `localStorage`-backed at the same origin (e.g. `zoomAtom`, theme), so anything scoped to a single window (tab commands, main-only chrome) must not assume the onboarding window is present.

Closing the last window quits the app on **every** platform, macOS included, and runs the same running-agent confirmation as Cmd+Q (`lib/quit-guard.ts`). Nothing outlives the last window; see `docs/decisions/2026-07-25-quit-when-the-last-window-closes.md`.

## App-wide modals

`AppShell`/`AppChrome` is a single web contents (the **main** window; see Windows), so modals are plain `<Dialog>`s at the chrome root, not separate overlay views.

- **App-wide** (`login`, `welcome`, `settings`, `project`, `skill`, `delete-task`): a Jotai atom (`atoms/<name>-modal.ts`, created via `studioModalAtom()` from `atoms/studio-modal.ts`) + `openX()` setter callable from anywhere + a component in `components/studio-modals/<name>-modal.tsx`, all mounted once via `<StudioModals />` in `app-chrome.tsx`. At most one app-wide modal is open at a time: opening one replaces whichever is open (never stacks) — e.g. sign-in triggered from inside settings closes settings.
- **Contextual** (`delete-project`): `<Dialog>` inline next to its trigger with local `useState`. Use for a small number of co-located triggers.
- `useBlockTabNavigation(open)` opts a modal out of tab shortcuts (Cmd+T/W/etc.) while open.

## UI zoom

The whole main window scales with CSS `zoom` on `ZoomRoot` (`zoomAtom`, user-adjustable 0.5x–2x). `zoom` compounds down the tree and floating-ui doesn't yet correct for an ancestor's zoom, so anything positioned or sized against the viewport needs care when zoom ≠ 1 (it's silently fine at the 1x default — check other levels).

- Radix overlays portal to `document.body` (outside the zoomed root) and self-apply zoom on their own Content via `useAppZoomStyle` + the `--content-zoom` max-size divisors. Reuse those helpers on any new floating/portalled UI instead of hand-rolling zoom math.
- If you portal into the zoomed tree instead of `body`, counter-scale the target back to effective 1x (see `use-portal-container.tsx`) so self-applied zoom doesn't double up.
- See `use-app-zoom.ts` for the full rationale and the upstream floating-ui issue to drop this once fixed.
- Zoom also makes viewport media queries a bad proxy for layout width, and splits `getBoundingClientRect()` (on-screen px) from `offsetWidth`/`ResizeObserver` (layout px). Routes lay out against the `@container/app-content` container `TabView` puts around them instead; see `docs/architecture/responsive-layout.md`.
- Never add a `container-type` above a portal target. floating-ui counts it as a containing block for fixed content and Chrome doesn't, so every menu/popover silently shifts by that element's offset. `@container/app-content` sits below the portal target for exactly this reason.
- Both windows (see Windows) use the same `ZoomRoot` + `zoomAtom`: the onboarding window wires it via `OnboardingZoomRoot`. `ZoomToast` (a transient corner readout on any zoom change) is mounted once per window, outside `ZoomRoot`, so keep it in sync in both roots.

## Tests

Three Vitest projects, chosen by extension so a file declares which it wants by what it is. Reach for the cheapest one that can actually observe the behavior:

- `*.test.ts` → **node**, no DOM. Plain logic, parsers, schemas. Fast, and most tests belong here.
- `*.test.tsx` → **dom** (jsdom). Rendering, props, refs, what ends up in the DOM. Adds `@testing-library/react` and `afterEach(cleanup)`.
- `*.browser.test.tsx` → **browser** (real Chromium via Playwright). Typing, selection, caret, measured layout. Uses `vitest-browser-react`'s `render` and `page` locators, not Testing Library.

Render jsdom tests through `renderWithProviders` (`src/tests/render.tsx`), which supplies a **fresh** Jotai store and query cache per call, so module-level atom families don't carry a value between tests. It returns the store for seeding or reading atoms. It does not supply a router: anything with an `InternalLink` needs one per test.

The app itself mounts no Jotai `Provider`, so anything calling `getDefaultStore()` directly (the `openX()` modal setters) writes past a per-test store. Testing one of those means rendering without `renderWithProviders` and asserting on the default store, the way the app is actually wired.

`setup-dom.ts` pins `window.electron.process.platform` to `darwin`, so `isMacOS()`-style checks read the same on every machine. A test asserting the other platform's copy has to stub it per-test.

jsdom has no layout engine and never delivers `selectionchange`, so anything measured, scrolled, or driven by the browser's own selection is invisible to it — a test written that way passes whether the code works or not. That is what the browser project is for. It is slower and needs `pnpm exec playwright install chromium`, so send a test there only when jsdom genuinely cannot see the behavior.

Whatever you assert, confirm it fails against the unfixed code before keeping it. This matters more here than in node tests: a DOM test can easily pass for reasons that have nothing to do with what it claims to cover.

CI runs node and dom in the main check job (`test:ci`) and the browser project in a separate one (`test:browser`), so a Chromium download never sits in front of the rest of the checks and a browser flake reads as its own failure. That job caches Chromium by lockfile hash and reinstalls its system libraries every run, since those land in the runner rather than the cached directory. Browser tests retry twice under `CI`; locally they don't, because there a flake is worth seeing.

Locally, run them with `pnpm test:browser` after `pnpm exec playwright install chromium` once.

## Where things are

- **Client**: `src/client`, file routes in `src/client/routes/` (`_app/` = layout/auth).
- **UI**: shadcn in `src/client/components/ui`; shared in `src/client/components/`.
- **Debug**: `_app/debug/` and `settings/debug` — experimentation only.
- **RPC**: main handlers in `src/electron-main/rpc/routes/`; client in `src/client/rpc/client.ts` (MessageChannel only).
- **Platform API**: main-process only, `src/electron-main/platform-api/`; UI reads via RPC (`user.me`, `plans.get`).
