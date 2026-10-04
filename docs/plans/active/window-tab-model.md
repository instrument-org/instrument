# One navigation model per window tab

Status: in progress.

The app window keeps two persisted tab models and walks history through five or six layers. `appTabsAtom` gives each tab across the bar a TanStack memory router; `windowTabsAtom` keeps every chat's, draft's and site's tabs, plus a stored `group` that an effect in `app-window.tsx` forces to follow the tab up's address, an `activeId` that duplicates `activeByGroup[group]`, and a `previousGroup` nobody reads. Four modules write it directly (`window-tabs.ts`, `browser-tabs.tsx` with a dozen inline reducers, `app-window.tsx`, `routes/_app/route.tsx`). Back and forward are decided in about seven places (`GroupItem`, `browser-tabs.tsx`, `hosted-page.ts`, `browser-pool.ts`, the window's commands, `nav-controls.tsx`, `files-screen.tsx`), plus the guest's context menu and the task panel's arrows, which step the guest's history raw. `GroupItem` re-parses addresses into screens (`groupScreenOf`) and hands the screens a second way to move (`ScreenTabContext`). The fix chain behind this is about seventy commits (2a236502a, f566ebb22, 8b218276b, 4e55e6a9c, 846730374, 0df1558b5, and the blank-restore series a8f95c4f1, db02752f2, 5e4fe9522, 1a8da74de, 0c74469a0).

## Shape

- **One tab model.** `windowTabsAtom` holds `{ activeByGroup, tabs }` and nothing else. The group on screen is a selector over the tab up's address (`groupOfHref`), never stored. Every write goes through pure reducers in `tab-model.ts`, tested with `it.each`; components call them through `useWindowTabs`.
- **One step rule.** `stepOf(stack, direction)` decides, for a tab, whether a step walks the guest's history, the tab's own history, the visits across the page/screen boundary, the outer window tab, or closes a tab something else opened. One dispatcher applies it, and every arrow, chord, thumb button, the guest's context menu and the task panel's arrows go through it.
- **Screens in a group tab are routes.** A group tab that shows a screen gets a memory router from the same route tree the window's tabs use, so the Finder, the tasks, the apps and the web's start are the same route components in either place. `GroupItem`'s switch, `ScreenTabContext`, the `trail`/`at` fields and `groupScreenOf` go.
- **Per-tab slots.** What a screen shows, the page slot and the hosted page slots are kept by tab id and written unconditionally; readers pick the tab up. Nothing is gated on `useIsActiveTab` to decide whether to write.
- **Placement is a function.** `placementOf(request, context)` decides where an open lands; `useOpeners` applies the answer.
- **Draft words have one owner.**
- **Guests restore themselves.** The workspace remembers each window page's last committed address, and `browser.open` with no address puts a recreated guest back there, so the renderer has one way to bring a page back.

## Steps

Each step is one green commit (or a short series), with `check:types` and the touched suites passing.

1. **Tab model.** Move every `windowTabsAtom` write into `tab-model.ts` reducers; derive the group on screen; delete `group`, `activeId`, `previousGroup`, the sync effect, `leaveGroup`/`showGroup`/`showChat`, and the never-read `pageBackSteps`. Closing a group's up tab picks its neighbor in every group, not only the one on screen. Checks: reducer table tests; existing window-tabs tests ported.
2. **Move `GroupItem`** out of `compose-window.tsx` into `group-item.tsx`, unchanged.
3. **Step rule and dispatcher.** `stepOf` with a table test; `NavControls`, the window's back/forward commands, `onPageThumb` handlers, `GroupItem`'s row, `hosted-page.ts`, `files-screen.tsx`, the guest context menu (main asks the window to step instead of stepping the guest) and the task panel's arrows all call it. `tabStepsAtom` goes.
4. **Per-tab slots.** `screenViewAtom` becomes keyed by tab id, `reportPageSlot` likewise; `pageSlotsAtom` entries carry whether they are shown.
5. **`placementOf`** extracted from `use-openers.ts`, with a table test.
6. **Draft words.** One owner for a draft's text.
7. **Group tab routers.** A group tab's screen history becomes a `TabHistory` its own router walks; `GroupItem` renders a `RouterProvider`; the screens lose their `screenTab` branches.
8. **Guest restore.** Record a window page's committed address in the workspace; replace `bootTabIds`/`restoreOnce`/the orphan timer, `SiteView`'s re-open and `ComposePagePanel`'s re-open with one `browser.open` on show.
9. **Docs.** `system-overview.md`, `in-app-browser.md`; this plan to `completed/`.

App checks after steps 1, 3, 7 and 8, on a fixture workspace (`studio-drive boot --workspace documents`): open tabs in a chat's pane and as window tabs, back and forward across a page and a screen, reload and see tabs come back where they were, close tabs, and the screen sweep for console errors.

## Out of scope

- `appTabsAtom` and its model (`lib/tabs-model.ts`): already one router per tab, and the pattern the rest follows.
- The rename of `file-system.tsx`'s views; splitting it is a separate, optional step if time allows.
- The workspace's records and RPC beyond the one browser-state write in step 8, which another change is reworking.
- Any visible change to what a tab, an arrow or a chord does. Where a step would need one, it stops and asks.
