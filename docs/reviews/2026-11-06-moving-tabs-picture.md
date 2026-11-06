# Moving tabs after the picture on the pointer, and what one window became many in

Reviewed: `b4f59f275..08bc441d7`, rebased on `32f462569`

Asked for once the drag felt right: whether it is safe to merge, above all in the paths a person trying it does not exercise, such as embedded tabs, browser history, and reopening what was closed. Two readers took the range blind, one on the drag and one tracing those paths through to code the branch never touched. Each finding was checked against the code before anything was changed. The real-pointer checks below ran on a macOS VM and on a true X11 session.

## Findings

### A. A hosted page's tab closes for every window when one window's surface goes

- Status: fixed
- Where: `useHostedPage` in [hosted-page.ts](/apps/studio/src/client/components/window/hosted-page.ts), `fileOfTabGroup` in [kept-state.ts](/apps/studio/src/shared/kept-state.ts)
- What: an HTML file's page, and the page under Quick Look, is a page tab in a group the surface closes as it goes. Those groups were in the file every window shares, so a spare that had been given a tab and given it back, or a window that let a tab go, closed the page out from under the window showing it, and the viewer stayed blank until the file changed.
- Fix: a hosted page's tab is kept in the `window` file of the window drawing it, and each window draws its own.

### B. A tab's hosted page did not count as used

- Status: fixed
- Where: `tabStanding` in [move-tab.ts](/apps/studio/src/client/components/window/move-tab.ts)
- What: words typed into a form in an HTML file's page never kept the window with the tab, so a pull reloaded the page and lost them.

### C. A page brought to another window is recorded as a visit

- Status: fixed
- Where: `moveTarget` in [manager.ts](/apps/studio/src/electron-main/browser-view/manager.ts)
- What: a move reloads the page in a fresh guest, which the history recorder took for a person's visit, and an agent's page no one had seen went on the person's history for it.

### D. A page handed over and not shown stops sleeping

- Status: fixed
- Where: `moveTarget`, `reportShown` in [browser-pool.ts](/apps/studio/src/client/lib/browser-pool.ts)
- What: main counted a moved page as shown and the new pool never said otherwise, and the machine that puts hidden pages to sleep had been told it was gone. It never slept, and another window showing the tab said it was open elsewhere.

### E. A spare adopted before its page listens opens on the inbox

- Status: fixed
- Where: `takePendingAppWindowAsks` in [app-window.ts](/apps/studio/src/electron-main/windows/app-window.ts)
- What: what a drag told a spare still booting went unheard, and the one re-telling stopped applying once the spare was adopted. A second tab pulled soon after the first could lose its tab.
- Not verified by a run: the gap was not measured.

### F. A landing closes a window with its pages in it

- Status: fixed
- Where: `closeInto` in [tab-carry.ts](/apps/studio/src/electron-main/windows/tab-carry.ts)
- What: Merge All Windows handed a closing window's pages over, and a landing did not, so an agent's page went mid-run and page tabs lost their history.

### G. A strip the pointer left just before the release keeps showing the tab

- Status: fixed
- Where: `endTabCarry` in [tab-carry.ts](/apps/studio/src/electron-main/windows/tab-carry.ts)

### H. A release that throws leaves the picture up

- Status: fixed
- Where: `endTabCarry`

### I. The window left behind brought up the wrong tab

- Status: fixed
- Where: `dressSpare` in [tab-carry.ts](/apps/studio/src/electron-main/windows/tab-carry.ts), `showWhereItIs` in [use-tab-carry.ts](/apps/studio/src/client/components/window/use-tab-carry.ts)
- What: it took the neighbor of the tab that went whether or not that tab was up, and the renderer named a neighbor from the order at the press.

### J. In another window's strip a tab was placed by the pointer

- Status: fixed
- Where: `measureCarryIndex` in [tab-carry-view.ts](/apps/studio/src/client/components/window/tab-carry-view.ts)
- What: the tab is drawn from its left edge and was placed from the pointer, so the gap opened as much as a slot from where it was drawn.

### K. A lone tab in a full-screen window could leave for another Space

