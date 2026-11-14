Status: open.

# Two sides prototype

The tab groups prototype rebuilt as a browser of two sides: every tab is a page with an address, a chat included, and a tab group shows one side of tabs or two. It follows the cofounders' 11-13 review of the tab groups prototype and the built-in apps wireframes. The build with one chat per group, its chat pinned to the right, is kept at the tag `tab-groups-one-chat-per-group` for comparison. Where this plan and `tab-groups-prototype.md` disagree, this one wins, and code of the earlier build that fights it goes.

Page contents can stay rough. What has to be right is the layout engine, dragging and dropping, and moving things around.

## The model

- A window lists its **tab groups** down the sidebar, in its own order, as the earlier build does.
- A group has **one or two sides**. A side is an ordered list of tabs with one tab up. One side of the group has the keyboard.
- **Every tab is a page with an address**: a website, a folder or a file in Files, a chat, a new chat (the zero state), or a built-in page (Settings, Memory, Skills, History, Activity, Apps). A chat is an ordinary tab: a group holds any number of chats, on either side, in any order, and nothing is pinned anywhere.
- Only two sides, ever. A third thing joins a side's tabs.
- **A side never shrinks to nothing.** The gutter between the sides resizes them and stops at each side's minimum width. Closing a side's last tab leaves the other side as the whole group.
- **Below the minimum width** the group's sides need, the group scrolls sideways instead of squeezing them.
- A group's sidebar row: the typed name, else the title of its first chat (the left side first, then in tab order), else the title of the tab up on the side with the keyboard. Its second line is that chat's latest line, as today. Its marks are every tab's, in order. Pins and names are the group's own.
- **History** is every chat no window has a tab on, and every kept draft. Opening one from History opens a new group with that one tab, as today.

## Opening things, with no magic placement

- A click opens in place, where Back returns, or as a new tab right after the tab it came from, in the same side. Nothing opens in the other side unless the person asks for it: Open in Split, Open Link in Split, Move to Other Side, or a drag. Nothing ever hops to the other side by itself, and no card moves when something opens.
- A link in a chat opens as a browser opens a link to a new tab: right after the chat's tab, in its side, up. ⌘-click leaves it behind. A page the chat's agent opens itself goes right after the chat's tab too, behind it, so the chat stays in view and the tab shows the working mark.
- **+ and ⌘T** always open a new chat (the zero state) as a new tab after the tab up, in the side with the keyboard.
- **⌘N** always makes a new group: one side, one new chat, at the top of the list under New.
- **Every tab's menu can open a chat beside it** (New Chat in Split), so a group of only websites is one click from the AI.

## The new chat, which is the new tab

A new tab is the chat zero state inside a browser's chrome: the toolbar with the address field reading as Chat (its app chip), the bookmarks bar with Files first, and today's new-chat composer at the middle under them. Typing an address in the field and pressing Enter goes there in this tab, and Back comes back to the new chat. Sending a message makes this tab the chat, in place. Each new chat is its own draft; one that is never typed in leaves nothing behind.

## A side's chrome

Each side is a card of the window's, with its own head:

1. its row of tabs, ending in +;
2. its toolbar: back, forward, reload, then the address field, ending in the star;
3. the bookmarks bar, Files first, with the chevron beside Files that the earlier build added;
4. what the tab up shows.

A chat tab has the same chrome as any tab. Its address field reads as the Chat chip and its title; Back from a chat's first visit does nothing, and a page opened in place from a chat goes back to it.

**The address field** leads with an app chip for every built-in page and for a chat (Chat, Files, Settings, Memory, Skills, History, Activity, Apps) with the page's own words after it. The full `instrument://` address shows only while the field has the caret. A website shows its URL as today. Addresses use the link forms the app already opens (`instrument://chat/<id>`, `instrument://file/<path>`, `instrument://screen/<name>`), extended for the built-in pages.

**The star** at the end of every address keeps the tab as a bookmark, a chat's and a folder's included, and ⌘D does the same. Its menu puts the bookmark on the bookmarks bar or in the sidebar's Bookmarks, renames it, or removes it.

