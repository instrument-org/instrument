# The kit's files and functions

Every file in `kit/` and every function it defines, with what each draws and takes. [`KIT.md`](KIT.md) is the method: how a page is drawn with these, the scenario, the baseline and what rounds keep correcting. Read it first, and read this file in a call of its own.

## The files

| File | Draws |
| --- | --- |
| `brands.js` | `BRAND_URI`: brand marks as data URIs (`openai`, `claude`, `anthropic`, `googlegemini`, `grok`, `gmail`, `notion`, `figma`, `instrumentglyph`, …) |
| `marks.js` | The small pieces: `brand`, `letterMark`, `fileMark`, `tabMark`, `tabTitle`, `planningDot`, `pulse`, `bars2`, `openIn`, `askButton`, `kbd`, `projectTint` |
| `controls.js` | Buttons and form controls as `components/ui` draws them |
| `scenario.js` | The shared, invented data: `SITES`, `FILES`, `ROWS`, `PROJECTS`, `FOLDER_ROWS`, `PAGES`, `APP_ROWS`, `RELEASES`, `PRICING_TITLE` and `pricing()` |
| `window.js` | The frame: ground, bar, window tabs, status pills, bell, rail, `appWindow`, `tooltip` |
| `inbox.js` | The chat list: its head, view menu, projects, rows, drafts, a chat's menu, and Chat with nothing open |
| `chat.js` | A chat: head, status line, transcript pieces, reply box, tiles, pane, and the permission and question cards |
| `omnibar.js` | The omnibar field, its suggestions, and the location row it stands in |
| `files.js` | Files: its row, places, the four views, sort and kind menus, a file beside its folder |
| `browser.js` | Browser with and without a page, and the page's menu |
| `places.js` | The New tab page, Apps and the release notes |
| `floating.js` | The popped-out chat, a tile peeked at in it, and a draft's browser tray |
| `compose.js` | The draft window, the model trigger and its problem bar, the opened reply box and its plus menu |
| `picker.js` | The model picker |
| `overlays.js` | Menus, popovers, dialogs, sheets, toasts, the command menu, the bell's list, a status card, Send feedback |
| `settings.js` | The Settings sheet and its pages |
| `setup.js` | Setup at its own 1080x720, and the plan cards |
| `mac.js` | Outside the window: the Mac and the web |

Tabs, rows and holds are small objects. A tab is `{ chats: true, title }`, `{ site }` (a `SITES` key), `{ file }` (a `FILES` key), `{ folder: name }`, `{ browser: true }`, `{ apps: true }`, `{ newtab: true }`, `{ notes: true }` or `{ title, icon }`, with `agent: true` on one a task is driving. A row is `{ title, preview, step, ask, working, unread, starred, draft, project, time, holds }`, a hold `{ file }`, `{ site }` or `{ app }`.

## The window (`window.js`)

| Function | Draws |
| --- | --- |
| `appWindow({ bar, on, body, over, railMark, railExtra, user, dark })` | The whole window at 1280x800: bar and rail on the gray ground, `body` in the rounded card, `over` on a layer over everything |
| `winBar({ tabs, active, hover, density, lead, right, bell, back })` | The 40px bar: the lights, back and forward, `lead`, the tabs and New tab, then `right` (status pills) and the bell. `tabs` mix tab objects and finished HTML; `density` defaults to what the strip has room for |
| `barTab(t, { on, hover, density, sep })`, `stripDensity(count, room)` | One tab as `tab-strip.tsx` draws it: growing to 240px, the title fading at its end, × on the tab up or under the pointer; density `full`, `compact` (mark centered) or `icon` |
| `statusPill(kind, { label, icon })` | A pill before the bell: `update`, `updating`, `offline`, `unreachable`, or a quiet one a proposal adds |
| `bell({ dot, count, open })` | The bell, with a dot, a count or pressed |
| `rail(on, { mark, user, extra })`, `railItem(word, icon, { on, mark })` | The 76px rail: New, Chat, Files, Browser, Apps, and Feedback over Settings at its foot; `extra` adds places as `[key, word, icon]` |
| `tooltip(title, { left, top, detail, w })` | A tooltip, or a tab's hover card with `detail` under its title |

## The chat list (`inbox.js`)

