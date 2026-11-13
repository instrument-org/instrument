Status: open.

# Tab groups prototype

A throwaway prototype of a new window layout, on its own branch, for the two cofounders to use before anything about it is decided for the product. It replaces the current shell; it does not sit beside it behind a setting.

## The layout

- A left **sidebar of tab groups** replaces the app rail, the chat list and the window tab strip.
- The open tab group's **tabs** sit over the center, styled like today's side pane tabs (`pane-tabs.tsx`): attached to the content below them, not app-level window tabs.
- Under the tabs, a **toolbar**: back, forward, reload, then the address field. No dividers between them. It sits over the work only.
- The group's **chat** sits in a column on the right, joined to the work by a divider, open in every group and narrow (300px, the pane's floor) until the divider is dragged. It keeps its width as the window or the sidebar changes, and the work takes the difference. An X at the top line's right end closes it, and nothing else does; closed, the chat is a "Chat" button with the bubble in the X's spot, and while the agent works that button shows only the app's working dots.
- **One top line**: the tabs, their +, and the chat's head share one line across the window, and its empty space drags the window. On Windows and Linux the caption buttons come after the chat's X, or the Chat button, at the far right.
- **A group always has a tab.** A new group opens on a new tab beside its chat, and a group that is only a chat, such as one opened from History, gets a new tab beside it. There is no full-width chat.

The look is the app's current colors, type and components. Nothing is restyled beyond what the move needs.

## Scope: structural only

Build the structure, and nothing that doesn't already exist in the product. The chat is today's chat with its existing behavior: composer, model picker, transcript, asks, tasks. No suggestions, no generated follow-ups, no new AI features. Naming a group by AI when its tabs change is out of the first version; a group's title is its chat's title.

## Tab groups

