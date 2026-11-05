# Moving tabs between windows, before merging

Reviewed: `b4f59f275..19da6c4f5`

Asked for ahead of merging the multiple windows work: the difficult bugs, and the refactors worth doing first. Two blind readers took `b4f59f275..6689ff9b5`, one for defects and one for structure, reading the tab carry in main, the renderer's half of the drag, the browser view manager, kept state and the menus. Findings A to L are theirs, each read again at that head and A reproduced by real pointer on a macOS VM. The refactors that followed (`703c9247a`, `19da6c4f5`) went to a third blind reader, who traced the new code against the old with nothing booted; M to V are that reader's, each read again against the code, with M reproduced by real pointer.

## Findings

### A. A used page next door reloads after a drag is called off

- Status: fixed `c441fe359`
- Where: `backToRow` in [tab-carry.ts](/apps/studio/src/electron-main/windows/tab-carry.ts)
- What: the page beside the held tab was handed to the spare as the tab left its row and handed back on Escape, each way a reload, so a page with typed words lost them for a drag that came to nothing.
- Verification: on the macOS VM the marker and the typed words were gone after a drag and Escape on the build before the fix, and kept on the build after it.

### B. A full-screen window on another Space, or one not in sight, could take a held tab

- Status: fixed `c441fe359`
- Where: `windowsToLandOn` in [tab-carry.ts](/apps/studio/src/electron-main/windows/tab-carry.ts)
- What: every window counted as a place to land, so its bounds made the top of the screen a strip.

### C. Raster budget was one value shared by every window

- Status: fixed `c441fe359`
- Where: [guest-surface.ts](/apps/studio/src/electron-main/browser-view/guest-surface.ts)
- What: the last window to report its size set the budget for pages in all of them.

### D. Landing could close a window an agent's page was in

- Status: fixed `c441fe359`
- Where: `isUsed` in [manager.ts](/apps/studio/src/electron-main/browser-view/manager.ts)
- What: only a person's input counted as using a page, so a page an agent had driven counted as having nothing to lose.
- Note: agent use lasts until the page is handed over, so a window hosting one tears by rebuilding a tab that has no page of its own. That is the rule working: the rebuilt tab loses less than the page would.

### E. A quick flick on Linux left the spare unshown

- Status: fixed `c441fe359`
- Where: `leaveOthersBehind` in [tab-carry.ts](/apps/studio/src/electron-main/windows/tab-carry.ts)
- What: let go before main first read the pointer, nothing had shown the window holding the tabs left behind.

### F. A spare's reset went unheard while it was booting

- Status: fixed `c441fe359`
- Where: `takePendingAppWindowAsks` in [app-window.ts](/apps/studio/src/electron-main/windows/app-window.ts)
- What: what a returned spare was told before its page listened was missed, so its next use opened on stale tabs.

### G. Closing a tab while it was held left an empty window

- Status: fixed `c441fe359`
- Where: `keepOnlyTab` in [move-tab.ts](/apps/studio/src/client/components/window/move-tab.ts)
- What: the window kept the tab it no longer had. It opens on the inbox now.

### H. A release over a PDF card's iframe went unheard

- Status: fixed `c441fe359`
- Where: [globals.css](/apps/studio/src/client/styles/globals.css)
- What: pages stepped out of the pointer's way for the drag and an iframe did not, so it took the release as a page would.

### I. A tab opened during a drag was lost on Escape

- Status: fixed `c441fe359`
- Where: `reorderTabs` in [tabs-model.ts](/apps/studio/src/client/lib/tabs-model.ts)
- What: Escape put back the order from the press, which dropped any tab not listed in it.
- Note: `isOnlyTab` is still read at the press, so an only tab with another opened beside it during the drag loses that one if the window takes a strip or closes. Left as rare.

### J. Merge All Windows dropped floats

- Status: fixed `703c9247a`
- Where: `mergeAllWindows` in [app-window.ts](/apps/studio/src/electron-main/windows/app-window.ts)
- What: the renderer asked for each move, so what only main reads never came across. Merge moved to main.

### K. Forgetting a window's state could throw in its closed handler

- Status: fixed `c441fe359`
- Where: `forgetWindowKeptState` in [kept-state.ts](/apps/studio/src/electron-main/stores/workspace/kept-state.ts)
- What: an `rmSync` that failed took the rest of the handler with it.

### L. An idle restart gives every window the front window's state