- Status: fixed
- Where: `beginCarry` in [tab-carry.ts](/apps/studio/src/electron-main/windows/tab-carry.ts)

### L. Escape then release flashed the tab at the pointer

- Status: fixed
- Where: `Tab` in [tab-strip.tsx](/apps/studio/src/client/components/window/tab-strip.tsx)

### M. The last movement of a release placed the tab among the tabs from its press

- Status: fixed
- Where: `onDragStart` in [use-tab-carry.ts](/apps/studio/src/client/components/window/use-tab-carry.ts)

### N. Taking a maximized window's place left the window not maximized

- Status: fixed
- Where: `takeStrip` in [tab-carry.ts](/apps/studio/src/electron-main/windows/tab-carry.ts)

### O. The chord and the menu disagreed about a closed site

- Status: fixed
- Where: `isGoneSite` in [app-tabs.ts](/apps/studio/src/client/components/window/app-tabs.ts), `mergeAllWindows` in [app-window.ts](/apps/studio/src/electron-main/windows/app-window.ts)
- What: a closed site's page is kept in the renderer, so after a window changed renderers the chord brought back a tab saying the page was closed, where the menu had already hidden it. A merge also dropped the other windows' closed lists.

### P. An agent's `window read` asks the window showing the chat, and the page can be in another

- Status: open
- Where: `readPageText` in [browser-tabs.tsx](/apps/studio/src/client/components/window/browser-tabs.tsx)
- What: after a used page is pulled, a parked page of a chat left behind stays in the pressed window's renderer until the chat is shown. The agent is told the tab has no page loaded and to run `instrument window show`, which brings it. Move Tab Here has the same shape where a chat is in one window and floating over a site in another. Both end in a message rather than a loss, and neither is common.

### Q. An only tab joining another strip drops its window's closed list

- Status: open
- Where: `land` in [tab-carry.ts](/apps/studio/src/electron-main/windows/tab-carry.ts)
- What: the window closes with nothing to come back to, so the tabs closed in it cannot be reopened. Telling the target races the tab it is receiving, and the list is a convenience.

### R. A closing window's hosted pages moved to the window taking its tabs

- Status: fixed
- Where: `closeInto` in [tab-carry.ts](/apps/studio/src/electron-main/windows/tab-carry.ts), `mergeAllWindows` in [app-window.ts](/apps/studio/src/electron-main/windows/app-window.ts)
- What: no tab named them there, so an HTML file's page reloaded unseen and nothing closed it. They go with their window now.

### S. Waiting for a strip to draw what it holds stalled over-full strips and never stopped

- Status: fixed
- Where: `drawnHolding` in [tab-carry.ts](/apps/studio/src/electron-main/windows/tab-carry.ts)
- What: a strip with more tabs than fit draws only some, so the comparison never matched: the release waited its full second, and the page kept comparing on every frame for the rest of the window's life.

### T. A press during a release could leave one tab in two windows

- Status: fixed
- Where: `beginCarry` in [tab-carry.ts](/apps/studio/src/electron-main/windows/tab-carry.ts)
- What: the release was still adopting its spare when the new drag took another. A drag now cannot leave its row until the release is done.

### U. Escape after passing other tabs jumped the tab home

- Status: fixed
- Where: `Tab` in [tab-strip.tsx](/apps/studio/src/client/components/window/tab-strip.tsx)
- What: the gesture holds off the layout animation that would carry the tab to its place, so the place changed under it at once and only the rest settled.

### V. A landing whose target closes in its wait leaves the pressed window unseen

- Status: open
- Where: `land` in [tab-carry.ts](/apps/studio/src/electron-main/windows/tab-carry.ts)
- What: needs the target closed within the 400 ms after the release, with the tab already handed to it, so the tab is gone either way. Left alone for that reason.

## Checked and found correct

Tab and guest history traveling with a moved tab, the closed list staying per window, a closing window's guests going with it and its tabs reopening, kept state across windows and launches, window commands, read marks, notifications and deep links all held up when traced. No undo or redo of opening and closing tabs exists on main or here, only reopen.
