# In-page tabs (single web contents)

The flicker-free approach. Supersedes the per-tab-`WebContentsView` spikes
(`unified-base-view`, `per-tab-shell`), which flickered because a `WebContentsView`
only paints when it's composited on screen, so every tab reveal flashed.

## Model

The main window's own web contents renders the **entire** tabbed app
(`AppShell`). Every open tab is a kept-mounted React subtree:

- Each tab gets its own TanStack Router with `createMemoryHistory` -> independent
  back/forward stack (the thing we most wanted to preserve).
- Each tab is wrapped in React `<Activity mode="hidden">` -> stays mounted while
  inactive, so scroll/selection/state survive, and switching is a DOM show/hide,
  not a compositor reveal. No flicker.
- The per-tab router renders `_app`, which renders that tab's full shell (toolbar +
  tab bar + sidebar + content). Tab bar/sidebar are duplicated per tab but read the
  one shared `tabsAtom` (all tabs share this JS context), so they stay consistent.

Tradeoff accepted: one renderer process for all tabs (no per-tab crash/jank
isolation). Agent browser views remain separate `WebContentsView`s.

## Renderer

- `atoms/tabs.ts` + `lib/tab-model.ts` (+tests): renderer-owned tab state.
- `hooks/use-tabs-controller.ts`: actions over the atom.
- `lib/tab-router.ts`: per-tab memory-history router factory + shared QueryClient.
- `components/app-shell.tsx`: stacks one `TabView` (Activity + RouterProvider) per
  tab; syncs each router's location back to the atom.
- `components/tab-context.tsx` + `hooks/use-tab-meta.ts`: per-tab id + route-set
  icon/title.
- tab bar / `use-tabs` / `use-selected-tab(-id)` / `use-tab-actions` read the atom;
  `nav-controls` uses the local tab router; sidebar highlights its local route.
- `routes/_app/route.tsx`: renders the full shell.
- `main.tsx`: main window (`windowType === "shell"`) renders `AppShell`; the
  studio-overlay and onboarding web contents keep the single-router `App`.

## Main process

`TabsManager` is slimmed to what's still main-side: the studio overlay, page-zoom
of the window web contents (Cmd +/- now scales the whole app), and keeping agent
browser views composited (parked offscreen). All per-tab `WebContentsView`
machinery (content views, shield, bounds math, sidebar-width plumbing) is gone. The
tab-shaped methods are no-op stubs so menu/RPC call sites still compile.

## Deferred (don't block first boot) -- flagged

- **Keyboard/menu tab commands** (Cmd+T/W, Ctrl+Tab) and **overlay-initiated tab
  opens** (welcome -> tutorial, create-project -> open) are no-ops until a
  main->renderer tab-command IPC lands. Use the in-app tab bar (mouse) meanwhile.
- **Agent browser view display**: parked offscreen; CDP capture/input may be
  degraded until the in-tab viewport (S3). Agent logic still runs.
- **Tab persistence across restart** (renderer atom is in-memory for now).
- **N HeadContent / telemetry pageview** per-tab routers writing one document head
  (minor; revisit).

## Verify (`pnpm dev:studio`)

The whole point: open/close/switch tabs via the in-app tab bar and confirm there is
no flicker and that scroll/selection survive switching. Also: Cmd +/- scales the
whole window; settings/login overlay still opens.