## Built-in pages

Settings, Memory, Skills, History, Activity and Apps are tabs with addresses, opened from the address field by name, from the bookmarks bar, from the sidebar's corner (Settings) and from links. Each must work at half width: a built-in page narrower than 640px folds its own sidebar to a rail of icons, as Files folds its places. Each part of Settings has its own address. Memory and Skills leave Settings for pages of their own. History is the page the sidebar's History row opens. Settings open beside a chat while the agent changes a setting is the case to get right.

## Menus are the main way to make and manage splits

For now every split is made and managed from right-click menus, the same items wherever they apply:

- **A tab**: Open in Split (a copy on the other side) or Move to Other Side, New Chat in Split, Move to New Tab Group, Move to New Window, Duplicate, Bookmark, Close, Close Other Tabs, Close Tabs to the Left, Close Tabs to the Right.
- **A link** (in a page, in a chat, a file or folder in Files): Open Link in Split, Open in New Tab, Open in New Tab Group, Open in New Window, Bookmark.
- **A sidebar row**: Open in New Window, Duplicate, Rename, Pin, the Close items.
- **A bookmark**: Open, Open in Split, Open in New Tab, Open in New Tab Group, Open in New Window, Rename, Move to the Bar or the Sidebar, Delete.

A shortcut and on-screen controls for splitting come later.

## Dragging and dropping, through one system

One drag system carries everything that can be held, and every place that takes a drop answers through it, so hover states, drop marks and what rides on the cursor agree everywhere.

- **Held**: a tab, a group (its sidebar row), a bookmark, and files (from Files or from the Finder).
- **Landings**:
  - a side's tab row, between two tabs;
  - a side's page: with one side, the left or right half lights and letting go makes that half a side holding the tab; with two, the side under the pointer lights and takes it as its last tab;
  - a sidebar row (joins that group) or the room between two rows (a new group there);
  - the bookmarks bar, between two bookmarks, and the sidebar's Bookmarks (keeps it as a bookmark there);
  - a web page, for files only: the page gets the files as if dropped from the Finder;
  - another window, and the open desktop (a new window).
- **Moves**: tabs within a side, between sides, between groups and between windows; rows within the list and between windows; bookmarks along the bar, off it (removed, with Undo in a toast) and back on; files onto tabs, rows, sides and web pages.
- **What shows on the way says what letting go does**: tab-shaped over a tab row, with the others making room; nothing at the pointer over a row it joins, the row lit; a row standing in a room; the half or side it would take lit; a bookmark standing on the bar; the window's picture only off every window. The earlier build's rules for rows, rooms and files stand, and the rest are made to match them.

## A chat knows the tabs around it

- With each message the chat's agent gets its group's layout: the sides, their tabs in order with kind, title and address, which tab is up on each, which side has the keyboard, and which tab is this chat.
- Each message also carries what changed since the chat's last message: tabs opened, closed, moved within or between sides or groups, and navigated, and this chat's own moves.
- In the transcript it shows minimally. How to show it stays open.

### How it's built