| Function | Draws |
| --- | --- |
| `inboxCol({ on, hover, w, rows, place, project, drafts, search, empty, picking, before })` | The 320px list: its head, then rows. `place` (unread, starred, drafts, archived) or `project` stands it in another view; `search` types into it and bolds what matched; `rows: []` with `empty` draws the empty list; `before` puts a proposal's own rows first |
| `inboxHead({ place, project, search, open })` | The picker and the search. Typing folds the picker to its mark; a project tints the head and puts its instructions and Edit project under it |
| `row(r, { on, hover, last, search })`, `draftRow(d)` | A row's three lines: title (semibold while unseen, red Draft after it while a reply waits), project pill and star in the corner, the latest line, the holds and time. `hover` swaps the corner for the row's controls |
| `viewMenu({ on, counts, projects, left, top })` | The picker's menu: the views with their counts (Drafts only with `counts.drafts`), the projects, New project |
| `chatMenu({ left, top, starred, unread })` | A chat's menu as built (right click on a row) |
| `projectMark(project, size)`, `projectPill(project, { quiet })`, `holdMarks(holds)` | A project's emoji on its tint, its pill, a row's holds |
| `noChatOpen()` | What Chat shows beside the list with nothing open. There is no Home page |

## A chat (`chat.js`)

The transcript's look is under active redesign, so these stay deliberately plain: draw a proposal's own transcript with `thread({ body })` rather than growing them.

| Function | Draws |
| --- | --- |
| `thread({ title, body, working, project, tiles, head, foot, reply, replyEl, stick })` | A chat column: head, transcript (`stick: "bottom"` sits a long one on the box), tiles, `foot` (a card over the box) and the reply box |
| `threadHead(title, { line, right, left, side, align, project, popOut })` | The 56px head. `side` widens its equal outer columns when `right` needs room; `align: "left"` puts the title at the left |
| `statusLine(text, { tone })` | The line under the title: run, done, wait or failed |
| `turnMeta`, `you`, `agent`, `fileRow`, `pageRow`, `stepRow` | The transcript's pieces |
| `replyBox({ ph, text })` | The reply box: plus, words, mic, send |
| `chatTiles(tabs, active, { more })`, `chatTile(t)`, `paneCard({ tab, body, w })` | The tiles over the box and the pane beside the chat |
| `permissionCard({ kind, name, path, more })` | "Can Instrument use this folder?" over the box, with the cards waiting behind it |
| `questionCard({ question, choices, pick, steps, step })` | The choose card: radio rows, Something else, Add a note, Skip and Send; `steps` for several questions |
| `statusPop(groups, { left, top })` | The tasks the status line opens |

## The omnibar (`omnibar.js`)

| Function | Draws |
| --- | --- |
| `omnibar(t, { crumbs, fold, mark, focus, typed, ph, size, end, url })` | The field: a page's host quiet and the rest loud; a folder's or file's path as crumbs (`fold` folds the middle into ···); the open-in icon at its end. `focus` selects the whole address, `typed` types into it, `size` 7 (28px) or 8 (Files' 32px) |
| `omniMenu(rows, { left, top, w, on })`, `searchMark` | Its suggestions under it, as `[mark, words, hint]` |
| `locRow(t, { close, expand, place, lead, trail, omni })` | The 40px row over a page or file: back and forward in a pane, reload in a window tab, the omnibar, Ask, the menu, Expand and × |

## Files (`files.js`)

| Function | Draws |
| --- | --- |
| `finder({ view, pick, side, search, omni, rows, crumbs })` | Files on the Instrument folder as built, in `icons`, `table`, `columns` or `list` |
| `filesRow({ crumbs, fold, view, side, narrow, search, omni })` | Its one 40px row: sidebar toggle, the four views, sort, more, search (or the search open), the omnibar, Ask |
| `finderSidebar({ on, starred, places, disks })` | The 175px places: Recents, Instrument, Pinned, Locations |
| `finderTable(rows, { pick, cols, fill })`, `finderList`, `finderGrid`, `finderColumns(cols, { preview })` | The four views. Table's stripes run to the pane's foot; List puts titles over names; Columns shows a picked file's picture and details |
| `fileBeside({ folder, rows, pick, view, file, crumbs, fold, w, folded, editing, body })` | A file open beside its folder, with the row split at the column's edge |
| `filesPlace({ top, side, head, body, foot })`, `filesFoot(n, { picked })`, `filesViews(view, extra)`, `fileThumb(name, { w })` | The pieces, for a proposal that rearranges them |
| `sortMenu({ sort, group })`, `kindMenu({ kinds })` | Sort and group, and the search's Show only |

## Browser and the other places (`browser.js`, `places.js`)

| Function | Draws |
| --- | --- |
| `placeCard({ tab, body, loc, omni })` | A page filling the card under its location row |
| `browserHome({ recent, bookmarks, omni })` | Browser with no page: the omnibar over Bookmarks and Recent pages |
| `pageMenu({ left, top, bookmarked })` | The page's ⋮ menu as built |
| `newTabPage({ greeting, recent })`, `cmdRow(icon, label, keys, { on, h })` | The New tab page: the command menu's list in place |
| `appsPlace({ connected })` | Apps with nothing open |
| `releaseNotes({ versions, yours, ready, fresh })` | What's new: versions in full, then folded; a downloaded update's card first |