- One chat per tab group. A group is a chat plus its tabs, so the chat's existing records are the group's records, and the tabs a chat already keeps (today's side pane tabs) are the group's tabs.
- **Sidebar rows** are two lines, the inbox's two-line row: the title with the time of the chat's last message, then the chat's latest line (the step it is on, the question it waits on, or its last reply), with the tabs' favicons at the line's right end in under half its width. A group whose chat has not started shows its tabs' favicons alone. A new tab has no favicon there. No chat icon on rows. Unread groups have a bold title. Starred becomes pinned: pinned rows sit above a plain divider.
- **New**: a "New" row with + at the bottom of the list, showing ⌘N. New groups are added at the bottom of the list. Once the list scrolls, "New" sticks to the bottom with a divider above it.
- **Projects** are listed at the top of the sidebar with no count. Opening one takes the sidebar over as today, with its banner, its groups and a back control, sliding in from the right and back out from the left, with the sidebar washed in the project's color. New project is a near-hidden + (or the right-click menu) on the Projects heading.
- **The sidebar's top row**: the sidebar toggle right after the traffic lights on a Mac and first on Windows and Linux, the notifications bell at the row's right end. The toggle stays in that spot while the sidebar is closed. No Activity button.
- **The sidebar's footer**: the account and Settings at the bottom left, with a Help menu (a ? button) that holds feedback, laid out for the sidebar's width rather than the old thin rail.
- **Search** sits at the top of the list, showing ⇧⌘F. It shows this window's groups first, then the chats other windows have open, then History, each below a line. History sits beside search and lists every chat and kept draft that no window has open, most recent activity first, archived chats included; opening one is an explicit action and adds it at the bottom of the list.
- Each window has its own tab groups, in its own order. A group is open in one window at a time: choosing one that another window has open, from History, search, a notification, Go to or a chat link, brings that window forward. A chat no window has open stays in History, its row showing when it is working or waiting.
- On first launch, a window starts with one new tab group and no chats open. Every existing chat is in History, found from there or from search. Nothing on disk changes for this.

## Tabs

- **⌘N** makes a new tab group, **⌘T** a new tab in the open group. ⌘N is "New chat" today.
- Every tab behavior and shortcut works as today's window tabs do: ⌘-click opens a link in a background tab in this group, middle-click and close, reopen closed tab, the tab menu, shrinking tabs, status marks, tooltips. Shift-click opens in a new tab group.
- A page the agent opens itself is a tab in its group.
- A file or link opened from outside the app opens as a new tab group at the bottom of the list.
- **Dragging tabs**: a tab dragged onto another group's row moves there; dragged into empty sidebar space it becomes its own group; tearing a tab out into its own window works as today.

## The new tab

One new tab page that looks the same everywhere:

- Two buttons with their keys, centered: **Browse ⌘L**, which puts the cursor in the toolbar's address field, and **Files ⌘O**, which turns the tab into the Files browser at the group's project folder, or the workspace when it has none.
- No composer of its own: the chat column's composer is the one place to type, and it has the cursor while the new tab is up, so a new group starts with the cursor there.
- Sending the first message from a new group starts its chat in place. The new tab stays, so nothing on screen moves. Until then, what is typed in the chat column's composer is the group's draft.
- The tab strip's + is plain: no menu, no extra buttons beside it, no key shown.

## Shortcut keys shown

Keys show only on the new tab's Browse and Files buttons, on the sidebar's New row, and in the search field. Nowhere else: never beside an icon button, never on +, never in the address field.

## Closing

- ⌘W closes the current tab. A group's last tab that isn't a new tab leaves a new tab in its place, however it closes. ⌘W on a lone new tab closes the group, with a hint to press it again.
- Closing a group whose agent is running asks first. The dialog is small and terse: a copy of the group's sidebar row, then "Stop and close" (Return) and "Keep open" (Esc), with those keys shown.
- Closing a group takes it out of the window and nothing more: its chat is not archived and goes back to History. A group whose chat has not started keeps its draft when the draft has words or files, so it is in History too; an empty one is thrown away.

## Window controls on Windows and Linux

Roughed in: the caption buttons go at the top right as today, and what sits there moves left to make room, the way the layout moves for the macOS traffic lights. The collapsed chat's corner is the hard case; a rough answer is enough for this version.

## Not building

- A hover peek of the collapsed sidebar.
- More than one chat per group, the tab overview grid, suggestions of any kind, the new tab's inbox and clipboard rows.
- Any change to the workspace folder on disk.
- A preview build. The prototype runs locally until it has been used and revised.

## Order of work

1. The shell: the sidebar of tab groups, the tabs over the center, the toolbar, the chat column and its collapse, ⌘N and ⌘T, the new tab page.
2. Closing, History and search.
3. Dragging tabs between groups and into the sidebar.
4. The sidebar's top row and footer, projects, and the Windows and Linux controls roughed in.

## How it's built

- **A tab group is a chat's tab group as the code already has it.** The window's tabs are grouped by `group` in `window-tabs.ts` (the `layout` kept file, shared by every window): a chat's group is its `ChatId`, a new chat's is its draft's (`draftGroupOf`). A tab group is one of those groups, with its chat in the column on the right. A group whose chat has not started is a draft's group: the chat column there is today's new chat composer, and its first message starts the chat and hands the draft's tabs to it as they stand, its new tab included (`handOverTabs`).
- **The window has one app tab.** The app tab strip and the rail are gone. Each window keeps one app tab (`appTabsAtom`), standing on the open group's address (`/chats/<id>`, or `/chats?draft=<id>` for a group whose chat has not started); choosing a row in the sidebar moves that tab there. A window with no tab groups of its own starts on one new group, whatever app tabs it kept before. Everything else a window shows stands in a group: Apps, Activity, release notes, extensions, a file or a page reached at the window level opens as a tab in the group up, or in a new group when none is (`useTabGroupUpkeep`). Only the debug pages still take the app tab.
- **The group's tabs are the side pane's tabs, moved to the center.** `PaneTabs` draws them over the work, `GroupItem` draws the tab up under its address row. The sidebar toggle is the window frame's `corner`, laid over the window's top left, and whichever row reaches there while the sidebar is closed leaves it room. The chat column is `ChatHeader` and `ChatScreen`, or `NewChatView` for a group whose chat has not started, sized by the share `RightPane` keeps and holding its width as the row changes. The new tab is the `/new-tab` screen in a group (`isHomeTab`), drawn by `GroupItem` as `GroupNewTab`. `GroupView` gives a group this window lists a new tab when it shows one with none, and `closeTab` in `tab-model.ts` puts a new tab in place of a chat's or a draft's last tab.
- **New state** is per device and lives in the `view` kept file: whether the sidebar is open, and which groups have their chat column closed. Each window's groups, in its order, are a list of chat ids and draft groups under `tab-groups.v1` in its own `window` kept file, and which group it shows is its app tab there. The keys main's build reads keep the shapes it reads. Nothing new is written to the workspace folder: a new group is a draft, written to `Drafts/` with the same fields as a new chat's once it has words or files, and closing a group writes nothing about its chat.
- **Multi-window.** A window's rows are its own list, matched to the chat list and the drafts; History is every chat and kept draft that no open window lists, which main reports through `window.live.tabGroupsElsewhere`. Choosing a group another window lists asks main to bring that window forward (`window.showInOtherWindow`, which reads the windows' lists as well as what they show) instead of opening it here too. A new window opened on tabs lists their groups; Shift-click on a row moves the group to a new window.
- **Dragging a tab out or to another window.** A group's tab drags the way a window tab does on main, through `tab-carry.ts`: pulled off its row (`useGroupTabCarry`, around `useTabCarry`) it shows a picture of the window at the pointer, and let go off every window it opens a spare window, which takes it into its own group in place of the new tab it came up on. Held over another window, that window works out where the tab would land (`useGroupTabLanding`) and tells main (`window.placeGroupTabCarry`): among the tabs of the group it shows, at the pointer, where it draws the tab; on a sidebar row, which lights; or on the list's empty space, as a new group. Anywhere else over that window the drag is free. The window the tab lands in makes the move itself (`receiveGroupTab`, through its own `make` and `moveTab`), and a page's guest follows with its history. A window whose one group is a chat not started yet, with this one tab, is main's window with one tab: the window goes with the tab, and closes once the tab lands in another. The only tab of a group whose chat has not started takes its group along, draft included, and the window it left lets go of the group. Over its own window's sidebar, a tab drops into the group under it, or into a new group over empty space. Tab > Move Tab to New Window goes the way a tab let go in the open does.
- **Reopen closed tab.** A closed group tab goes on the window's own closed list (`recentlyClosed` in `app-tabs.v2`, as `groupTab`, standing on its group's address), the list main's Shift+Cmd+T reads, so a window closed since comes back first, by close time, and a blank new tab is passed over. Otherwise the newest tab whose group this window still has open comes back at its place in the group, up.
- **Caption buttons off the Mac.** While the window draws them, the frame sets `--caption-room`, and whichever row reaches the card's top right (the chat's head, or the tabs while the chat is collapsed) ends in a `CaptionRoom` spacer that wide.

