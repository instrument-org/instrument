# Multiple windows read from first principles, before merging

Reviewed: the whole branch against `9baecdab0`, at `74ade49be`

Asked for once the drag felt right to the person trying it, since the change is so large: whether it is built the way it should be, and what it breaks away from the drag. Two readers took it blind, reading the earlier ledgers only at the end: one the design and the drag's core, one everything else, above all what changes for someone who never opens a second window. Neither ran anything, so each finding below was checked against the code first.

Both held the core up: the picture until the release, the spare window, main owning the phases, and the pure rules. Upgrading from an earlier build, first launch, setup, quitting, an update restart and the Dock also held up.

## Findings

### A. On Windows, closing a window quit the app while another was minimized

- Status: fixed
- Where: `hasVisibleWindowOtherThan` in [app-window.ts](/apps/studio/src/electron-main/windows/app-window.ts)
- What: Electron says a minimized window is not visible on Windows, so the window being closed read as the last. The app went, its agents with it, or asked about running work for closing one window of two.

### B. A second launch or a link during boot made two windows with one id

- Status: fixed
- Where: `createAppWindow` in [app-window.ts](/apps/studio/src/electron-main/windows/app-window.ts)
- What: the link opened the window while boot was on its way to restoring it, and boot made it again. Two windows shared one file, and closing either left the other with no id, reading as a spare.

### C. Every window coming up cleared what the launch left over

- Status: fixed
- Where: the launch sweep in [app-window.tsx](/apps/studio/src/client/components/window/app-window.tsx), `takeLaunchSweep` in [app-window.ts](/apps/studio/src/electron-main/windows/app-window.ts)
- What: a window opening later, or a spare booting, took another window's new chat box for a leftover, since an empty draft in one is tracked only in that renderer. Its page closed and the draft went. Only the first window up clears them now.

### D. A launch with several windows sent a file or link to the first one up

- Status: fixed
- Where: `takePendingAppWindowAsks` in [app-window.ts](/apps/studio/src/electron-main/windows/app-window.ts)
- What: whichever page loaded first took what waited, and then the window in front went over it, so nothing seemed to happen.

### E. A link could leave the app out of sight after an idle restart

- Status: fixed
- Where: `showInWindowHolding` in [app-window.ts](/apps/studio/src/electron-main/windows/app-window.ts)
- What: naming a chat in a window held off screen, it asked that window without showing it, and said it had dealt with the link.

### F. With no window listening, an agent's ask could reach the spare

- Status: fixed
- Where: `appWindowForChat` in [app-window.ts](/apps/studio/src/electron-main/windows/app-window.ts)
- What: an ask naming no window is for anyone, and a spare answers, so the page came up out of sight. It names the window in front now.

### G. Pages in another window counted as the tab's own

- Status: fixed
- Where: `beginCarry` in [tab-carry.ts](/apps/studio/src/electron-main/windows/tab-carry.ts)
- What: a chat open in two windows has its pages in one. Dragging its tab in the other weighed those pages as its own, so that window left for a page it did not have, or took the page away from the window showing it.

### H. The keyboard does not come back to a page after a press on its tab

- Status: open
- Where: the press on a tab in [tab-strip.tsx](/apps/studio/src/client/components/window/tab-strip.tsx)
- What: a press anywhere outside a page takes the keyboard out of it before `pointerdown` is heard, so after a drag, as after any press on a tab, typing goes nowhere until the page is clicked. The reader also reported Escape going to a page holding the keyboard. It does not: logged through a real drag of a window's only tab on macOS, the keyboard is already in the window at the press, and Escape reaches it. Holding the keyboard for the drag, the fix first tried, had nothing to hold. Windows and Linux were not logged.

### I. Taking over a full-screen window's tabs left the window not full screen

- Status: fixed
- Where: `placeWhenDrawn` in [tab-carry.ts](/apps/studio/src/electron-main/windows/tab-carry.ts)

### J. A press during a move from a menu could leave one tab in two windows

- Status: fixed
- Where: `moveTabNow` in [tab-carry.ts](/apps/studio/src/electron-main/windows/tab-carry.ts)
- What: only a drag's release held a new drag off.

### K. With used pages on both sides, the one not in the hand reloads

- Status: open, for the person to rule on
- Where: `whatGoes` in [tab-carry-rules.ts](/apps/studio/src/electron-main/windows/tab-carry-rules.ts)
- What: pulling a used tab out of a window whose neighbor also has typed words leaves that neighbor to reload, and landing on another strip reloads that window's pages. The reader proposed never moving a typed page without asking, leaving it where it is behind "This page is open in another window". Show Here reloads it, though, and its tab is in another window by then, so the words would still be lost, only later. Two pages in one renderer cannot be parted without a reload until Electron can move a `<webview>` (see the decision).

### L. Move Tab Here leaves a dead tab when the site's tab is in another window

- Status: open
- Where: the agent's take over in [use-openers.ts](/apps/studio/src/client/components/window/use-openers.ts)
- What: it replaces the site's tab only in the window it runs in, so another window's tab says the page is closed. It needs an agent asking for a site whose tab is in a window other than the chat's, and the person approving. A dead tab is a message rather than a loss, though a page taken this way reloads.

### M. A popped-out chat does not count as showing it

- Status: open
- Where: `appWindowShowing` in [app-window.ts](/apps/studio/src/electron-main/windows/app-window.ts)
- What: a notification for a chat floating in a window behind opens a tab in the window in front, and its agent's pages are hosted there.

### N. A reorder before a pull hands the wrong neighbor's page over

- Status: open
- Where: `neighborPages` in [move-tab.ts](/apps/studio/src/client/components/window/move-tab.ts)
- What: the neighbor is read at the drag's start. The tab coming up still takes its own page as it shows, and the page handed over is one the new window would reload when looked at anyway, so the cost is a scroll position. Deleting `neighborPages` would make a page an agent used in the last 30 s say it is open in another window.

### O. Typed words in the app's own screens do not count as used

- Status: open
- Where: `tabStanding` in [move-tab.ts](/apps/studio/src/client/components/window/move-tab.ts)
- What: a half-typed key in the Apps field is empty after the tab reopens. Counting filled fields as used would count the Browser's address field, so every browser tab would take its window along.

### P. Move Tab to Another Window does nothing for a full-screen window's only tab

- Status: open
- Where: `beginCarry` in [tab-carry.ts](/apps/studio/src/electron-main/windows/tab-carry.ts)

## Considered and left

- **A window's only tab taking the picture too,** about 90 lines out: rejected, since the window itself following the pointer is the part the person liked most.
- **An owned pointer gesture in place of Motion's `Reorder.Item` on the app strip:** it would remove the private `_dragX`, the frame-late release and the repeated events, and needs a real pointer pass on three systems. Worth doing after this lands.
- **Electron's `pageState` to restore a reloaded page's fields and scroll:** untested, half a day in bare Electron, and it would not keep fields a script draws.
- **Smaller cuts:** `isSpareDressed` (dressing again at the release would tell a spare its state twice), one on-screen clamp for `windowBoundsAt` and `boundsAtRelease`, a stricter `sameHref` in `appWindowShowing` (it has to ignore search a window added), the fallback in the menu's Settings (reading the window in front would be an import cycle), and hiding Merge All Windows in the command menu with one window open.
