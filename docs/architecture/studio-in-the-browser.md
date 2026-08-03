# Studio in the browser

`apps/studio/web/` serves Studio's **real renderer** as an ordinary web page, with the Electron boundary replaced by fixtures. Run it with `pnpm --filter @instrument-org/studio dev:web` (port 5180).

It exists so the UI can be opened, reviewed, and driven without booting Electron: design capture with browser extensions, screenshotting a screen, and exercising full screens in a real browser rather than a component harness. It is a **development surface only** and is never packaged or shipped.

## What it is not

It is **not** a step toward running Studio headless in the cloud, and it should not be used to argue that one is close. The renderer was never the hard part. Everything server-side (the agent, the workspace, the main process) is stubbed out here rather than solved, so this proves the renderer is portable and nothing more.

## Why one seam is enough

The renderer talks to exactly one thing: an oRPC client over a `MessageChannel` opened in [`client/rpc/client.ts`](../../apps/studio/src/client/rpc/client.ts). The workspace server is mounted *inside* that same router (`workspace: workspaceRouter`), so there is no second client to intercept. Beyond it the renderer touches only three `window.api` methods and `window.electron.process.platform`.

So the browser build replaces that one module by Vite alias and stubs the `window` surface. It does not fork, copy, or branch the renderer: `@/` resolves to `apps/studio/src`, and the components are the same files Electron runs.

| Piece | Role |
|---|---|
| `web/vite.config.ts` | Aliases `@/` to the renderer, overrides the RPC client, shims `node:crypto` |
| `web/src/mock-rpc.ts` | One callable Proxy standing in for every procedure, plus the live-stream machinery |
| `web/src/fixtures.ts` | Canned responses (`FIXTURES`) and writes (`MUTATIONS`) |
| `web/src/install-stubs.ts` | `window.api` and `window.electron` |
| `web/src/keymap.ts` | Stands in for the native menu (see below) |

## Adding a fixture

Never read the routers to guess what a screen needs. Open it and let the harness tell you: procedures without a fixture log a warning and `window.__rpcCalls.report()` lists every procedure called and which lack fixtures. `window.__rpcCalls.subscribers()` shows open live streams.

Pin shapes to the contracts rather than hand-rolling them, so a fixture that drifts fails loudly: `satisfies Project[]`, `TaskIdSchema.parse(...)`, `AIGatewayModel.Schema.parse(...)`.

## Three behaviors that will bite you

**Live procedures are event iterators, and the query only settles when the stream ends.** `experimental_liveQuery` calls `setQueryData` per chunk but resolves its promise only on completion, so a stream held open shows data while the query stays pending, which downstream reads as `isLoading`. Fixture streams therefore yield once and complete. Only paths in `OPEN_STREAM_PATHS` stay subscribed, because something actively pushes to them.

**A stream that ends without yielding throws.** `experimental_liveQuery` raises "did not yield any data" rather than returning nothing, which would turn every live procedure without a fixture into a crash. Live streams with no fixture yield `null` once so the screen renders its empty state instead.

**Writes must hand out a fresh object.** The UI never trusts a mutation's return value; it writes and then reads the change back off a live stream. If a fixture hands out the same mutable object the setter mutates, structural sharing sees no change and nothing re-renders. `MUTATIONS` entries return `[path, value]` pairs with a copied value.

## Keyboard shortcuts

Every app-wide shortcut in Studio is a **native menu accelerator**: the main process turns it into an `AppCommand` and publishes it on `appCommands.live.commands` ([`shared/app-command.ts`](../../apps/studio/src/shared/app-command.ts)). A browser has no menu, so `web/src/keymap.ts` listens for the same chords and pushes the same commands. Combinations the browser reserves (Cmd+T, Cmd+W, Cmd+N) cannot be intercepted from a page, so tab lifecycle stays mouse-driven.

## Known gaps

- **The task detail pane is empty.** It renders and does not crash, but the session transcript, files, and output artifacts have no fixtures. The debug Chat stream page covers the same components with better-maintained sample data, so a transcript fixture here would be duplicated surface that rots.
- **The model picker is disabled**, so prompts cannot be submitted. `gateway.models.live.list` never has its query function invoked, while structurally identical live queries succeed; the query sits pending in the router-scoped cache. Note there are two `QueryClient`s ([`router.tsx`](../../apps/studio/src/client/router.tsx) and `sharedQueryClient` in [`lib/tab-router.ts`](../../apps/studio/src/client/lib/tab-router.ts)), which is where to start.
- **The browser panel is a hole**, since a `<webview>` cannot exist here.
- **The URL does not drive tab content.** Each tab owns its router history, so deep-linking a screen does not work; navigate with Cmd+K.
- **Window chrome differs**: no drag regions, no native frame.
