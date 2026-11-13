Status: open.

# Tab groups prototype

A throwaway prototype of a new window layout, on its own branch, for the two cofounders to use before anything about it is decided for the product. It replaces the current shell; it does not sit beside it behind a setting.

## The layout

- A left **sidebar of tab groups** replaces the app rail, the chat list and the window tab strip.
- The open tab group's **tabs** sit on the window's top line as a browser's do: the strip a shade darker than the toolbar, and the tab up joined to the toolbar under it, as Chrome's and Safari's are. After them comes +, which reads "+ New tab" while the group has no tabs. At the line's right end stands the **chat tab**, named for the chat: its title, cut short to fit, or "New chat" until it starts, after the chat bubble, which gives way to the app's working dots while the agent works. While the chat is on screen the chat tab is the tab up, joined to what is under it, and once the group has tabs a press on it opens and closes the chat's column.
- **No second title.** The chat's head is gone: the chat tab is the only place its title shows. The head's menu is the chat tab's, on a right-click anywhere on it and on a caret at its end while the chat is shown, and it has the head's folder button as its first item, Show Chat Folder.
- **Chat first.** A new group, and a group whose last tab closed, is its chat alone, laid out as a chat site in a browser: under the tab bar, the toolbar a page has, with back, forward and reload turned off, and the bookmarks bar under it as a page shows it, then the chat. The address field works as it does on a page, and Enter opens what it names as a tab in this group, which moves the chat to its column. The composer has the cursor. A short line typed into the composer is offered as an address or a search with the address field's own rows over the box, less the search engine's suggestions: Enter opens an address, the arrows pick a search or a page, and Enter on plain words sends them.
- **A new chat** opens as 1.0's did, under that toolbar: the composer at the middle, the Instrument mark and "How can I help?" over it, and a pale glint across the composer as the chat arrives. No title and no project chips; the chat tab's menu files it under a project. From the first message on it is the transcript, with the composer at its foot.
- **The chat moves aside** once a tab opens, whether a page, Files or a new tab: it goes to a column on the right, joined to the work by a divider and narrow (300px, the pane's floor) until the divider is dragged. It keeps its width as the window or the sidebar changes, and the work takes the difference. Closing the last tab brings the chat back to the center. Nothing opens a tab the person didn't ask for. The composer's context follows the tab up: a page or a file up is its chip, and a new tab adds none.
- Under the tabs, a **toolbar**: back, forward, reload, then the address field. No dividers between them. While the column is open it sits over the work only.
- **One top line**: the tabs, their + and the chat tab share one line across the window, and its empty space drags the window. While the column is open the chat tab spans the column's width on that line, over the chat; while it is closed or the chat fills the group, the chat tab ends the tab bar. On Windows and Linux the caption buttons come after the chat tab, at the far right.
- **No Ask.** With the chat beside everything, nothing offers to ask about a page, a file or a folder in a new chat: no Ask in the toolbar, in Files or in a menu, and no Convert…. Ask on a selection, which marks it for the chat beside it, stays.

The look is the app's current colors, type and components. Nothing is restyled beyond what the move needs.

## Scope: structural only

Build the structure, and nothing that doesn't already exist in the product. The chat is today's chat with its existing behavior: composer, model picker, transcript, asks, tasks. No suggestions, no generated follow-ups, no new AI features. Naming a group by AI when its tabs change is out of the first version; a group's title is its chat's title.

## Tab groups

- One chat per tab group. A group is a chat plus its tabs, so the chat's existing records are the group's records, and the tabs a chat already keeps (today's side pane tabs) are the group's tabs.
- **Sidebar rows** are two lines, the inbox's two-line row: the title with the time of the chat's last message, then the chat's latest line (the step it is on, the question it waits on, or its last reply), with the tabs' favicons at the line's right end in under half its width. A group whose chat has not started shows its tabs' favicons alone. A new tab has no favicon there. No chat icon on rows. Unread groups have a bold title. Starred becomes pinned: pinned rows sit above a plain divider.
- **New**: a "New" row with + at the top of the list, under the pinned rows and their divider, showing ⌘N. New groups land right under it, newest first, so the list grows away from it. The list scrolls whole, New with it.
- **Projects** are listed at the top of the sidebar with no count. Opening one takes the sidebar over as today, with its banner, its groups and a back control, sliding in from the right and back out from the left, with the sidebar washed in the project's color. New project is a near-hidden + (or the right-click menu) on the Projects heading.
- **The sidebar's top row**: the sidebar toggle right after the traffic lights on a Mac and first on Windows and Linux, the notifications bell at the row's right end. The toggle stays in that spot while the sidebar is closed. No Activity button.
- **The sidebar's footer**: the account and Settings at the bottom left, with a Help menu (a ? button) that holds feedback, laid out for the sidebar's width rather than the old thin rail.
- **Search** sits at the top of the list, full width, showing ⇧⌘F. It shows this window's groups first, then the chats other windows have open, then History, each below a line. History is a dim row at the list's end, past the groups, that names none of what it holds and opens the History view (⌘Y does too). History lists every chat and kept draft that no window has open, most recent activity first, archived chats included; opening one is an explicit action and adds it at the top of the list, under New.
- Each window has its own tab groups, in its own order. A group is open in one window at a time: choosing one that another window has open, from History, search, a notification, Go to or a chat link, brings that window forward. A chat no window has open stays in History, its row showing when it is working or waiting.
- On first launch, a window starts with one new tab group and no chats open. Every existing chat is in History, found from there or from search. Nothing on disk changes for this.

## Tabs

- **⌘N** makes a new tab group, **⌘T** a new tab in the open group. ⌘N is "New chat" today.
- Every tab behavior and shortcut works as today's window tabs do: ⌘-click opens a link in a background tab in this group, middle-click and close, reopen closed tab, the tab menu, shrinking tabs, status marks, tooltips. Shift-click opens in a new tab group.
- A page the agent opens itself is a tab in its group.
- A file or link opened from outside the app opens as a new tab group at the top of the list.
- **Dragging tabs**: a tab held over the middle of another group's row lights that row and moves there; held between two rows, above the first or below the last, the rows move apart around a line and the tab becomes a group of its own there. The same works over another window's sidebar, and tearing a tab out into its own window works as today.
- **Dragging rows**: a row dragged within the list lifts out of it, the other rows making room where it would land. Dropped above the pinned divider it is pinned, below it unpinned. Dragged out of the window it becomes a window of its own, and over another window's sidebar it moves there, rooms and line the same.

## The new tab

⌘T or + opens one in any state, a browser's new tab that looks the same everywhere:

- The toolbar a page has, back, forward and reload before the address field, and the bookmarks bar under it. The field has the cursor as the tab opens, finishes addresses, lists pages from history and the search engine's suggestions, and searches the web, as it does on a page.
- Under them, the Files sidebar's places down the page, as Finder's sidebar lists them: a small dim heading, then a row of icon and name for each. Under "Project", the group's project folder when it is filed under one; under "Places", the workspace, then home, Desktop, Documents and Downloads as Pinned has them. Not This Mac or the drives. Each turns the tab into Files there. The places have no keys. No mark, no glint, no field of its own.
- No composer of its own: the chat's composer, in its column, is the one place to type to the chat. Until the chat starts, what is typed there is the group's draft.
- Sending the first message from a new group starts its chat in the same group. Its pages and Files tabs stay; a new tab closes, so a group that had only a new tab goes back to chat first.
- The tab strip's + is plain: no menu, no extra buttons beside it, no key shown. While the group has no tabs it is "+ New tab", the one tab-shaped thing on an empty strip.

## Shortcut keys shown

Keys show only on the sidebar's New row, in the search field, and as ⌘L in the address field of a group that is its chat alone, while the field is empty and does not have the cursor: the composer has it there, so the key says how to reach the field. Nowhere else: never beside an icon button, never on +, never in a page's or a new tab's address field.

## Closing

- ⌘W closes the current tab. A group's last tab closes like any other, however it closes, and the chat comes back to the center. ⌘W while the chat fills the center closes the group, with a hint to press it again.
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

- **A tab group is a chat's tab group as the code already has it.** The window's tabs are grouped by `group` in `window-tabs.ts` (the `layout` kept file, shared by every window): a chat's group is its `ChatId`, a new chat's is its draft's (`draftGroupOf`). A tab group is one of those groups, with its chat in the column on the right. A group whose chat has not started is a draft's group: the chat column there is today's new chat composer, and its first message starts the chat and hands the draft's tabs to it as they stand, less its new tabs (`handOverTabs`). A new group (`make` in `tab-groups.ts`) opens no tab unless something is to open in it.
- **The window has one app tab.** The app tab strip and the rail are gone. Each window keeps one app tab (`appTabsAtom`), standing on the open group's address (`/chats/<id>`, or `/chats?draft=<id>` for a group whose chat has not started); choosing a row in the sidebar moves that tab there. A window with no tab groups of its own starts on one new group, whatever app tabs it kept before. Everything else a window shows stands in a group: Apps, Activity, release notes, extensions, a file or a page reached at the window level opens as a tab in the group up, or in a new group when none is (`useTabGroupUpkeep`). Only the debug pages still take the app tab.
- **The group's tabs are the side pane's tabs, moved to the center.** `PaneTabs` draws them over the work, `GroupItem` draws the tab up under its address row. The sidebar toggle is the window frame's `corner`, laid over the window's top left, and whichever row reaches there while the sidebar is closed leaves it room. The chat column is `ChatScreen`, or `NewChatView` for a group whose chat has not started, sized by the share `RightPane` keeps and holding its width as the row changes, under `ChatTab` (`chat-tab.tsx`), which spans the column's top while it is open. The chat tab's menu is `ChatMenuItems` from `chat-header.tsx`, drawn through `MenuComponents` as a dropdown on its caret and as a context menu on a right-click. The strip's look is the `group-strip` utility: its own ground, and the tab up (`aria-selected`) or the shown chat tab (`data-joined`) taller, square at the foot and flared into the toolbar under it. The new tab is the `/new-tab` screen in a group (`isHomeTab`), drawn by `GroupItem` under the toolbar a page has (`TabLocationRow`, its field taking the caret as the tab comes up) as `GroupNewTab`, the places list. A group with no tabs is chat first: `GroupView` lets the conversation fill `RightPane` (`fills`) under a tab bar of + and `ChatTab`, a `TabLocationRow` standing on `{ kind: "newTab" }` with its arrows off, and the bookmarks bar, keeping one tree for it so the composer keeps its words as the chat moves, and opens the column again when it was closed. The chat-first composer's rows are `useComposerAddress`, around the omnibar's `useOmnibarRows` without the engine. A draft's composer attaches only the tab up (`draftItems` in `send-context.ts`). `closeTab` in `tab-model.ts` leaves a group with no tabs.
- **New state** is per device and lives in the `view` kept file: whether the sidebar is open, and which groups have their chat column closed. Each window's groups, in its order, are a list of chat ids and draft groups under `tab-groups.v1` in its own `window` kept file, and which group it shows is its app tab there. The keys main's build reads keep the shapes it reads. Nothing new is written to the workspace folder: a new group is a draft, written to `Drafts/` with the same fields as a new chat's once it has words or files, and closing a group writes nothing about its chat.
- **Multi-window.** A window's rows are its own list, matched to the chat list and the drafts; History is every chat and kept draft that no open window lists, which main reports through `window.live.tabGroupsElsewhere`. Choosing a group another window lists asks main to bring that window forward (`window.showInOtherWindow`, which reads the windows' lists as well as what they show) instead of opening it here too. A new window opened on tabs lists their groups; Shift-click on a row moves the group to a new window.
- **Dragging a tab out or to another window.** A group's tab drags the way a window tab does on main, through `tab-carry.ts`: pulled off its row (`useGroupTabCarry`, around `useTabCarry`) it shows a picture of the window at the pointer, and let go off every window it opens a spare window, which takes it into its own group in place of the new tab it came up on. Held over another window, that window works out where the tab would land (`useGroupTabLanding`) and tells main (`window.placeGroupTabCarry`): among the tabs of the group it shows, at the pointer, where it draws the tab; over the middle half of a sidebar row, which lights; or between two rows, where the list opens a room with a line, as a new group there. Anywhere else over that window the drag is free. The window the tab lands in makes the move itself (`receiveGroupTab`, through its own `make` and `moveTab`), and a page's guest follows with its history. A window whose one group is a chat not started yet, with this one tab, is main's window with one tab: the window goes with the tab, and closes once the tab lands in another. The only tab of a group whose chat has not started takes its group along, draft included, and the window it left lets go of the group. Over its own window's sidebar, a tab lands the same ways. Tab > Move Tab to New Window goes the way a tab let go in the open does.
- **Dragging rows and the sidebar's rooms.** One measure says where anything held over a sidebar lands (`sidebarDropAt` in `sidebar-drop.ts`): the room between two rows nearest it, as the rows are laid out, among the pinned rows or the rest, or for a tab, the row under it. The list draws the room by moving the rows past it aside, with a line across it (`sidebarDropAtom`), and a room something lands in shuts at once, the row standing where the room was. A row pressed and moved lifts out of the list (`useGroupRowDrag`), and let go lands at its place in the window's list (`listedWith`'s place), pinned or unpinned by its chat's star. Pulled well past the sidebar, the whole group goes through `tab-carry.ts` as a group's tab does, under its own key (`wholeGroupKey`) with every page tab's page, and the window it lands in lists it where it was let go and shows it.
- **Reopen closed tab.** A closed group tab goes on the window's own closed list (`recentlyClosed` in `app-tabs.v2`, as `groupTab`, standing on its group's address), the list main's Shift+Cmd+T reads, so a window closed since comes back first, by close time, and a blank new tab is passed over. Otherwise the newest tab whose group this window still has open comes back at its place in the group, up.
- **Caption buttons off the Mac.** While the window draws them, the frame sets `--caption-room`, and whichever row reaches the card's top right (the chat's head, or the tab bar while the column is closed or the chat fills the center) ends in a `CaptionRoom` spacer that wide.

