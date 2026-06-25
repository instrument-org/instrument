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

Each renderer (`WebContentsView`) clips its own portals — a `<Dialog>` in the sidebar can't float over the main view. For app-wide modals, use the **studio overlay**: a dedicated view that floats over the whole window.

- **Open**: `rpcClient.studioOverlay.show.call({ kind, props? })` from any renderer.
- **Add a kind**: edit `src/shared/studio-overlay.ts` (`StudioOverlayKind` union, `STUDIO_OVERLAY_DISMISSIBLE`, `StudioOverlayRequestSchema`, `studioOverlayRequestToLocation`) + add `src/client/routes/studio-overlay/<kind>.tsx` rendering a `DialogContent`. Controller is data-driven; no other changes needed.
- **Close**: `rpcClient.studioOverlay.resolve.call()` (success) or `rpcClient.studioOverlay.dismiss.call()` (cancel). Have the caller react to the `show()` result — the overlay can't navigate a tab's router.
- **Example**: `kind: "new-project"` → `routes/studio-overlay/new-project.tsx`, opened via `openCreateProject()` in `src/client/lib/project-overlays.ts`.

Sidebar flyouts (dropdowns, popovers) are also clipped to the sidebar view; avoid sideways-opening submenus there.

## Where things are

- **Client app**: Renderer code under `src/client`. Routes are file-based in `src/client/routes/` (TanStack Router; layout/auth under `_app/`).
- **UI**: shadcn in `src/client/components/ui`; shared components in `src/client/components/`.
- **Debug**: Routes under `_app/debug/` and `settings/debug` are for experimentation only; not for end users.
- **RPC**: Main process handlers in `src/electron-main/rpc/routes/`; workspace at `rpcClient.workspace.*`. Client in `src/client/rpc/client.ts` talks to main over MessageChannel only (no direct remote HTTP).
- **Platform API**: Main process only, in `src/electron-main/platform-api/`. UI gets data via main-process RPC (`user.me`, `plans.get`).
