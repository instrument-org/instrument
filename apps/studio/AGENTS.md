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
- State a window keeps across launches is a `keptAtom` (`client/lib/kept-state.ts`), never `atomWithStorage` over `localStorage`. It names the file it lives in (`shared/kept-state.ts`): `layout` (where the person left off), `drafts`, `bookmarks`, or `view` (how they like things laid out); and a key, `<name>.v<n>`. `bookmarks` travels with the workspace in its `.instrument/`; `layout` and `view` stay on this computer, in the workspace's machine folder under `window/`. `drafts` is the exception that is not a file: its one key is kept as a folder per draft in the workspace's visible `Drafts/`, each holding a `DRAFT.md` (`stores/workspace/drafts-folder.ts`, over the format and folder in `@instrument-org/workspace/drafts`), so a draft can be found, read, edited, and deleted in a file manager, and a change made there reaches the windows. The main process owns the files (`stores/workspace/kept-state.ts`), the preload reads them all before the first render, and writes go back over IPC, debounced and atomic, flushed on quit. The version is what lets the value's meaning change later, since bumping it makes an old one ignored rather than read as something it is not. That failure is silent — a pane width stored in pixels and later read as a fraction is a pane a hundred times too small. A value whose shape needs more than a check of its kind gets a `read` that validates it.

## Windows

Two top-level windows, each its own `BrowserWindow` / web contents, both loaded from the same renderer bundle. `client/main.tsx` picks the root by `window.api.windowType` (set via the `--windowType` preload arg):

- **app** — renders `<AppWindow />`: the app window (`windows/app-window.ts`), its tabs across the bar, each a router of its own kept mounted in one web contents. This is what "single web contents" below refers to. It has its own menu (`menus/app-window.ts`) and hosts every browser guest. Its screens are the routes under the pathless `client/routes/_app/` layout, drawn from `client/components/window/`; its state is in `client/atoms/window.ts`. A chat is a record under `chats/` and runs agent `instrument`; the window's own tabs and file views are scoped to `WINDOW_ID`, not to a record.
- **onboarding** — renders `<App />`: a small (480×600), fixed-size, non-resizable "Welcome" window (`windows/onboarding.ts`) that runs the single-router onboarding flow at `/onboarding`. Shown before the app window on first run, while the app window loads off screen behind it (`warmAppWindowBehind`) and takes no asks until onboarding completes and puts it on screen; dismissing onboarding without completing quits the app.

They share kept state (e.g. `zoomAtom`): the main process sends each window's writes to the other, so anything scoped to the app window (tab commands, its chrome) must not assume it is running in the onboarding window.

Closing the last window quits the app on Windows and Linux, asking first about running work as Cmd+Q does (`lib/quit-machine.ts`). On macOS the app stays in the Dock with its work going, and the Dock icon or a notification brings a window back (`quitsWithLastWindow` in `lib/quit.ts`); see `docs/decisions/2026-10-15-stay-in-the-dock-when-the-last-window-closes.md`.

## Workspaces and stores

A process runs one workspace folder, resolved in `setup-environment.ts` before any store opens (`lib/workspaces.ts`): `INSTRUMENT_WORKSPACE` (a registered id or an absolute path) pins one for the process, otherwise `workspaces.json` at the userData root names the active one, otherwise the default, which starts at `userData/workspace`. A workspace moves only when the person picks a folder for it (Settings › Storage, the onboarding folder step, `workspaces.move`): the pick is recorded in its registry entry, the app restarts, and the next launch moves its `.instrument/` there before any store opens (`lib/workspace-move.ts`) and writes the paths it moved into the files holding them (`rewriteStoredPaths`, with the stores Studio owns supplied through `storedPathRewrites`), so a stored path says where its folder is. Before opening, the launch refuses a folder made by a newer build or one it cannot read (`lib/workspace-refusal.ts`), and shows a window of its own instead of the app (`lib/workspace-refusal-window.ts`): no store opens. A workspace in the app's own data is where the 1.x and beta layout sweeps run; one in a picked folder never runs them, and its top level is the person's and the output folder (`outputDir`). Switching from the dev panel restarts the app; under `pnpm dev` that goes through `scripts/dev-supervisor.ts`, which starts electron-vite again on exit code 75.

