# Windows

A person can have any number of app windows open on one workspace. They are full windows of the same app, each with a strip of tabs across its bar, and everything behind them (the workspace machine, the chats, the agents, the RPC routes) is one process they all talk to. Each window is its own `BrowserWindow` with its own renderer, Jotai store and React Query cache. For why they are separate renderers rather than one renderer drawing into several native windows, and why a chat can be open in two of them, see the [decision](../decisions/2026-11-03-windows-are-separate-renderers.md).

## Which window is which

[`windows/app-window.ts`](../../apps/studio/src/electron-main/windows/app-window.ts) keeps every open window by the id it keeps its state under: `app` for the first a workspace ever had, a fresh one for the rest. `getAppWindow()` is the window last in front, which is what the rest of the main process means by "the window"; `getAppWindows()` is all of them, front to back. A window's page learns nothing of its own id: main names a web contents as it makes it (`app-window-ids.ts`), and answers whatever that web contents asks with that window's own things.

## What belongs to a window, and what they share

| What | Where | Who sees it |
| --- | --- | --- |
| The strip of tabs, the drafts and chats floating over it, whether the inbox is out, the chat and folder Chat and Files in the rail go back to | `window` kept file, `window/windows/<id>.json` | That window alone |
| Each chat's, draft's and site's tabs and which is up | `layout` kept file, one key per group (`window-tabs.v10/<group>`) | Every window, live |
| How things are laid out (widths, views, zoom) | `view` kept file | Every window, live |
| Size and place, which windows are open and in what order, which can come back | `window/window-state.json` | Main |

A group is a chat, a draft or a site, which is the same thing whichever window shows it, so its tabs are kept by the group and not by the window. A window writes only the groups it changed (`keptMembersAtom`), because a write of the whole list from one window would undo what another wrote a moment before. Anything that lets go of a group has to remember that other windows share it: a window drops a site's group only when it held that group itself and no tab in another window stands on it, closed windows that can come back included (`siteGroupsInOtherWindows`), and the sweep of empty drafts at startup keeps those floating in any window.

## Asking one window

Almost everything main publishes for the windows is read by all of them (`liveRead` routes re-read for themselves), and that is right for state. A request to do something is not: `window.command` names a web contents, published through `commandWindow`, and the route hands each window only what names it. A chord goes to the window it was pressed in (`bindAppWindowChords`), and a menu row to the focused one.

What something outside the app asks for goes to the window that already has it (`appWindowShowing`, read from what each window keeps): a notification or a link to a chat brings that window and that tab forward, and otherwise it opens in a new tab of the window in front.

What an agent asks of a chat's tabs must be answered exactly once, or a page it opens would open per window, so each ask names one window as it goes out (`appWindowForChat`): of the windows whose page can hear it, the one showing the chat, else the one in front. A blank page an agent makes for itself goes to the same window. The workspace package asks through `WorkspaceConfig.windowForChat`, which a host with one window leaves out.

## Moving a tab

`moveTabOut` ([`move-tab.ts`](../../apps/studio/src/client/components/window/move-tab.ts)) hands a tab, history included, to main (`window.moveTab`), and takes it out of the strip only once another window has it. Main either writes it into the kept state of a window it then opens, which reads it as it loads, or sends it to the window as `receiveTab`, refusing a window whose page is not listening yet so a tab is never lost on the way. A window left with no tabs closes with nothing to come back to (`closeEmptiedWindow`). Move to New Window, Move to Window and Merge All Windows all come through here.

Tearing a tab off ([`tab-drag.ts`](../../apps/studio/src/electron-main/windows/tab-drag.ts), `useTabCarry` in `app-tab-strip.tsx`) goes through the same move. The renderer keeps the drag, because a pointer's events keep arriving past the window's edge while the button is down, and sends main the screen position; only main can see every window, so main answers which strip the point is over (`carryDestination`), tells that window where the tab would land, and draws a picture of the tab under the pointer in a small window that never takes focus or the pointer. Let go over another window's strip the tab joins it, over its own it stays, and anywhere else it opens a window of its own, unless it is its window's only tab, when the window itself moves there. Windows are tested front to back from the order they were last focused, since Electron cannot read the OS's stacking order, and a window covering a strip takes the release.

## A page is in one window

A page tab belongs to a group every window can see, but its guest is a `<webview>` in one renderer, and Electron cannot move one between renderers. So a page is in the window that showed it last. [`in-app-browser.md`](in-app-browser.md#a-page-is-in-one-window-at-a-time) has what that does to a guest.

## Coming back

A launch brings back every window that was open, each where it was with its tabs, the one last in front on top (`restoreAppWindows`). A quit leaves those records alone, so closing the app is what keeps them. Closing a window while the app runs moves it to what can come back: File › Reopen Closed Window, or Shift+Cmd+T once no closed tab is left to reopen. The last ten are kept; past that a window's file and place go. With every window closed on macOS, the Dock icon brings back the one closed last.

Closing a window quits the app only where it is the last one on Windows or Linux (`quitsWithLastWindow`), and asks about running work only then. While setup is up, only the window it draws over is open; the rest come back as it goes down, and New Window does nothing until then.