- Status: open
- Where: [on-screen.ts](/apps/studio/src/electron-main/windows/on-screen.ts)
- What: `comeBackAsLeft` records one view, so a minimized front window brings every window back minimized.

### M. A fast release before Motion's first frame leaves the carry running

- Status: open
- Where: [use-tab-carry.ts:115](/apps/studio/src/client/components/window/use-tab-carry.ts#L115)
- What: Motion reports a drag's start on its next frame even when the release has already happened, so a press, a small move and a release during a busy moment left the release listener added too late. The spare came up, the next click was swallowed, and a window's only tab followed the pointer with no button down until that click.
- Verification: on the macOS VM, a tab flicked while its renderer was held busy stayed held after the release on the build before the fix, and not on the build after it. A window's only tab did not reproduce on either.
- Note: found in the change that moved the release to the pointer's own event. The last movement before a release was lost the same way, and a second finger lifting ended the drag.

### N. A page the spare asks for and is refused is never asked for again

- Status: open
- Where: [manager.ts:872](/apps/studio/src/electron-main/browser-view/manager.ts#L872), [browser-panel.tsx:355](/apps/studio/src/client/components/window/browser-panel.tsx#L355)
- What: only the pages of the neighbor at the press are handed over. Drag a tab past that neighbor, or have a float with a page, and the window left behind shows "Opening browser…" on a page it never gets, until the person switches away and back.
- Verification: traced, on the build before the fix. A first attempt by real pointer took the path where the tab goes to the spare and the pressed window stays, so it could not show this. On the fixed build a used page's tab dragged past its neighbor and out left a window that loaded the page of the tab it brought up, which was not the neighbor at the press.

### O. Merge could close a window before its pages had moved

- Status: open
- Where: [app-window.ts:535](/apps/studio/src/electron-main/windows/app-window.ts#L535), `handOffGuestsOf` in [manager.ts](/apps/studio/src/electron-main/browser-view/manager.ts)
- What: a hand-off first waits up to 80ms for the page to say where it is scrolled, and the window closing ends it, so a page lost its back and forward history, and an agent's page with no tab was gone.

### P. The spare could become the window new pages go to

- Status: open
- Where: [app-window.ts:858](/apps/studio/src/electron-main/windows/app-window.ts#L858), `bindHost` in [manager.ts](/apps/studio/src/electron-main/browser-view/manager.ts)
- What: `isSpare` read a list the spare joins only after it is bound, so a hidden spare was the front host until a window next took focus, and an agent's blank page or a page whose window closed mounted out of sight.

### Q. A spare crashing under the drag threw in the poll timer

- Status: open
- Where: `backToRow` in [tab-carry.ts:597](/apps/studio/src/electron-main/windows/tab-carry.ts#L597)
- What: `setOpacity` on a destroyed window threw before the window was told its tab was back.

### R. Straight from one strip to another, a tab landed at the far end

- Status: open
- Where: [tab-carry-view.ts:80](/apps/studio/src/client/components/window/tab-carry-view.ts#L80), `updateCarry` in [tab-carry.ts](/apps/studio/src/electron-main/windows/tab-carry.ts)
- What: the carried window says where the tab stands only when that changes, and the new phase started with no place, so strips that touch could land it away from where it was drawn.

### S. An instance kept off screen could never dock

- Status: open
- Where: [tab-carry.ts:496](/apps/studio/src/electron-main/windows/tab-carry.ts#L496)
- What: its windows are never visible, so a drag driven over CDP always came out as a new window.

### T. Merge left every window gone when they were all minimized

- Status: open
- Where: `mergeAllWindows` in [app-window.ts](/apps/studio/src/electron-main/windows/app-window.ts)
- What: the window kept stayed minimized and nothing was left on screen.

### U. Merge past a hundred tabs lost the oldest

- Status: open
- Where: [publisher.ts:157](/apps/studio/src/electron-main/rpc/publisher.ts#L157)
- What: each tab was a command in one burst, and a subscription keeps the last hundred.

### V. A window gone while a landing waits to see it drawn left the carried window open

- Status: open
- Where: `drawn` in [tab-carry.ts:401](/apps/studio/src/electron-main/windows/tab-carry.ts#L401)
- What: asking a destroyed window for its web contents threw, so the steps after it never ran. Found while verifying Q.

## Not covered

Windows, on which none of this has run. The second reader traced the code and booted nothing.
