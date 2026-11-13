Status: open.

# Tab groups prototype

A throwaway prototype of a new window layout, on its own branch, for the two cofounders to use before anything about it is decided for the product. It replaces the current shell; it does not sit beside it behind a setting.

## The layout

- A left **sidebar of tab groups** replaces the app rail, the chat list and the window tab strip.
- The open tab group's **tabs** sit over the center, styled like today's side pane tabs (`pane-tabs.tsx`): attached to the content below them, not app-level window tabs.
- Under the tabs, a **toolbar**: sidebar toggle, back, forward, reload, then the address field. No dividers between them.
- The group's **chat** sits in a column on the right, joined to the work by a divider. An X at the chat column's top right collapses it; collapsed, the chat is a "Chat" button with the bubble at the top right of the tab strip, and while the agent works that button shows only the app's working dots.
- A group with only a chat shows the chat full width with no tab row. Adding a tab moves the chat to the right; closing the last tab brings it back to full width.

The look is the app's current colors, type and components. Nothing is restyled beyond what the move needs.

## Scope: structural only

Build the structure, and nothing that doesn't already exist in the product. The chat is today's chat with its existing behavior: composer, model picker, transcript, asks, tasks. No suggestions, no generated follow-ups, no new AI features. Naming a group by AI when its tabs change is out of the first version; a group's title is its chat's title.

## Tab groups

- One chat per tab group. A group is a chat plus its tabs, so the chat's existing records are the group's records, and the tabs a chat already keeps (today's side pane tabs) are the group's tabs.
- **Sidebar rows** are two lines: the title, then the state in words (working, waiting) or the tabs' favicons. A chat-only group's second line says "Chat". No chat icon on rows. Unread groups have a bold title. Starred becomes pinned: pinned rows sit above a plain divider.
- **New**: a "New" row with + at the bottom of the list, showing ⌘N. New groups are added at the bottom of the list. Once the list scrolls, "New" sticks to the bottom with a divider above it.
- **Projects** are listed at the top of the sidebar with no count. Opening one takes the sidebar over as today, with its banner, its groups and a back control. New project is a near-hidden + (or the right-click menu) on the Projects heading.
- **The sidebar's top row**: the notifications bell beside the traffic lights, the update pill at the right. No Activity button.
- **The sidebar's footer**: the account and Settings at the bottom left, with a Help menu (a ? button) that holds feedback, laid out for the sidebar's width rather than the old thin rail.
- **Search** sits at the top of the list, showing ⇧⌘F. It shows open groups first, then History below a line. History sits beside search and lists closed groups; restoring one is an explicit action.
- Every window lists every tab group. A group is open in one window at a time; choosing it in another window brings that window forward.
- On first launch, the chats in today's inbox are the open tab groups and archived chats are History. Nothing on disk changes for this.

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
- A closed group goes to History, which is today's archive.

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
- **The window has one app tab.** The app tab strip and the rail are gone. Each window keeps one app tab (`appTabsAtom`), standing on the open group's address (`/chats/<id>`, or `/chats?draft=<id>` for a group whose chat has not started); choosing a row in the sidebar moves that tab there. Window tabs restored from before collapse into the one up when the window opens. Screens that are not a group's (Apps, Activity, release notes) still open in that app tab, in place of the group, until a row is chosen.
- **The group's tabs are the side pane's tabs, moved to the center.** `PaneTabs` draws them over the work, `GroupItem` draws the tab up under its address row, which gains the sidebar toggle at its left. The chat column is `ChatHeader` and `ChatScreen`, sized by the pane share `RightPane` already keeps. The new tab is the `/new-tab` screen in a group (`isHomeTab`), drawn by `GroupItem` as the composer with Browse and Files.
- **New state** is per device and lives in the `view` kept file: whether the sidebar is open, and which groups have their chat column closed. Which group a window shows is its app tab, in the `window` kept file. Nothing new is written to the workspace folder: a new group is a draft, as a new chat with a page beside it is today, and a closed group is an archived chat.
- **Multi-window.** Every window lists every group, read from the chat list and the drafts. Choosing a group another window shows asks main to bring that window forward (`window.showInOtherWindow`) instead of opening it here too.

### Where the prototype stands

Every phase in the order of work is built. What is rough or missing:

- **Tearing a tab out into its own window** is missing. The group's tabs are the side pane's tabs, which never could, and dragging between windows belonged to the app tab strip, which is gone. A row's menu opens the whole group in a new window.
- **Reopen closed tab** is unverified for a group's tabs. The app tab strip's closed tabs menu went with the strip.
- **Windows and Linux**: the caption buttons sit over the card's top right, and what is under them (the Chat button, the chat column's X) does not move left yet. Not run on either system.
- **Activity** has no button, as the plan says. Its chord (Cmd+Y) opens History, and Activity stays in the command menu.
- **The Apps dot** for an app signed out since Apps was last shown went with the rail.
- **The menu** still calls Cmd+N "New Chat"; renaming it moves the menu, shortcut guide and their tests.
- **A group whose chat has not started** is titled "New tab" until its composer has words, and its chat column starts closed; with only a new tab up it has no Chat button, since the new tab's composer starts the chat.
- **Rows** follow the chat list's order, oldest first, with groups whose chat has not started after them, so a new group lands at the bottom and stays there once its chat starts.
- **Search and History** are per window and not kept; restoring a group returns the sidebar to the list.

Decisions the plan left open, taken from what the product does today:

- The chat column's composer leaves the caret to the group's work while the group has tabs; a chat-only group's composer takes it.
- Cmd+W's second press counts within three seconds.
- A dragged tab stays the one up, and the window follows it to its group, as a browser's tab dragged to another window does. A group whose chat has not started and that a drag leaves empty is thrown away.
- Shift-click on a row opens the group in a new window; shift-click on a link opens a new group, as the plan says.