- **Two parts on the user's message.** `data-groupLayout` is a state part (`LayoutSnapshot`, `schemas/group-layout.ts`): stored on every message, said to the model only when its text differs from the last one said, and not at all while the group is the chat alone and nothing else was ever said. `data-layoutChanges` is an event part, said once, present only when something changed. Both sit after the view context in the notes' order. The view context is left as it was; a change list inside it would make every change re-say the whole screen. No system prompt line: the notes say what they are.
- **The diff is pure.** `layoutChanges(before, after, elsewhere?)` in `lib/group-layout.ts` names closed and moved-out tabs first, then each tab of the new layout in order: opened or moved in, moved between sides, moved within its side (tabs outside the longest run that kept its order), navigated. A different group id is the chat moving groups, said alone. When one side becomes two, the side sharing more tabs goes on, the left on a tie; when two become one, the side that gave more tabs. `layoutChangesLine` is the person's line ("Opened Zendesk pricing beside this chat").
- **The window reads and keeps it.** Only the window knows which other group a tab went to, so the diff runs in the renderer. `group-awareness.ts` is the one place that reads today's model (`todaysGroupLayout`: the work's tabs as one side and the chat as the other, the chat alone as one side, the chat after the tabs while its card is closed; new tabs left out) and Core's `groupLayoutOf(state, group)` takes its place. What each group was last sent is kept in memory per window, so a relaunch sends the layout with no changes; a draft's record carries over to the chat its first message starts. The press reads it in `task/chat.tsx` and `use-drafts.ts` and sends it as `layout` on `message.create`.
- **The transcript** draws `data-layoutChanges` as one dim line over the person's message; the layout itself is a developer's note.
- **Checked by** `group-layout.test.ts` (the diff, `it.each` over a line notation), `group-layout-model-text.test.ts` (the notes), `group-awareness.test.tsx` (today's reading), the model-text byte snapshots, and the eval `group-layout-beside` (`layout` on a case or follow-up sends the parts with no window behind them).

## Left open

Not built: projects beyond today's behavior, sidebar row rules beyond the basics, tasks as tabs, other AIs' sign-in doubling as model access, release notes and pages with actions, and the writing-tool idea.

## Tracks

The build is split into tracks that land on the prototype branch one at a time:

1. **Core**: the model (groups of one or two sides, every tab a page, a chat as an ordinary tab, any number of chats), the layout engine (sides, gutter, minimum widths, scrolling), the new chat as the new tab, opening rules, removing the pinned chat column and the earlier build's chat-first layout, and the tab menu's split items.
2. **Address**: app chips, the `instrument://` address on the caret, the star and its menu, ⌘D, bookmarks of any address, the sidebar's Bookmarks.
3. **Pages**: Settings as a tab with addressable parts, Memory, Skills, History, Activity and Apps as pages, folding at half width.
4. **Awareness**: the layout and its changes in each message, read by the agent, shown minimally.
5. **Drag**: one drag system for everything above.
6. **Menus**: the menus above everywhere they apply.

## How it's built

### Address

Paths are under `apps/studio/src/`.

- **Addresses**: `instrumentAddressOf(tab)` (`client/bookmarks/address.ts`) gives any tab's address: a site's URL, a file or folder as `instrument://file/<path>`, a chat as `instrument://chat/<id>`, a built-in page as `instrument://screen/<name>`, its names read from `shared/instrument-screens.ts`. `targetOfAddress` reads one back, and `sameAddress` compares two, so a trailing slash or an escaped character finds the same bookmark.
- **Opening**: `useOpenAddress()` (`client/bookmarks/open-address.ts`) opens any address here, in a new tab behind, or as a new tab group, and `openHowOf` reads which from a click (⌘ a new tab, ⇧ a new tab group). A chat is its own tab group, so ⇧ opens it in its own window, and a screen a group's tab cannot stand at opens where the app keeps it.
- **The field**: `TabLocationRow` takes the tab's `address` and `title`. The chip is `AppChip` (`client/components/window/app-chip.tsx`), picked by the location's kind in `tab-location.ts`: `builtin` for a built-in page, `chat`, and `newChat`. The omnibar shows the address while it has the caret, opens a typed `instrument://` address on Enter, and offers built-in pages, chats and the app's own bookmarks as rows from two letters of a name, first when the name is typed whole. A chat's field runs in web mode; the field has no Chats mode.
- **The star**: `BookmarkStar` (`bookmark-star.tsx`) and its card. ⌘D is the window command `bookmarkTab`, in the Bookmarks menu, and `requestBookmarkTab()` presses the visible star with the most ancestors in common with the focused element, so each side's row answers for its own side. A code editor keeps ⌘D.
- **Bookmarks**: each has a place, `bar` or `sidebar` (`placeOf` and the `place` op in `shared/bookmarks.ts`); one with no `where` is on the bar. The bar (`bookmarks-bar.tsx`) shows the bar's, and `BookmarksSection` (`bookmarks-section.tsx`, one line in `group-sidebar.tsx`) the sidebar's under Projects. Both open through `bookmarkClicks` and share `BookmarkContextMenu` (`bookmark-menu.tsx`), and each wears its tab's mark (`AddressMark`).
- **For other tracks**: `useBookmarkActions()` (`client/bookmarks/actions.ts`) gives `bookmark({ title, url, where })`, `isBookmarked(url)`, `bookmarkOf(url)`, `place`, `rename` and `remove`, and re-exports `instrumentAddressOf`. A tab's or a link's Bookmark item is `bookmark({ title, url: instrumentAddressOf(tab) })`.
- **One mapping**: the href-to-address mapping belongs in `shared/instrument-screens.ts`. `addressOfHref` and `screenNameOfHref` in `address.ts` stand in for it until it is there, and `address.ts` keeps only the tab-level layer over it: sites, files and folders.

### Pages

- **Every built-in page is a row of `SCREENS`** (`shared/instrument-screens.ts`): its name, title, address and what it is for, which the product guide lists for the agent. `instrumentAddressOf` gives a tab's `instrument://` address from it: `instrument://screen/<name>` for Activity, Apps, Files, History, Memory, Skills and the rest, `instrument://settings/<part>` for a part of Settings. `screenOfHref` reads an address back to its page and part, and `ScreenIcon` (`screen-presentation.tsx`) is each page's mark, so the tab strip, the address row and the address field name a page the same way.
- **Settings is a tab** at `/settings/<part>`, one address per part in `SETTINGS_SECTIONS` (`general`, `account`, `providers`, `permissions`, `storage`, `activity`, `developer`), and `/settings` goes to General. All of Settings is one tab (`tabIdentity`), so asking for it brings the one open forward and walks it to the part asked for (`bringForwardShowing` in `built-in-pages.tsx`). A name that is not a part (`/settings/theme`) is a setting's link, which the route sends to the setting's part with its row lit. What an address asks of the page once (a row to light, a memory to show, the account's usage, the diagnostic log) the page takes and drops from its address (`useArrivingAsk`), so going back never asks it again; the search's words stay in it as `q`.
- **Opening a page.** `openSettings` and `openBuiltInPage` put a request in `pageRequestAtom`, and each window's `BuiltInPageOpener` brings the page forward in the group up, or opens it as a new tab after the tab up. The sidebar's Settings, ⌘,, links into Settings, the command menu's Settings, Memory, Skills and History rows, the sidebar's History row and ⌘Y all go through it. There is no Settings dialog.
- **Memory and Skills** are pages of their own (`/memory`, `/skills`): the sections Settings had, in `BuiltInPage`. Settings' search still finds them and opens them in its tab, and their old links (`instrument://settings/memory`, `memory-import`, `new-skill`) open them.
- **History** is `/history`, its search in `q` (`HistoryPage`): every chat and kept draft no window lists, by day, as the sidebar's History view had them. Opening one opens it as a group of its own and the window moves to it, leaving the History tab where it was.
- **Half width.** Under `PAGE_FOLD_PX` (640), measured on the page itself (`useIsNarrower`), a page folds what it keeps beside its content. Settings' sidebar becomes a rail of the parts' icons, each naming itself on hover, its search opening over the part from the rail's magnifier. Activity's details open under the row picked, and its search and filters go under its title. Memory, Skills and History are one column whose padding follows a container query. Apps already lays out by container query, and Files folds its places at its own 576px.
- **Live values.** Every part reads its preferences and lists through live queries, so Settings beside a chat shows a setting changed elsewhere as it changes.

### Where Pages stands

- Checked in a dev instance held off screen, each page beside a chat (596px) and with the chat's card closed (904px). ⌘, and ⌘Y are menu key equivalents, which input sent to such a window does not reach, so the chords were never pressed; what they call was.
- The agent has no tool that changes a setting, so the live case was checked by changing one through the preferences route while Settings stood beside the chat. The fixture workspace has no memories, so the Memory page was seen only empty.
- Files folds at 576px where every other page folds at 640, and to a panel over the folder where Settings folds to a rail.
- Activity's rows and details show a built-in page with the generic screen mark, not the page's own.
