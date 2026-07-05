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

## App-wide modals

`AppShell`/`AppChrome` is a single web contents, so modals are plain `<Dialog>`s at the chrome root, not separate overlay views.

- **App-wide** (`login`, `welcome`, `settings`, `project`, `delete-task`): a Jotai atom (`atoms/<name>-modal.ts`, created via `studioModalAtom()` from `atoms/studio-modal.ts`) + `openX()` setter callable from anywhere + a component in `components/studio-modals/<name>-modal.tsx`, all mounted once via `<StudioModals />` in `app-chrome.tsx`. At most one app-wide modal is open at a time: opening one replaces whichever is open (never stacks) — e.g. sign-in triggered from inside settings closes settings.
- **Contextual** (`delete-project`): `<Dialog>` inline next to its trigger with local `useState`. Use for a small number of co-located triggers.
- `useBlockTabNavigation(open)` opts a modal out of tab shortcuts (Cmd+T/W/etc.) while open.

## Where things are

- **Client**: `src/client`, file routes in `src/client/routes/` (`_app/` = layout/auth).
- **UI**: shadcn in `src/client/components/ui`; shared in `src/client/components/`.
- **Debug**: `_app/debug/` and `settings/debug` — experimentation only.
- **RPC**: main handlers in `src/electron-main/rpc/routes/`; client in `src/client/rpc/client.ts` (MessageChannel only).
- **Platform API**: main-process only, `src/electron-main/platform-api/`; UI reads via RPC (`user.me`, `plans.get`).