### Where the prototype stands

Every phase in the order of work is built. What is rough or missing:

- **Dragging a tab out**: checked in a dev instance held off screen, so the picture at the pointer and a window following its only tab were never seen. A page carried to another window keeps its back history, though not every time: the history goes in alongside the page's reload (`moveTarget` in the browser view manager), as on main. A group's tab with a used page joins the other window and its page reloads, where main's window tab would take over that window's strip to keep the page live.
- **Reopen closed tab** works per window, the way a browser's does. A page comes back at its address in a fresh page, so its back and forward history is gone, as on main. The chord was never pressed in the app: it is a menu key equivalent, which input sent to a window held off screen does not reach.
- **Multi-window**: choosing a group another window has open asks main to bring that window forward, but the raise itself was never seen on screen. A window closed for good gives its groups back to History; one reopened with Shift+Cmd+T keeps a group another window has since opened only if it is the group it had up.
- **Windows and Linux**: the room for the caption buttons is a fixed 140px, checked only with the Mac's force-show toggle. Not run on either system. In the chat column's 300px it takes nearly half the chat's head, so a new group's head keeps its Project chip and loses "New chat".
- **Activity** has no button, as the plan says. Its chord (Cmd+Y) opens History, and Activity stays in the command menu.
- **The Apps dot** for an app signed out since Apps was last shown went with the rail.
- **The menu** names tab groups and the sidebar. The shortcut guide's Chats section still lists the old chat list's keys (Back to List, Next Chat in List), and the sidebar's search field is still labeled "Search chats" for screen readers.
- **A group whose chat has not started** is titled "New tab" until the chat column's composer has words.
- **The first message** of a new group, which keeps its new tab as the chat starts, was never sent in the app: the fixture workspace it was checked in has no model to send with.
- **Rows** are in the window's own order: a new group, or one opened from History or search, lands at the bottom and stays there once its chat starts. A group whose chat has not started and whose draft has nothing is gone after a relaunch, since an empty draft is never written.
- **Search and History** are per window and not kept; opening a group from History returns the sidebar to the list. History has no Delete; a chat's own menu still has one, and the chat head's Archive still archives the chat and closes its group.
- **A file or link opened from outside** makes a new group every time, even when a group already shows that file.

Decisions the plan left open, taken from what the product does today:

- The chat column's composer takes the caret whenever the new tab comes up, from ⌘T and + too, and leaves it to the work otherwise.
- The X on a lone new tab leaves it there, since a group always has a tab; ⌘W closes the group.
- A chat's group whose tabs were all dragged to another window gets a new tab when it is next shown.
- Cmd+W's second press counts within three seconds.
- The sidebar resizes as the inbox did: its right edge drags it between 320 and 440 px, leaving the group at least 560, a drag under 240 slides it shut, and the toggle slides it in and out. It starts at 320 and keeps the width it is dragged to.
- A dragged tab stays the one up, and the window follows it to its group, as a browser's tab dragged to another window does. A group whose chat has not started and that a drag leaves empty is thrown away.
- Shift-click on a row moves the group to a new window; shift-click on a link opens a new group, as the plan says.
- History is ordered by a chat's last message or reply, and a draft's last change.
- A chat open in another window shows in search with no close in its menu, since closing it is that window's to do.
- A tab asked for from inside a tab (a middle click, a Cmd-click, Open in New Tab, in Files or on a page of a group whose chat has not started) lands right after the tab up, and waits behind it when the gesture asks to, as a browser's link in a new tab does. A folder still opens in place.