### Where the prototype stands

Every phase in the order of work is built. What is rough or missing:

- **Dragging a row out of its window**, to a window of its own or another window's sidebar, was never checked: input sent to a window held off screen does not carry anything past its edge, a group's tab included. Dragging within the list, pinning and unpinning by drag, and a tab dropped between rows or onto one were checked in the app. The list does not scroll while a drag nears its top or bottom.
- **Dragging a tab out**: checked in a dev instance held off screen, so the picture at the pointer and a window following its only tab were never seen. A page carried to another window keeps its back history, though not every time: the history goes in alongside the page's reload (`moveTarget` in the browser view manager), as on main. A group's tab with a used page joins the other window and its page reloads, where main's window tab would take over that window's strip to keep the page live.
- **Reopen closed tab** works per window, the way a browser's does. A page comes back at its address in a fresh page, so its back and forward history is gone, as on main. The chord was never pressed in the app: it is a menu key equivalent, which input sent to a window held off screen does not reach.
- **Multi-window**: choosing a group another window has open asks main to bring that window forward, but the raise itself was never seen on screen. A window closed for good gives its groups back to History; one reopened with Shift+Cmd+T keeps a group another window has since opened only if it is the group it had up.
- **Windows and Linux**: the room for the caption buttons is a fixed 140px, checked only with the Mac's force-show toggle. Not run on either system. In the chat column's 300px it takes nearly half the chat tab's width.
- **Activity** has no button, as the plan says. Its chord (Cmd+Y) opens History, and Activity stays in the command menu.
- **The Apps dot** for an app signed out since Apps was last shown went with the rail.
- **The menu** names tab groups and the sidebar. The shortcut guide's Chats section still lists the old chat list's keys (Back to List, Next Chat in List), and the sidebar's search field is still labeled "Search chats" for screen readers.
- **A group whose chat has not started** is titled "New tab" until the chat column's composer has words.
- **The first message** of a new group was never sent in the app: the fixture workspace it was checked in has no model to send with, so a new tab closing as the chat starts is unseen.
- **Chat first** was checked in a dev instance held off screen. ⌘W, ⌘T and ⌘L are menu key equivalents, which input sent to such a window does not reach, so closing and opening tabs and reaching the field were checked by clicking. A group filed under a project, whose folder leads the new tab's places, was never opened.
- **The composer's address rows** show for a line of four words or fewer and 80 letters or fewer: the site, a search and pages from bookmarks and history, never the engine's suggestions. A path typed there stays words for the chat.
- **The chat tab's menu** has the head's items: Stop while the agent works, Show Chat Folder while the chat's folder has files beside its `CHAT.md`, Mark as read or unread, Star, Rename (in the tab), Project, Open in Files, Copy, Send feedback, Archive and Delete chat…. A new chat's has Project alone. Pop out went with the head. Show Chat Folder was never seen: the fixture workspace keeps its chats in the app's data, where a chat has no folder of its own.
- **Ask on a selection** stays, and in a group whose chat has not started, its "Add to new chat" still moves the comments into a new draft, which is a new group.
- **Rows** are in the window's own order: a new group, or one opened from History or search, lands at the top, under New, and stays there once its chat starts. A group whose chat has not started and whose draft has nothing is gone after a relaunch, since an empty draft is never written.
- **A row's menu** has the chat list's items for a chat: Open in New Window, Mark as read or unread, Pin, Rename, Project, Copy, and Close Tab Group. A group whose chat has not started has Open in New Window, Project and Close Tab Group. Neither has Delete or Archive.
- **Search and History** are per window and not kept; opening a group from History returns the sidebar to the list. History has no Delete; a chat's own menu still has one, and the chat tab's Archive still archives the chat and closes its group.
- **A file or link opened from outside** makes a new group every time, even when a group already shows that file.

