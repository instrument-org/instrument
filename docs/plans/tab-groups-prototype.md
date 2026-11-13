Status: open.

# Tab groups prototype

A throwaway prototype of a new window layout, on its own branch, for the two cofounders to use before anything about it is decided for the product. It replaces the current shell; it does not sit beside it behind a setting.

## The layout

- A left **sidebar of tab groups** replaces the app rail, the chat list and the window tab strip.
- The open tab group's **tabs** sit over the center, styled like today's side pane tabs (`pane-tabs.tsx`): attached to the content below them, not app-level window tabs.
- Under the tabs, a **toolbar**: sidebar toggle, back, forward, reload, then the address field. No dividers between them.
- The group's **chat** sits in a column on the right, joined to the work by a divider, open in every group with tabs and narrow until the divider is dragged. An X at the chat column's top right collapses it, and nothing else does: a tab added to a group whose chat had the whole card leaves the column open; collapsed, the chat is a "Chat" button with the bubble at the top right of the tab strip, and while the agent works that button shows only the app's working dots.
- A group with only a chat shows the chat full width with no tab row. Adding a tab moves the chat to the right; closing the last tab brings it back to full width.

The look is the app's current colors, type and components. Nothing is restyled beyond what the move needs.

## Scope: structural only

Build the structure, and nothing that doesn't already exist in the product. The chat is today's chat with its existing behavior: composer, model picker, transcript, asks, tasks. No suggestions, no generated follow-ups, no new AI features. Naming a group by AI when its tabs change is out of the first version; a group's title is its chat's title.

## Tab groups

- One chat per tab group. A group is a chat plus its tabs, so the chat's existing records are the group's records, and the tabs a chat already keeps (today's side pane tabs) are the group's tabs.
- **Sidebar rows** are two lines, the inbox's two-line row: the title with the time of the chat's last message, then the chat's latest line (the step it is on, the question it waits on, or its last reply), with the tabs' favicons at the line's right end in under half its width. A group whose chat has not started shows its tabs' favicons alone. A new tab has no favicon there. No chat icon on rows. Unread groups have a bold title. Starred becomes pinned: pinned rows sit above a plain divider.
- **New**: a "New" row with + at the bottom of the list, showing ⌘N. New groups are added at the bottom of the list. Once the list scrolls, "New" sticks to the bottom with a divider above it.
- **Projects** are listed at the top of the sidebar with no count. Opening one takes the sidebar over as today, with its banner, its groups and a back control, sliding in from the right and back out from the left, with the sidebar washed in the project's color. New project is a near-hidden + (or the right-click menu) on the Projects heading.
- **The sidebar's top row**: the notifications bell beside the traffic lights, the update pill at the right. No Activity button.
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

- Today's composer, centered and focused, so typing starts the chat. What is typed goes to the group's chat: a new group's chat starts, and in a group that has a chat the message goes to that chat and the chat column shows it. A URL typed there may open as a page, but that is optional.
- Under the composer, two buttons with their keys: **Browse ⌘L**, which puts the cursor in the toolbar's address field, and **Files ⌘O**, which turns the tab into the Files browser at the group's project folder, or the workspace when it has none.
- After a message is sent from a new tab, the empty tab closes and the chat takes its place.
- The tab strip's + is plain: no menu, no extra buttons beside it, no key shown.

## Shortcut keys shown

Keys show only on the new tab's Browse and Files buttons, on the sidebar's New row, and in the search field. Nowhere else: never beside an icon button, never on +, never in the address field.

## Closing

- ⌘W closes the current tab. ⌘W on a group with no tabs left closes the group, with a hint to press it again.
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

- **A tab group is a chat's tab group as the code already has it.** The window's tabs are grouped by `group` in `window-tabs.ts` (the `layout` kept file, shared by every window): a chat's group is its `ChatId`, a new chat's is its draft's (`draftGroupOf`). A tab group is one of those groups, with its chat in the column on the right. A group whose chat has not started is a draft's group: the chat column there is today's new chat composer, and its first message starts the chat and hands the draft's tabs to it (`handOverTabs`), closing the new tab on the way.
- **The window has one app tab.** The app tab strip and the rail are gone. Each window keeps one app tab (`appTabsAtom`), standing on the open group's address (`/chats/<id>`, or `/chats?draft=<id>` for a group whose chat has not started); choosing a row in the sidebar moves that tab there. A window with no tab groups of its own starts on one new group, whatever app tabs it kept before. Everything else a window shows stands in a group: Apps, Activity, release notes, extensions, a file or a page reached at the window level opens as a tab in the group up, or in a new group when none is (`useTabGroupUpkeep`). Only the debug pages still take the app tab.
- **The group's tabs are the side pane's tabs, moved to the center.** `PaneTabs` draws them over the work, `GroupItem` draws the tab up under its address row, which gains the sidebar toggle at its left. The chat column is `ChatHeader` and `ChatScreen`, sized by the pane share `RightPane` already keeps. The new tab is the `/new-tab` screen in a group (`isHomeTab`), drawn by `GroupItem` as the composer with Browse and Files.
- **New state** is per device and lives in the `view` kept file: whether the sidebar is open, and which groups have their chat column closed. Each window's groups, in its order, are a list of chat ids and draft groups under `tab-groups.v1` in its own `window` kept file, and which group it shows is its app tab there. The keys main's build reads keep the shapes it reads. Nothing new is written to the workspace folder: a new group is a draft, written to `Drafts/` with the same fields as a new chat's once it has words or files, and closing a group writes nothing about its chat.
- **Multi-window.** A window's rows are its own list, matched to the chat list and the drafts; History is every chat and kept draft that no open window lists, which main reports through `window.live.tabGroupsElsewhere`. Choosing a group another window lists asks main to bring that window forward (`window.showInOtherWindow`, which reads the windows' lists as well as what they show) instead of opening it here too. A new window opened on tabs lists their groups; Shift-click on a row moves the group to a new window.
- **Tearing a tab out.** A group's tab let go past the window's edge (`isOffWindow` in `tab-pull.ts`) becomes a new group at the bottom of the list, and main opens a window at that group under the pointer (`group-tab-pull.ts`, placed by `boundsAtRelease`) and hands a page's guest to it. The window it left stays on its group. While the tab is off the window, a small picture of the window follows the pointer, as the old strip's torn-off tab had. Tab > Move Tab to New Window does the same for the tab up.
- **Reopen closed tab.** Each window keeps its last 25 closed group tabs. Shift+Cmd+T brings back a window closed since, else the newest tab whose group is still open, at its place in the group, up.
- **Caption buttons off the Mac.** While the window draws them, the frame sets `--caption-room`, and whichever row reaches the card's top right (the chat's head, or the tabs while the chat is collapsed) ends in a `CaptionRoom` spacer that wide.