## Overlays, Settings, controls (`overlays.js`, `settings.js`, `controls.js`)

Pass these as `appWindow`'s `over`, placed in the window's pixels.

| Function | Draws |
| --- | --- |
| `menu(items, { left, top, w })` | Any menu: `"rule"`, `[icon, label, keys]`, or `{ label, icon, keys, head, dot, check, sub, danger, on, muted }` |
| `popover(inner, { left, top, w, p })`, `statusCard(title, line)` | A popover card; the card a warning pill opens |
| `dialog({ title, line, body, buttons, close, w })`, `sheet(inner, { w, h })`, `scrim(inner)` | A dialog over the dimmed window, a bare sheet, the dimmed ground |
| `toast(title, { line, action, icon, stack })` | A toast at the bottom left |
| `commandMenu({ q, rows })` | ⌘K over the window |
| `notificationsPop({ items })` | The bell's list |
| `feedbackDialog({ comment, items, picked, preview })` | Send feedback as built |
| `settingsSheet({ on, body, dev, search, extra })` | Settings over the window; `body` from `settingsGeneral()`, `settingsProviders()`, `settingsPermissions()`, `settingsMemory()`, or a proposal's own `settingsSection(label, settingsCard([settingsRow(...)]))` |
| `settingsHead`, `settingsSection`, `settingsCard(rows, { divided })`, `settingsRow({ title, line, sub, icon, tile, end })`, `zoomStepper` | Settings' pieces |
| `button(label, { tone, size, icon, round })`, `iconButton(icon, { ring, on })` | Buttons: `default`, `brand`, `secondary`, `outline`, `ghost`, `destructive`, `link` |
| `toggle(on)`, `checkbox(on)`, `radio(on)`, `segmented(options, on)`, `selectBox(value)`, `textField({ value, ph, focus })`, `textArea`, `badge`, `meter(filled)`, `spinner` | Form controls |

## Composing, the picker, floating, setup

| Function | Draws |
| --- | --- |
| `composeWin({ title, model, words, h, over })` | The draft: a 600px compose window docked at the bottom right |
| `modelTrigger(name, { mark, warn })`, `modelProblem(text, { action })`, `replyBoxOpen({ extras, text })`, `plusMenu({ left, top, w, model })` | The model control, its problem bar, the reply box opened up, its plus menu |
| `modelPicker({ open, held, list, q, mark })`, `pickerPop`, `pickerCrop`, `pickerRow`, `pickerHead`, `pickerAutoRow`, `pickerAutoOnly`, `PICKER_W`, `PICKER_H` | The model picker at its built 680x520 |
| `smallChat({ title, tabs, peek, body, working })`, `chatPeek(t)` | The popped-out chat, 420x560 at the bottom right, and a tile peeked at in it |
| `agentTray({ tabs, active, body })` | The browser a draft sets up for the agent |
| `setupWin`, `setupPage`, `setupFoot`, `setupButton`, `setupChooseAI`, `setupSubscriptions`, `setupRows`, `setupRowButton`, `SETUP` | Setup at its own 1080x720 (spread `...SETUP` into the frame) |
| `planCard`, `planButton`, `OFFER_PLANS`, `brandMark` | The plan cards setup and the plan sheet draw, and the app mark |

## Outside the window (`mac.js`)

These frames are the desktop's size, so a state that uses them spreads `DESKTOP` into itself (`{ title, note, ...DESKTOP, body }`), and the window goes onto the desktop through `placed`, scaled. They are drawn from macOS and a generic browser rather than measured off anything of ours; a page using them says so in its `source` line.

| Function | Draws |
| --- | --- |
| `macDesktop({ bar, windows, dock, over, wallpaper })` | The 1512x982 desktop: wallpaper, menu bar, Dock, `windows` and `over` placed absolutely |
| `placed(html, { left, top, w, h, scale })` | A true-size frame (`appWindow`, `setupWin`, `browserWindow`, `finderWindow`) scaled into place, 0.8 default |
| `menuBar({ app, menus, extra, lit })`, `menuBarPanel(inner, { right, w, h })` | The menu bar, with Instrument's glyph among the status items, and a panel hanging from it |
| `dock({ apps, running, mark })`, `macNotification({ title, sub, body, time })` | The Dock and a notification banner |
| `finderWindow({ title, items, pick })`, `contextMenu(items, { left, top })` | The person's own Finder window and the Mac's right-click menu, as opposed to Studio's Files and `menu` |
| `browserWindow({ url, tabs, body })` | Someone else's browser, for the website and anything seen before installing |