Decisions the plan left open, taken from what the product does today:

- A new tab's field takes the caret whenever the tab comes up, and the chat's composer takes it whenever the chat fills the center.
- The chat tab spans the column's width while the column is open, and a press on it there closes the column.
- The strip is a darker shade of the card in dark mode and a light gray in light mode, and the tab up meets the toolbar with flared feet, as Chrome's does.
- A new chat's composer reads "Talk to Instrument", and its line over it is 1.0's "How can I help?". The glint crosses it again for each new chat that fills its group.
- The commands a chat left running show in the chat tab, before its caret.
- A chat's group whose tabs were all dragged to another window is chat first when it is next shown.
- Cmd+W's second press counts within three seconds.
- The sidebar resizes as the inbox did: its right edge drags it between 320 and 440 px, leaving the group at least 560, a drag under 240 slides it shut, and the toggle slides it in and out. It starts at 320 and keeps the width it is dragged to.
- A row dragged out of the window shows its group as it leaves, for the picture at the pointer, and the window goes back to the group it showed before; a window whose only group is dragged out starts a new one. A row's room is found by the row's top edge, a tab's by the pointer.
- A tab dropped as a new group in a project's list is not filed under the project.
- A dragged tab stays the one up, and the window follows it to its group, as a browser's tab dragged to another window does. A group whose chat has not started and that a drag leaves empty is thrown away.
- Shift-click on a row moves the group to a new window; shift-click on a link opens a new group, as the plan says.
- History is ordered by a chat's last message or reply, and a draft's last change.
- A chat open in another window shows in search with no close in its menu, since closing it is that window's to do.
- A tab asked for from inside a tab (a middle click, a Cmd-click, Open in New Tab, in Files or on a page of a group whose chat has not started) lands right after the tab up, and waits behind it when the gesture asks to, as a browser's link in a new tab does. A folder still opens in place.