Every electron-store lives in `src/electron-main/stores/workspace/` or `stores/machine/`, and its getter is named for that scope (`getWorkspacePreferences()`, `getMachineState()`). A new store picks its scope by asking whether a second workspace on the same computer should see the same value: sign-ins, keys, flags, preferences, and window state are the workspace's; the update channel and caches of the computer are the machine's. In each half, _preferences_ are what a person chose and _state_ is what the app remembers. Machine stores keep the userData root (`machineDir()`).

A workspace's own data splits in two (`lib/get-workspace-folder.ts`). What follows the person travels in the workspace, `<workspace>/.instrument/` (`workspaceDataDir()`): `workspace.json` (its id, name, color, format and migration versions), `preferences.json` (the feature flags among them), `bookmarks.json`, and the app's folders `workspaceLayout` names (chats, apps; `drafts`, `memory`, `skills` and `topics` are only where earlier builds kept them, for the migrations). What is secret, means something only on this computer, or is rebuilt here lives in its machine folder, `<userData>/workspaces-data/<local id>/` (`workspaceMachineDir()`, entries named in `WORKSPACE_MACHINE_ENTRIES`): `keys/` (provider keys, the account sign-in, ChatGPT accounts, app credentials and connections), `browser/` (both Chromium profiles, history, page pictures, the download list), `window/` (size and place, `layout`, `view`), `state.json`, `permissions.json`, `workspace.db` (the index of its chats and the activity log), `app-servers/`, and `work/<chat id>/`, each chat's work folder (its records stay in the workspace's `.instrument/chats/<id>/`). A store opens through `cwd:` one of those helpers; when picking, ask whether the value would still mean the same thing on another computer with the workspace copied there. The folder is named by the short local id the registry (`workspaces.json`) gives the workspace on this computer (`default` for the first), which keeps a Chromium profile's deepest paths under Windows' 260 characters. The workspace's own id is a ULID in its `workspace.json`, the same on every computer, minted the first time a build opens it and recorded in the registry entry beside the local id; a copy of a workspace folder gets one of its own (`settleWorkspace`). A settings change that needs migrating goes in `lib/settings-migration.ts` behind the workspace's `settingsVersion`; moving data between the two halves goes in `lib/machine-data-migration.ts` behind its `formatVersion`. Both run only for the workspace being opened, in that order. The workspace package's layout sweep (`migrateWorkspaceLayout`, run by `create-workspace-actor.ts` behind `layoutVersion`) runs after them: it moves the app's folders an earlier build kept at the workspace's top level into `.instrument/` and chats' work into the machine folder, since the 1.x migration it also runs makes chats in the old shape.

The app and onboarding windows run on the workspace's own Chromium session (`lib/app-session.ts`, `browser/app-session` in its machine folder), and the in-app browser on `browser-session` beside it, so localStorage, cookies, and history never cross workspaces. Anything a session must have (protocol handlers, the user agent, the permission policy) goes in `configureAppSession`, not on `session.defaultSession`.

`ELECTRON_USER_DATA_DIR` still swaps the whole userData, for first-install behavior, the packaged smoke test, and seeded fixtures: `ELECTRON_USER_DATA_DIR=<empty dir> pnpm dev` is a first launch on a fresh machine.

## App-wide modals

The app window is a single web contents (see Windows), so modals are plain `<Dialog>`s at the window root, not separate overlay views.

- **App-wide** (`login`, `settings`, `shortcut-guide`): a Jotai atom (`atoms/<name>-modal.ts`, created via `studioModalAtom()` from `atoms/studio-modal.ts`) + `openX()` setter callable from anywhere + a component in `components/studio-modals/<name>-modal.tsx`, all mounted once via `<StudioModals />` in `window/window-frame.tsx`. At most one app-wide modal is open at a time: opening one replaces whichever is open (never stacks) — e.g. sign-in triggered from inside settings closes settings. A modal created with `replaceable: false` holds the slot until it closes itself; opening another over it is ignored.
- **Contextual** (`delete-chat`): `<Dialog>` inline next to its trigger with local `useState`. Use for a small number of co-located triggers.
- `DialogContent` and `AlertDialogContent` hold the tab chords automatically while their dialog is open in the active tab. Cmd+W asks only the innermost overlay to dismiss, honoring its `onEscapeKeyDown` prevention; a blocked dismissal keeps the overlay and tab in place. Cmd+T dismisses the overlays before opening a new app tab and stops if any dismissal is blocked. Custom overlays, such as an expanded draft or chat, register with `useHoldWindow(open, { onClose })`. Back behavior is separate: dialogs register with `useModalBack` when appropriate, and custom holds register Back by default.

