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
- A link in a chat opens as a browser opens a link to a new tab: right after the chat's tab, in its side, up. ⌘-click leaves it behind. A page the chat's agent opens itself goes right after the chat's tab too, behind it, so the chat stays in view and the tab shows the working mark. It stays after the turn ends, until someone closes it. A blank page the agent starts in or asks for gets its tab only once it goes somewhere, so no blank tab shows in the strip. A tab the person opened stays theirs: the agent goes to another page in it only when asked to and given its id, and every other page it opens gets a tab of its own.
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
- **A link** (in a page, in a chat, in a file shown in a tab): Open Link in Split, Open Link in New Tab, Open Link in New Tab Group, Open Link in New Window, Bookmark Link, Copy Link. A page's menu, and a file's, start with Open Link, which opens the link in place; a chat's has no plain Open, since a click there opens the link in a new tab beside the chat. A file or folder in Files, or a file chip in a chat, keeps a file's words (Open in Split, Add to Bookmarks).
- **A sidebar row**: Open in New Window, Duplicate, Rename, Pin, the Close items.
- **A bookmark**: Open, Open in Split, Open in New Tab, Open in New Tab Group, Open in New Window, Rename, Move to the Bar or the Sidebar, Delete.

⌘\ moves the tab up to the other side (Open in Split for a side's only tab). On-screen controls for splitting come later.

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
- **The window reads and keeps it.** Only the window knows which other group a tab went to, so the diff runs in the renderer. `group-awareness.ts` reads a group through Core's `groupLayoutOf` (`groupLayoutFor(window, group, chatTab)`): the tab the message goes from is this chat, its side has the keyboard, and the group's other new chats are left out, with any side they leave empty. What each chat was last told is kept in memory per window, by the chat rather than its group, since two chats can share a group, so a relaunch sends the layout with no changes; a draft's record, kept under its group key, carries over to the chat its first message starts. The press reads it by the sending tab (`shell.layoutContext(tabId, told)`) in `task/chat.tsx` and `use-drafts.ts` and sends it as `layout` on `message.create`.
- **The transcript** draws `data-layoutChanges` as one dim line over the person's message; the layout itself is a developer's note.
- **Checked by** `group-layout.test.ts` (the diff, `it.each` over a line notation), `group-layout-model-text.test.ts` (the notes), `group-awareness.test.tsx` (the reading), the model-text byte snapshots, and the eval `group-layout-beside` (`layout` on a case or follow-up sends the parts with no window behind them).

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

### Core

Paths are under `apps/studio/src/client/components/window/` unless named.

- **The model** (`tab-model.ts`): `WindowTabs` is one list of tabs across the window's groups, each naming its `group`, with `activeByGroup` (the tab up on the side with the keyboard) and `besideByGroup` (the tab up on the other side). A tab on the right side says `side: 1`, and `normalizeSides` turns a group with every tab on one side back into one side. `groupLayoutOf(state, group)` reads a group's sides, each its tabs in strip order and the one up, and which side has the keyboard; `useWindowTabs().layoutOf` is the same from React. `besideOf`, `sideIndexOf`, `chatsOfGroup`, `chatPlaceOf` (the group and tab a chat is in, the group on screen first) and `chatUpIn` read the rest.
- **Group keys are opaque.** A new group is `group:<uuid>`; keys an earlier build kept (a chat's id, `draft:<id>`, `site:`, `page:`) stay as they were, and nothing reads a chat or a draft out of a key. A group's address is `/chats?group=<key>`. `/chats/<id>` and `/chats?draft=<id>` asked of the window are requests to show that chat or draft: `showChat` and `showDraft` (`tab-groups.ts`) bring up the tab showing it, or open it as a group of its own.
- **Every tab is a page with an address.** A chat is a screen tab at `/chats/<id>` (`GroupChatScreen`, `chat-tab-screens.tsx`). A new tab is a new chat at `/chats` (`GroupNewChatScreen`), at `/chats?draft=<id>` once it has words, and sending walks that tab to the chat in place (`use-drafts.ts`). An address typed into a new chat's composer opens in its tab, so Back returns to the zero state.
- **Kept state** is `window-tabs.v11/<group>`, one member per group: `{ active?, beside?, tabs }`. `carryEarlierGroups` (`window-tabs.ts`) carries each v10 group once: a chat's or a draft's group gets the chat's or the new chat's tab, on a right side with the keyboard while its card was open, last on its one side while closed. Upkeep (`upkeptList`, `tab-groups.ts`) gives a listed group with no tabs its chat's tab, or a new chat when its draft is there or it is named or pinned, so a group with a name or a pin is never dropped; the earlier build left a group of only a name or a pin with no draft on disk. That build pinned a chat's group by the chat's star: once, as the chats first load, every listed group keyed by a starred chat's id gets a pin (`pinnedFromStars`), marked done in `tab-groups-star-pins-carried.v1` so a group unpinned since stays unpinned.
- **One function opens, one moves.** `openInGroup` and `windowTabs.openIn` place a tab by `{ after, group, side }` and `select`; `moveTabTo` and `windowTabs.moveTo` move one between sides, groups or places in a strip. `focusSide` gives a side the keyboard and `raiseTab` brings a tab up on its side. The caret goes with the keyboard on every path: the side's home takes it (`keyboard-home.ts`; a file's is its editor or its view), nothing on the other side takes it as it comes up, and a caret left there counts as on nothing, its selection dropped so dictation lands nowhere rather than in that side's composer. The openers (`use-openers.ts`) choose `after`: a click opens in place or right after its source on the same side; a chat's link right after the chat's tab, up, or behind on ⌘-click; + and ⌘T a new chat right after the tab up on the keyboard's side; ⌘N a new group; a page an agent opens right after the chat's tab, behind.
- **The layout engine** (`GroupSides`, `group-view.tsx`) draws a card per side, each with its own head: the strip and its + (`pane-tabs.tsx`), then the toolbar on every tab, chats included, and the bookmarks bar (`group-item.tsx`). Two sides split by a share kept per group, dragged at the gutter and snapping to half within `SIDE_SNAP_PX` (15). A side is never narrower than `SIDE_WIDTH_MIN` (440, wider than the layout research's 300, since a chat's composer and a page's toolbar both crowd below it); below that the group scrolls sideways, and the browser pool clips each guest to the scroller (`data-guest-clip`, `clipInset` in `client/lib/browser-pool.ts`). A page moving sides keeps its guest.
- **Closing.** A side's last tab closing leaves the other side as the group, the x on a one-sided group's last tab closes the group, and ⌘W there asks for a second press. Closing the window's last group makes a new one.
- **The composer's chip** is the tab up on the other side (`besideOf` into `chatContextItems`, `context-items.ts`): a page, a file or an app as before, and another chat as that chat, by its title. A message's list of its group's tabs (`send-context.ts`) leaves out chat and new chat tabs.
- **Sidebar rows** (`group-sidebar.tsx`, `tab-groups.ts`): a row's title is its typed name, else its first chat's title, the left side first, else the title of the tab up on the keyboard's side; its second line is that chat's latest line, and its marks are every tab's. Starring a chat does not pin its group.
- **The tab menu** (`PaneTabMenu`, `pane-tabs.tsx`): Open in Split, Move to Other Side, New Chat in Split, Move to New Tab Group, Move to New Window, Duplicate, Close, Close Other Tabs, Close Tabs to the Left and to the Right.

### Where Core stands

- Checked in a dev instance: the zero state, a chat opened from History, New Chat in Split, an address typed into a new chat, Move to Other Side keeping the page, two chats side by side, and a narrow window scrolling sideways. Drags were driven only by synthetic events. Kept state was carried from v10 only from a fixture workspace set up in the earlier build, not from a real workspace.
- A chat's tab shows the bookmarks bar only while there are bookmarks, as a page's does, and a new chat always shows it, so the head changes height between them. A chat's toolbar has no reload.

### Address

Paths are under `apps/studio/src/`.

- **Addresses**: `addressOfTab(tab)` (`client/bookmarks/address.ts`) gives any tab's address: a site's URL, a file or folder as `instrument://file/<path>`, and anything else the app shows as `instrumentAddressOf(href)` in `shared/instrument-screens.ts` names it (a chat as `instrument://chat/<id>`, a built-in page as `instrument://screen/<name>`, a part of Settings as `instrument://settings/<part>`). `targetOfAddress` reads one back, and `sameAddress` compares two, so a trailing slash or an escaped character finds the same bookmark.
- **Opening**: `useOpenAddress()` (`client/bookmarks/open-address.ts`) opens any address here, in a new tab behind, on the other side of the group on screen, or as the first tab of a new tab group or a new window, and `openHowOf` reads which from a click (⌘ a new tab, ⇧ a new tab group). A screen a group's tab cannot stand at opens where the app keeps it.
- **The field**: `TabLocationRow` takes the tab's `address` and `title`. The chip is `AppChip` (`client/components/window/app-chip.tsx`), picked by the location's kind in `tab-location.ts`: `builtin` for a built-in page, `chat`, and `newChat`. The omnibar shows the address while it has the caret, opens a typed `instrument://` address on Enter, and offers built-in pages (`builtInPages()` in `shared/instrument-screens.ts`, each part of Settings among them), chats and the app's own bookmarks as rows from two letters of a name, first when the name is typed whole. A chat's field runs in web mode; the field has no Chats mode.
- **The star**: `BookmarkStar` (`bookmark-star.tsx`) and its card. ⌘D is the window command `bookmarkTab`, in the Bookmarks menu, and `requestBookmarkTab()` presses the visible star with the most ancestors in common with the focused element, so each side's row answers for its own side. A code editor keeps ⌘D.
- **Bookmarks**: each has a place, `bar` or `sidebar` (`placeOf` and the `place` op in `shared/bookmarks.ts`); one with no `where` is on the bar. The bar (`bookmarks-bar.tsx`) shows the bar's, and `BookmarksSection` (`bookmarks-section.tsx`, one line in `group-sidebar.tsx`) the sidebar's under Projects. Both open through `bookmarkClicks` and share `BookmarkContextMenu` (`bookmark-menu.tsx`), and each wears its tab's mark (`AddressMark`).
- **For other tracks**: `useBookmarkActions()` (`client/bookmarks/actions.ts`) gives `bookmark({ title, url, where })`, `isBookmarked(url)`, `bookmarkOf(url)`, `place`, `rename` and `remove`, and re-exports `addressOfTab`. A tab's or a link's Bookmark item is `bookmark({ title, url: addressOfTab(tab) })`.
- **One mapping**: which built-in page an href is at and its address are `screenOfHref` and `instrumentAddressOf` in `shared/instrument-screens.ts`; `address.ts` keeps only the tab-level layer over them: sites, files and folders.

### Pages

- **Every built-in page is a row of `SCREENS`** (`shared/instrument-screens.ts`): its name, title, address and what it is for, which the product guide lists for the agent. `instrumentAddressOf` gives a tab's `instrument://` address from it: `instrument://screen/<name>` for Activity, Apps, Files, History, Memory, Skills and the rest, `instrument://settings/<part>` for a part of Settings. `screenOfHref` reads an address back to its page and part, `builtInPages()` lists every page and part of Settings with its address for the field's rows, and `ScreenMark` (`app-chip.tsx`) is each page's mark, so the tab strip, the chip, a row and a bookmark name a page the same way.
- **Settings is a tab** at `/settings/<part>`, one address per part in `SETTINGS_SECTIONS` (`general`, `account`, `providers`, `permissions`, `storage`, `activity`, `developer`), and `/settings` goes to General. All of Settings is one tab (`tabIdentity`), so asking for it brings the one open forward and walks it to the part asked for (`bringForwardShowing` in `built-in-pages.tsx`). A name that is not a part (`/settings/theme`) is a setting's link, which the route sends to the setting's part with its row lit. What an address asks of the page once (a row to light, a memory to show, the account's usage, the diagnostic log) the page takes and drops from its address (`useArrivingAsk`), so going back never asks it again; the search's words stay in it as `q`.
- **Opening a page.** `openSettings` and `openBuiltInPage` put a request in `pageRequestAtom`, and each window's `BuiltInPageOpener` brings the page forward in the group up, or opens it as a new tab after the tab up. The sidebar's Settings, ⌘,, links into Settings, the command menu's Settings, Memory, Skills and History rows, the sidebar's History row and ⌘Y all go through it. There is no Settings dialog.
- **Memory and Skills** are pages of their own (`/memory`, `/skills`): the sections Settings had, in `BuiltInPage`. Settings' search still finds them and opens them in its tab, and their old links (`instrument://settings/memory`, `memory-import`, `new-skill`) open them.
- **History** is `/history`, its search in `q` (`HistoryPage`): every chat and kept draft no window lists, by day. Opening one opens it as a group of its own and the window moves to it, leaving the History tab where it was.
- **Half width.** Under `PAGE_FOLD_PX` (640), measured on the page itself (`useIsNarrower`), a page folds what it keeps beside its content. Settings' sidebar becomes a rail of the parts' icons, each naming itself on hover, its search opening over the part from the rail's magnifier. Activity's details open under the row picked, and its search and filters go under its title. Memory, Skills and History are one column whose padding follows a container query. Apps already lays out by container query, and Files folds its places at its own 576px.
- **Live values.** Every part reads its preferences and lists through live queries, so Settings beside a chat shows a setting changed elsewhere as it changes.

### Where Pages stands

- Checked in a dev instance held off screen, each page beside a chat (596px) and with the chat's card closed (904px). ⌘, and ⌘Y are menu key equivalents, which input sent to such a window does not reach, so the chords were never pressed; what they call was.
- The agent has no tool that changes a setting, so the live case was checked by changing one through the preferences route while Settings stood beside the chat. The fixture workspace has no memories, so the Memory page was seen only empty.
- Files folds at 576px where every other page folds at 640, and to a panel over the folder where Settings folds to a rail.
- Activity's rows and details show a built-in page with the generic screen mark, not the page's own.

### Menus

Paths are under `apps/studio/src/client/` unless named.

- **One list of places.** `useWindowPlaces()` (`hooks/use-open-target.tsx`) gives the rows every link and file menu has after its own Open: Open in Split, Open in New Tab, Open in New Tab Group, Open in New Window. `useBookmarkRow()` adds Add to Bookmarks for an address, which only adds: a second time it says the address is already in Bookmarks. A link in text (`ExternalLink`, an app link's chip, `LinkSurface`) asks with `isLink`, which words the rows as a web page's menu does (Open Link in Split, Bookmark Link) and leaves its menu without the plain Open, except in `LinkSurface`, where a click opens in place. The OS's menu shows the list through `showOpenMenu`, and a menu the app draws (a file link in a chat, a Files row, a bookmark) shows the same rows with `PlaceItems` (`components/window/place-items.tsx`), which gives each its icon.
- **Opening into a place.** `OpenOptions` (`components/window/context.ts`) takes `into` (`split`, `group`, `window`) and `from`, the tab that asked, which surfaces pass on through `ownPlaceOf`. `openInto` in `components/window/use-openers.ts` places it: a split is the other side of the asking tab's group, right after the tab up there, made when the group has one side; a new tab group is `newGroup`; a new window is a group made without showing it here, then moved to a window of its own. Shift-click on a link or a file is Open in New Tab Group, and a chat opened into a place is a tab of its own there.
- **A web page's menu** is built in main (`LINK_PLACES` in `electron-main/browser-view/guest-interactions.ts`): Open Link in Split, Open Link in New Tab, Open Link in New Tab Group, Open Link in New Window, then Bookmark Link. A place goes to the window as `browser.open-in-new-tab` with its `into`, and Bookmark Link as `browser.bookmark-link`, which `use-openers.ts` keeps with `useAddBookmark` (`bookmarks/actions.ts`), named by the link's text.
- **Files** (`components/window/computer-page.tsx`): the list, columns and icons views share one row menu. `placesOfOne` gives a single selected item Open in Split, Open in New Tab Group and Add to Bookmarks; with several selected the menu keeps Open in New Tabs and Open in New Window.
- **A tab's menu** (`components/window/tab-menu-items.tsx`) is Core's, with Add to Bookmarks or Remove from Bookmarks after Duplicate for a tab with an address (`pane-tabs.tsx`), and ⌘\ shown on the tab up's first row.
- **A bookmark's menu** (`components/window/bookmark-menu.tsx`): Open, then `BOOKMARK_PLACES` through `useOpenAddress` (`OpenHow` has `split` and `newWindow`), then Rename, Move to Sidebar or Move to Bookmarks Bar, Copy Address and Delete.
- **A sidebar row's menu** (`components/window/group-row-menu.tsx`): Open in New Window and Duplicate Tab Group; Rename and Pin or Unpin; a chat's read marks, Project (left out for a group with no chat) and Copy; then the Close items.
- **The side chord**, ⌘\, is `moveTabToOtherSide` (`shared/window-shortcuts.ts`), in the Tab menu and the shortcut guide. It does what the tab menu's first row offers: Move to Other Side, or Open in Split for a side's only tab in a group of one side (`moveTabToOtherSide` in `components/window/app-window.tsx`).

### Where Menus stands

- Checked in a dev instance on the documents fixture, held off screen: each menu's rows and order, and what Open in Split, Open in New Tab Group, Open in New Window and Add to Bookmarks do from a Files row, a bookmark on the bar, a tab and the sidebar rows of a two-sided chat group, a group with no chat and a two-sided new chat.
- Input over CDP reaches neither a native menu nor a menu key equivalent. A web page's link menu was checked by patching `Menu.buildFromTemplate` in main to pick a row, and ⌘\ by sending the key from main with `webContents.sendInputEvent`. The native menus over a chat's links, file cards and path chips were never opened in the app; `hooks/use-open-target.test.tsx` checks their rows and what each opens.
- A tab's bookmark row toggles, while a link's only adds. The rows drawn by the app wear `size-4` icons beside Core's `size-3.5` ones in some menus, and the sidebar row's Mark as unread is in sentence case.

### Drag

Paths are under `apps/studio/src/client/components/window/` unless named.

- **One session** (`drag/session.ts`): a window has at most one drag, whatever holds it: the pointer (a tab, a sidebar row, a bookmark), the system's drag (files from the Finder, Files or a file card), or main, for another window's tab or row held over this one. What is held is a `Held` and what letting go would do a `Landing` (`drag/types.ts`); `dragAtom` is what the window draws from, and `dragPoint` is the pointer, read without drawing again. Every press becomes a drag past `START_PX` (8) through `pressToDrag`, and Escape, the window losing focus and a canceled pointer all end it in one place. A page with the keyboard hears the window's keys and its loss of focus in a process of its own (on a Mac the window's `document.hasFocus()` reads false meanwhile), so the press and the drag hold pages off the keyboard (`holdKeyboardFromPages` in `browser-pool.ts`), and the page a press brought up takes it once the press ends as a click or the drag ends. A page that takes it anyway blurs the window with the page as `document.activeElement`, which ends nothing: the drag takes the keyboard back and puts it home after. A release's click is swallowed.
- **Every place that takes a drop registers a target** (`useDropTarget`): where it takes drops, what letting go at a point does (a landing, or `"native"` where only the system's drag can hand files over), and a list that scrolls near its ends. The session measures once a frame, the smallest target under the pointer first, so a strip answers before the page around it. The targets are each side's strip (`useStripTarget`, `drag/use-group-drag.ts`), a group's side pages (`useSidePagesTarget`), the sidebar (`useSidebarTarget`, over `sidebar-drop.ts`), and the bar's and the sidebar's bookmarks (`useBookmarksTarget`, `drag/use-bookmarks-drag.ts`).
- **One lander** (`useLander` in `drag/use-drag-system.ts`) does what letting go does, through Core's moves and openers and the bookmarks' ops: a tab moves; files and a bookmark open as tabs at the same places, a bookmark staying kept, as Open in Split leaves it; a row takes its place in the list; a tab or a bookmark let go on the bookmarks is kept there (`useKeepBookmark`), and a tab whose address is kept already moves that bookmark there, as an address is kept once; a bookmark let go where nothing takes it is removed, with Undo in a toast (`useRemoveBookmarkWithUndo`).
- **A side's page** (`sideZoneAt`, `drag/landing.ts`): with one side, a band at each end (`splitBandWidth`, a fifth of the page from 120 to 360px) lights that half and makes it a side, but only after the pointer rests there `DWELL_MS` (400): it rests while it stays within `REST_PX` (6) of where the rest began, and moving farther starts it over, so even a slow pass is not a rest. So a tab crossing a page on its way elsewhere never splits it, and until the rest is over the band is what the rest of the page is; with two sides, the side under the pointer lights and takes the tab as its last at once. Files land on a side's page as a tab does, and open there as its last tabs: an open file's editor is part of its page, so nothing let go over it goes into the file. A site takes them natively, and so do a chat's composer and a folder in Files (`data-file-drop-region`) away from a lone side's ends, and a new tab up turns into them.
- **What shows on the way** comes from the target the drag is over, never from two places at once. A strip stands what is held among its tabs as tabs, the first at the pointer (`useSideStrip`, drawn by `tab-strip.tsx`); the sidebar lights a row or opens a room (`sidebar-drop.ts`); the bookmarks stand what is held where it would be kept (`useShownBookmarks`), a tab under its address and title or as the bookmark its address is kept as, the bookmark that moves gone from its old place. `drag/drag-layer.tsx` draws the rest: the half or side lit, sliding from one to the next, and where nothing in this window lands, a chip at the pointer, or the row for a whole group. A bookmark's chip is faded, as letting go there removes it. Lit places share one tone (`drag/tone.ts`) and none is green.
- **Past the window** (`useCarrier`): a group's tab starts main's carry at its first movement, so its picture is ready as it leaves; a row's starts once the row leaves the window. Off every window the tab's strip closes up behind it and the tab beside it comes up, and main shows the picture; let go there, it is a group of its own in a new window. Over another window the picture hides (`shownPhase`, `electron-main/windows/tab-carry.ts`) and that window measures it as its own drag (`useRemoteDrags`), telling main where it lands (`GroupTabLanding`, `shared/tabs.ts`, which has a strip's side and a side's page): a strip, a side's page, a sidebar row or a room. A window's only tab, or only group, takes its window along. Let go over a window that takes it nowhere, a tab goes back, and a window going along stays there.
- **Files held by the system** (`useSystemFileDrags`) carry only their count until let go, so main reads the system's drag pasteboard (`files.dragged`) to name them. Until it answers only the landing shows, and off the Mac they are named only once let go. A drag lands only where a target takes it, and anywhere else goes on to what is under it: Files' folders, a composer, the window's last resort.
- **Replaced**: `file-drops.ts`, `use-tab-carry.ts` and most of `tab-drag.ts`, the earlier build's separate drags for files, carrying and the strip.
- **Driving one**: `.agents/skills/studio-chrome-devtools/scripts/drag-drive.mjs` drives a drag with real mouse input, or files through the system's drag, and reports `window.__studioDrive.drag()` (`client/lib/studio-drive.ts`) at each stop, with shots, frame bursts, and other windows watched.
- **Checked by** `drag/landing.test.ts` (the zones, the bands, the rest, leaving the window, scrolling), `tab-strip.browser.test.tsx`, `sidebar-drop.browser.test.tsx` and `electron-main/windows/tab-carry.test.ts`.

### Where Drag stands

- Checked in a dev instance on the documents fixture, held off screen, with `drag-drive.mjs`: every landing of a tab, a row, files and a bookmark, Escape, the delete toast's Undo, and windows (a tab off every window into a new one, a side's tab onto the open desktop, a tab onto another window's strip, a window's only tab onto another window's page as a side, a row off the window).
- A window held off screen has main follow the renderer's word of the pointer, not the cursor, so a carry under the real cursor was never run, and the picture window was never seen in a shot. A Finder drag was made over CDP, with the paths written to the system's drag pasteboard, never with the Finder.
- Pressing a tab selects it, so its own page stays up while it is held: the tab up cannot be dragged onto its own page's bar. The sidebar's Bookmarks takes drops only once it has one. A file's stand-in shows a moment after its room opens, once main has named it.
