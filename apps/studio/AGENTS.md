# Studio

Electron desktop app.

## Dependencies vs devDependencies

electron-builder copies `dependencies` into the asar `node_modules`. Renderer-only packages **must** be in `devDependencies`; Vite bundles them, and putting them in `dependencies` silently adds tens of MB.

- **`dependencies`**: main-process runtime packages only (e.g. `hono`, `better-auth`, `xstate`, `ws`, native addons)
- **`devDependencies`**: everything renderer-only (e.g. React, Radix, `motion` if only used in the renderer)

## Project

Renderer: React 19, TanStack Router file routes, shadcn UI, oRPC to main process. Main process calls remote API (accounts, plans, Stripe); UI accesses it only through main-process RPC, never direct HTTP.

- React 19: use newer APIs. Desktop app: no `cursor: pointer` for links.
- Use shadcn Tailwind colors (`bg-background`), not raw colors (`bg-white`).
- `rpcClient` `.call()` throws unless wrapped with `safe` from `@orpc/client`; use `.call()` only for imperative calls outside React.
- Queries: `useQuery` and `rpcClient.method.name.queryOptions({ input: { ... } })`. To conditionally skip, pass `skipToken` as `input`: `rpcClient.foo.queryOptions({ input: value ?? skipToken })`.
- External links: `<ExternalLink href="..." />` or `rpcClient.utils.openExternalLink`.
- Use the `cn` helper from `@/client/lib/utils` for conditional or composed Tailwind classes.
- Route matching: `useMatchRoute` — never pathname strings. `Boolean(matchRoute({ to: "/route" }))`.
- Route generation: after adding, removing, or renaming files under
  `src/client/routes`, run
  `pnpm --filter @instrument-org/studio run routes:generate`. Do not hand-edit
  `src/client/routeTree.gen.ts`.
- RPC-derived types: use `RPCInput` / `RPCOutput` from `@/client/rpc/client`, e.g. `RPCOutput["workspace"]["task"]["list"]`. Never redeclare inferable types.

## App-wide modals

The whole main window is one web contents (`AppShell` / `AppChrome`), so a plain
`<Dialog>` at the chrome root floats over the sidebar _and_ content — no separate
overlay view. Two shapes:

- **App-wide (opened from scattered places)** — `login`, `welcome`, `settings`,
  the new/edit-`project` modal, and `delete-task` (opened from the sidebar, task
  page, and lists via `openDeleteTask(task, opts)`). Each is: a Jotai atom
  holding its state
  (`atoms/<name>-modal.ts`), a plain `openX()` setter that sets it (imperative,
  callable anywhere via `getDefaultStore().set(...)`), and a component in
  `components/studio-modals/<name>-modal.tsx` that reads the atom and renders its
  own `<Dialog>`. All are mounted once by `<StudioModals />` in `app-chrome.tsx`.
  They're independent atoms, so they stack like ordinary dialogs.
  - **Example**: `openCreateProject()` / `openEditProject(id)` in
    `lib/project-overlays.ts` set `projectModalAtom`; `ProjectModal` renders it.
  - **Result / callback**: pass a callback in the opener (e.g. `openLogin(props,
onCompleted)`) — `onCompleted` fires only when the flow finishes, not on
    dismiss. There's no cross-view serialization; props are passed as typed
    values (branded ids included).
  - **Dismissibility** lives in the component: a non-dismissible modal (welcome)
    omits `onOpenChange`-close and blocks Escape/outside-click itself.
  - **Native menu → modal**: `Cmd+,` publishes `app.open-settings`; the renderer
    subscribes via `useOpenSettings` (see `utils.live.openSettings`).
- **Contextual (a component owns the trigger + data)** — mount the `<Dialog>`
  inline next to the trigger with local `useState`, passing data as props. Used
  by `delete-project` (sidebar + project page). Prefer this for a small number of
  co-located triggers; go app-wide once a modal is opened from many scattered
  places or would otherwise force a navigation just to show a dialog.

**Block tab navigation while a modal is open**: call `useBlockTabNavigation(open)`
(opt-in). `useTabCommands` then ignores tab open/close/switch shortcuts (Cmd+T /
Cmd+W / etc.) while any modal is up.

## Where things are

- **Client app**: Renderer code under `src/client`. Routes are file-based in `src/client/routes/` (TanStack Router; layout/auth under `_app/`).
- **UI**: shadcn in `src/client/components/ui`; shared components in `src/client/components/`.
- **Debug**: Routes under `_app/debug/` and `settings/debug` are for experimentation only; not for end users.
- **RPC**: Main process handlers in `src/electron-main/rpc/routes/`; workspace at `rpcClient.workspace.*`. Client in `src/client/rpc/client.ts` talks to main over MessageChannel only (no direct remote HTTP).
- **Platform API**: Main process only, in `src/electron-main/platform-api/`. UI gets data via main-process RPC (`user.me`, `plans.get`).