## Copy

Quote a name the user chose — a folder, project, skill, or their own search text — in curly quotes: `Remove “${name}”?`. Straight quotes are syntax: SQL identifiers, CSS selectors, `throw`s, prompt text for the model.

A word or key that belongs to one OS (Finder, File Explorer, Recycle Bin, System Settings, This Mac, ⌘) is read from `shared/os-conventions.ts` for the system the app runs on, and added there when it is new. `studio/no-os-words` fails on one written anywhere else; text only ever shown on one system keeps it under `// oxlint-disable-next-line studio/no-os-words -- <where it shows>`.

## UI zoom

The whole window scales with CSS `zoom` on `ZoomRoot` (`zoomAtom`, user-adjustable 0.5x–2x). `zoom` compounds down the tree and floating-ui doesn't yet correct for an ancestor's zoom, so anything positioned, sized, or measured against the viewport needs care when zoom ≠ 1 — and it's silently fine at the 1x default, so check other levels. `docs/architecture/responsive-layout.md` and `use-app-zoom.ts` carry the full rationale and the per-unit rules; what you need before reading them:

- Size a dialog with `DialogContent`'s `maxWidth`/`maxHeight` props (intrinsic sizes, e.g. `maxWidth="42rem"`), never a `max-w-*`/`max-h-*` class: `cn()` merges the class over the primitive's own and takes the window cap away with it. Same for `TooltipContent`'s `maxWidth` and `PopoverContent`'s `maxHeight` — a popover given no `maxHeight` takes the room Radix measured for it, so tall content wants a scroll rather than a taller panel.
- Floating content stays clear of the toolbar band, which on macOS is where the traffic lights are drawn over the web contents: `ChromeInsetProvider` (mounted by the app window's frame, `window/window-frame.tsx`) declares its depth and `useChromeCollisionPadding` is the default `collisionPadding` on every Radix content primitive. It reaches menus that set `avoidCollisions={false}` too, since Radix hands the padding to the `size` middleware either way. Zero where no window declares a band, and inert for a `Select` left on `position="item-aligned"`.
- Reuse `useAppZoomStyle` + `zoomMaxSize` on any new floating/portalled UI, or `use-portal-container.tsx` when portalling into the zoomed tree, instead of hand-rolling zoom math. A full-window overlay wants `fixed inset-0` and no viewport units at all (`file-preview-modal.tsx`).
- Anything placed where the pointer is — a menu on right click, a flyout beside a measured rect — takes its `left`/`top` from `useWindowPointStyle`. `event.clientX`/`clientY` and every `getBoundingClientRect()` edge are on-screen px, and a length inside the zoom root is layout px, so the raw value lands at `zoom ×` the point it was read from.
- A virtualizer inside self-zoomed content must measure in layout px: pass `measureElement: (el) => el.offsetHeight` and an `observeElementRect` reading `offsetWidth`/`offsetHeight`. The defaults read `getBoundingClientRect`, which is on-screen px.
- Never add a `container-type` above a portal target. floating-ui counts it as a containing block for fixed content and Chrome doesn't, so every menu/popover silently shifts by that element's offset. `@container/app-content` sits below the portal target for exactly this reason.
- Routes lay out against that `@container/app-content` container (`AppTabView` puts it around them), never viewport media queries.
- Every window (see Windows) uses the same `ZoomRoot` + `zoomAtom`, wired via `OnboardingZoomRoot`, which also mounts `ZoomToast` (a transient corner readout on any zoom change) outside `ZoomRoot`. Each root also calls `useSyncZoom`, which is what re-centers a window's macOS traffic lights: they are real pixels drawn over a band of chrome whose height is the zoom the renderer draws it at (`windows/traffic-lights.ts`).

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

- **Client**: `src/client`, file routes in `src/client/routes/` (`_app/` = the app window's pathless layout, `onboarding/` = the onboarding window's).
- **UI**: shadcn in `src/client/components/ui`; shared in `src/client/components/`.
- **Debug**: `routes/debug/` and the settings modal's Debug tab (`components/settings/debug-section.tsx`) — experimentation only.
- **RPC**: main handlers in `src/electron-main/rpc/routes/`; client in `src/client/rpc/client.ts` (MessageChannel only).
- **Platform API**: main-process only, `src/electron-main/platform-api/`; UI reads via RPC (`user.live.me`, `plans.get`).
