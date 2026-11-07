# The same chat open in more than one window

Reviewed: the whole branch against `origin/main`, at `1f2e7b385`

Asked for after the first-principles review, since a chat, draft or site open in two, three or four windows at once is the likeliest source of bugs a second renderer brings. One reader took it blind, reading the earlier ledgers only to leave their findings out, and ran nothing, so each finding below was checked against the code first. A second read each system's own behavior for the hidden spare window, and a third measured what each window costs.

Held up: live streams reach every window showing a chat, and one that opens mid-stream starts from the transcript as it stands (`message.ts`), since each window has its own port and subscribes before its first read. Agent status, asks and sign-in cards are read again per window. The only stream sent to one window, `window.tab`, is sent to it on purpose. Browser commands go only to the window that has the page. Shared browser storage is debug-only or shared on purpose, and nothing persists a query cache. App zoom, widths and views are shared live; the developer strip and DevTools belong to one window.

What a window costs: a dev build's renderer is about 320 MB of footprint, and a packaged one about half that. The hidden spare costs as much as a window. Each renderer's JavaScript heap is 90 to 100 MB whatever it shows, almost all of it the app's code, so sharing stores between windows would save little. Main grows about 6 MB per window.

## Findings

### A. A page another window took went silent to the agent driving it

- Status: fixed
- Where: `moveTarget` in [manager.ts](/apps/studio/src/electron-main/browser-view/manager.ts), `tellDetached` in [entry.ts](/apps/studio/src/electron-main/browser-view/entry.ts), the tab session's `onDetach` in [cdp-task-bridge.ts](/packages/workspace/src/logic/server/routes/cdp-task-bridge.ts)
- What: the page's guest in the new window is a fresh one, and its watchers were never told the old one went. An agent's commands reached the new page and nothing came back, so its load and idle waits ran to their timeouts. The watchers are told the page detached, and the task bridge announces the tab again once its new page stands, so the agent attaches to it as to a tab that closed and came back.

### B. A page in use is reloaded by another window once its own stops showing it

- Status: fixed
- Where: `canTakeParked` in [manager.ts](/apps/studio/src/electron-main/browser-view/manager.ts), the take on its own in [browser-panel.tsx](/apps/studio/src/client/components/window/browser-panel.tsx)
- What: a window showing a page's tab takes the page, which reloads it, once the window that has it stops showing it and no agent has sent it a command for 30 seconds. That ignores `isUsed`, so a form a person half filled, or a page an agent is still working through between model calls, loses what was in it. A used page stays where it is: the window asking shows "This page is open in another window", and the page comes over only with Show Here. The test that pinned the old 30 seconds passed because a guest that never attaches is dropped at 15, so it now attaches one.

### C. An agent showing a page another window has lands on the notice

- Status: left as it is
- Where: `show` in [use-openers.ts](/apps/studio/src/client/components/window/use-openers.ts)
- What: the ask goes to the window in front showing the chat, which selects the tab and shows "This page is open in another window" while the agent drove the page within 30 seconds. Bringing the page over reloads it, losing what the agent did there, so with B the notice is the answer: the page stays where the agent's work is, and Show Here brings it over.

### D. A window not drawing a page kept it awake

- Status: fixed
- Where: `PageLease` in [browser-panel.tsx](/apps/studio/src/client/components/window/browser-panel.tsx)
- What: a window showing the notice held the page's presence lease, so the window that had the page never started its sleep clock. The lease is held only while this window has the guest and shows it.

### E. A spare beneath a drag opened pages it held no guest for

- Status: fixed
- Where: the take on its own in [browser-panel.tsx](/apps/studio/src/client/components/window/browser-panel.tsx)
- What: a spare given a chat opened that chat's page where no window had it, so an undone drag left a guest in a hidden window, and the next window to show the page reloaded it. A window beneath a drag opens no page and holds none.

### F. The spare was in the Window menu during a drag, and could be stale after sleep

- Status: fixed
- Where: `openSpareWindow`, `adoptSpareWindow` and `renewSpare` in [app-window.ts](/apps/studio/src/electron-main/windows/app-window.ts), `placeSpare` in [tab-carry.ts](/apps/studio/src/electron-main/windows/tab-carry.ts)
- What: macOS lists a window shown at no opacity in the Window menu, so a second window was there for a drag. A window kept out of sight for hours is the likeliest to come back blank after sleep or a GPU process going. Windows sizes the first bounds a window gets on a display of another scale wrongly ([electron#54627](https://github.com/electron/electron/issues/54627)). The spare is left out of the menu until adopted, closed and started again on resume or when the GPU process goes, and placed twice on Windows.

### G. A right-click menu opened over the window in front

- Status: fixed
- Where: `showContextMenu` and `shareText` in [utils.ts](/apps/studio/src/electron-main/rpc/routes/utils.ts)
- What: they went by the focused window, which a right click in a window behind on macOS does not change. Both go by the calling window.

### H. Two windows writing one kept key at once can each show the other's value

- Status: open
- Where: `keptAtom` in [kept-state.ts](/apps/studio/src/client/lib/kept-state.ts), the forwarding in [kept-state.ts](/apps/studio/src/electron-main/stores/workspace/kept-state.ts)
- What: a window writes its own copy first and main forwards each write to every other window, so two writes inside one round trip leave each window showing the other's, until the next write. `pane-open.v2` is still one key for every group, so two windows changing two chats' panes at once can lose one. Nothing writes one key from two windows on its own today, so both are left: one file per window would break a chat's tabs being the chat's, and append-only records are heavy for this. Main telling the sender its order too, and `pane-open` by member, would close them.

### I. One focus claim for every window

- Status: open
- Where: `hostFocusClaimed` in [focus-guard.ts](/apps/studio/src/electron-main/browser-view/focus-guard.ts)
- What: typing in one window counts as the host holding focus while an agent drives a page in another, which could give back focus that window never had. Not seen; left until it is.

### J. The hidden spare reports itself visible

- Status: open
- Where: `paintWhenInitiallyHidden` and `backgroundThrottling` in [app-window.ts](/apps/studio/src/electron-main/windows/app-window.ts)
- What: a spare that was never shown says `visibilityState: "visible"`, so it is probably not throttled and redraws for every stream it subscribes to. Its CPU at rest has not been measured.

### K. A failed window-file write during the upgrade can lose a file viewer's page tabs

- Status: left as it is
- Where: the `window-tabs.v9` split in [window-tabs.ts](/apps/studio/src/client/components/window/window-tabs.ts)
- What: reported by another reader. The renderer takes the old key out of `layout` as it splits it, and the groups of pages drawn inside a file's viewer go to the window's own file, which flushes separately. If that file cannot be written while `layout` can, the next launch has those groups nowhere. It is real, and left: it needs `window/windows/` unwritable while the `window/` folder above it is writable, it runs once per computer on the upgrade from a build that had one window, and what it loses is the tab record of a page a viewer makes again as it opens, its back history inside the file, never a chat's or a site's tabs, which go to `layout` in the same write that removes the old key. Main's own move of window keys out of `layout` already waits on the flush; doing that here would mean main reading the earlier tab shape.