### Where the prototype stands

Every phase in the order of work is built. What is rough or missing:

- **Tearing a tab out**: the picture that follows the pointer was never seen, since the dev instance it was checked in ran off screen. Letting go over another window opens a new window too, since that window's sidebar takes no drop from this one. Tearing out the only tab of a group whose chat has not started moves that group to the new window.
- **Reopen closed tab** works per window, the way a browser's does. A page comes back at its address in a fresh page, so its back and forward history is gone.
- **Multi-window**: choosing a group another window has open asks main to bring that window forward, but the raise itself was never seen on screen. A window closed for good gives its groups back to History; one reopened with Shift+Cmd+T keeps a group another window has since opened only if it is the group it had up.
- **Windows and Linux**: the room for the caption buttons is a fixed 140px, checked only with the Mac's force-show toggle. Not run on either system.
- **Activity** has no button, as the plan says. Its chord (Cmd+Y) opens History, and Activity stays in the command menu.
- **The Apps dot** for an app signed out since Apps was last shown went with the rail.
- **The menu** names tab groups and the sidebar. The shortcut guide's Chats section still lists the old chat list's keys (Back to List, Next Chat in List), and the sidebar's search field is still labeled "Search chats" for screen readers.
- **A group whose chat has not started** is titled "New tab" until its composer has words. Its chat column shows the new chat composer once it has a tab other than a new tab; with only new tabs it has no column and no Chat button, since the new tab's composer starts the chat.
- **Rows** are in the window's own order: a new group, or one opened from History or search, lands at the bottom and stays there once its chat starts. A group whose chat has not started and whose draft has nothing is gone after a relaunch, since an empty draft is never written.
- **Search and History** are per window and not kept; opening a group from History returns the sidebar to the list. History has no Delete; a chat's own menu still has one, and the chat head's Archive still archives the chat and closes its group.
- **A file or link opened from outside** makes a new group every time, even when a group already shows that file.

Decisions the plan left open, taken from what the product does today:

- The chat column's composer leaves the caret to the group's work while the group has tabs; a chat-only group's composer takes it.
- Cmd+W's second press counts within three seconds.
- The sidebar resizes as the inbox did: its right edge drags it between 320 and 440 px, leaving the group at least 560, a drag under 240 slides it shut, and the toggle slides it in and out. It starts at 320 and keeps the width it is dragged to.
- A dragged tab stays the one up, and the window follows it to its group, as a browser's tab dragged to another window does. A group whose chat has not started and that a drag leaves empty is thrown away.
- Shift-click on a row moves the group to a new window; shift-click on a link opens a new group, as the plan says.
- History is ordered by a chat's last message or reply, and a draft's last change.
- A chat open in another window shows in search with no close in its menu, since closing it is that window's to do.
- A tab asked for from inside a tab (a middle click, a Cmd-click, Open in New Tab, in Files or on a page of a group whose chat has not started) lands right after the tab up, and waits behind it when the gesture asks to, as a browser's link in a new tab does. A folder still opens in place.
