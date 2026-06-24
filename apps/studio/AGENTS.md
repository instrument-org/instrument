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

## App-wide modals (studio overlay)

The window is composed of **multiple independent `WebContentsView`s** — the
sidebar is its own view, and each task tab is its own view. A React/Radix dialog
mounted in one renderer (e.g. the sidebar) **cannot** be opened from another
renderer, and its portal is **clipped to that view's bounds** (it can't float
over the rest of the app). So "render a `<Dialog>` somewhere in the tree" is the
wrong tool for any modal that must appear app-wide or be triggered from more
than one surface.

For those, use the **studio overlay**: a dedicated overlay `WebContentsView`
that floats over the whole window, driven from the main process.

- Open from any renderer: `rpcClient.studioOverlay.show.call({ kind, props? })`.
- Add a kind by editing `src/shared/studio-overlay.ts` (the `StudioOverlayKind`
  union, `STUDIO_OVERLAY_DISMISSIBLE`, `StudioOverlayRequestSchema`, and
  `studioOverlayRequestToLocation`) and adding a child route under
  `src/client/routes/studio-overlay/<kind>.tsx` that renders a `DialogContent`.
  The controller (`src/electron-main/tabs/studio-overlay.ts`) is data-driven, so
  this is additive.
- Inside the overlay route, finish with `rpcClient.studioOverlay.resolve.call()`
  (success) or `rpcClient.studioOverlay.dismiss.call()` (cancel). The overlay is
  a separate view, so it can't navigate a tab's router; have the _caller_ react
  to the resolved `show()` result instead.
- Example: the New Project modal is `kind: "new-project"`
  (`routes/studio-overlay/new-project.tsx`), opened via
  `openCreateProject()` in `src/client/lib/open-create-project.ts`.

Corollary: a Radix **flyout** (dropdown submenu, popover) triggered from the
sidebar is also clipped to the sidebar view. Avoid sideways-opening submenus
there until the sidebar is unified with the main view.

## Where things are

- **Client app**: Renderer code under `src/client`. Routes are file-based in `src/client/routes/` (TanStack Router; layout/auth under `_app/`).
- **UI**: shadcn in `src/client/components/ui`; shared components in `src/client/components/`.
- **Debug**: Routes under `_app/debug/` and `settings/debug` are for experimentation only; not for end users.
- **RPC**: Main process handlers in `src/electron-main/rpc/routes/`; workspace at `rpcClient.workspace.*`. Client in `src/client/rpc/client.ts` talks to main over MessageChannel only (no direct remote HTTP).
- **Platform API**: Main process only, in `src/electron-main/platform-api/`. UI gets data via main-process RPC (`user.me`, `plans.get`).
