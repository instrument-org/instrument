# Plan: app-level tabs in the 2.0 window

Status: in progress.

## Why

The 2.0 window keeps tabs in three unrelated places: a chat's tabs down its rail, and a strip of tabs inside each of Files, Apps and Discover. Only one chat is on screen at a time, and a screen left behind is unmounted, so coming back to it starts over. The classic window solved the same problem with tabs across the top that each keep their own route alive and their own history. The 2.0 window gets the same thing: tabs across the window bar, each one a chat, a folder or file, the apps, an app, or Discover, with back and forward in the bar walking the tab on screen.

## What stays

- A chat's own tabs (its browsers, files and tasks down its rail) are unchanged. They are the chat's, keep their own history, and their address row keeps its own arrows. Walking them never records an entry in the app tab's history.
- Drafts and popped-out chats float over the window, whichever app tab is up.
- Agents never open, close or move app tabs; their tab requests act on a chat's tabs, as now.

## Model

Reuse the classic window's pieces rather than a second implementation:

- `tabs-model.ts` (pure transitions: add, close, reorder, reopen closed, select by index and relative) over its own atom, `orchestrator.app-tabs.v1`, with the same debounced storage, zod check and repair as `tabsAtom`.
- `createTabRouter` for one TanStack router per app tab on a memory history seeded from the tab's saved stack, and a registry of its own for the orchestrator window's routers.
- The classic `TabView` pattern: every app tab stays mounted, hidden with `invisible opacity-0`, inside `ActiveTabProvider` and `TabIdProvider`, mirroring its location, history, title and icon back into the model on every navigation. Launch restores every tab at its place in its history; Shift+Cmd+T reopens a closed one with its history.

## What an app tab can be at

Every app tab is a route under `/orchestrator`:

| Route | Shows |
| --- | --- |
| `/orchestrator` | Chat: the inbox with no chat open. A new tab opens here. |
| `/orchestrator/threads/$id` | Chat: the inbox beside the chat, its tabs on its rail. |
| `/orchestrator/computer?…` | Files: the Finder at a folder, or a file. |
| `/orchestrator/apps`, `/orchestrator/apps/$slug` | Apps, and one app's front. |
| `/orchestrator/ideas`, `/orchestrator/ideas/$idea` | Discover. |
| `/orchestrator/skills…`, `/orchestrator/tasks…` | As now. |
| `/orchestrator/page?group=…` | A site opened at app level, drawn by a page slot. |

Choosing a chat in the inbox, a folder in the Finder, or an app on Apps navigates the tab and records history, so back in the bar returns to where the tab was.

## The window

- **Shell, once per window** (`OrchestratorWindow`, rendered in place of `App` for the orchestrator window): providers, the app tab routers, the frame, the bar (back, forward, the app tab strip with its new tab button, the corner), the app rail, the draft and popped-out chat layer, the window's browser, window chords, and the dialogs. It reads the active tab's router through `RouterContextProvider`.
- **Per app tab** (`/orchestrator` layout route): the chat (inbox column, the conversation, its pane and rail) or the screen filling the card.
- **A chat's pane** draws its tab through `GroupItem`, as a popped-out chat already does, instead of through the router's outlet. The router is the app tab's; the pane's screens walk their own tab.
- **The group on screen** (`windowTabs.group`) follows the active app tab: its chat's thread, or none. The window's browser, the openers and the send context keep reading it as today.
- **The rail** jumps the active tab to a place (history entry); middle click, Cmd-click, or its context menu's Open in New Tab opens a tab there. Chat takes the tab back to the chat it last showed.
- **Chords**: Cmd+T new chat tab, Cmd+W close the app tab, Shift+Cmd+T reopen, Cmd+1…9, Ctrl+Tab and Shift+Ctrl+Tab, Cmd+[ and Cmd+] back and forward in the tab, the mouse's back and forward buttons.
- **Strip**: the existing `TabStrip` (drag to reorder, middle-click close, close button, shrink to icons), in the window bar.

## Retired

- The places' tab groups (`place:files`, `place:apps`, `place:discover`), `appPlaceAtom`, `chatGroupAtom`'s role as the chat's memory across places (the app tab's history carries it), the places' strips, and `useRouterSync` (the router no longer mirrors a chat's tabs). Pre-release, so no migration of saved place tabs.

## Order of work

1. Shell and per-tab routers with the layout route as the tab content; the bar's strip and arrows.
2. The chat's pane through `GroupItem`; the group on screen following the active app tab.
3. Places as routes; the rail as jumps with new-tab gestures; retire the place groups.
4. Chords, mouse buttons, reopen closed, restore on launch.
5. The pieces that read "the screen" (`useOnScreen`, the send context, `document.title`) gated to the active tab.

## Open

- Whether two app tabs on the same chat should share its tabs (they do, since a chat's tabs are the chat's) or collapse into one.
- What an app-level site page's arrows walk: the page's own history, as a chat's page does, or the tab's.
