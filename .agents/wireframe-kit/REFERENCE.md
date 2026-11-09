# The kit's files and functions

Every file in `kit/` and every function it defines, with what each draws and takes. [`KIT.md`](KIT.md) is the method: how a page is drawn with these, the scenario, the baseline and what rounds keep correcting. Read it first, and read this file in a call of its own.

## The files

| File | Draws |
| --- | --- |
| `brands.js` | `BRAND_URI`: brand marks as data URIs (`openai`, `claude`, `anthropic`, `googlegemini`, `grok`, `gmail`, `notion`, `figma`, `instrumentglyph`, the Apps directory's `googledrive`, `slack`, `hubspot`, …) |
| `marks.js` | The small pieces: `brand`, `letterMark`, `fileMark`, `tabMark`, `tabTitle`, `planningDot`, `pulse`, `bars2`, `openIn`, `askButton`, `kbd`, `projectTint` |
| `controls.js` | Buttons and form controls as `components/ui` draws them |
| `scenario.js` | The shared, invented data: `SITES`, `FILES`, `ROWS`, `PROJECTS`, `FOLDER_ROWS`, `PAGES`, `APP_ROWS`, `RELEASES`, `PRICING_TITLE` and `pricing()` |
| `window.js` | The frame: ground, bar, window tabs, status pills, bell, rail, `appWindow`, `tooltip` |
| `inbox.js` | The chat list: its search and places, view options, projects, rows at three densities, a project's head, drafts, a chat's menu, and the new chat beside the list |
| `chat.js` | A chat: head, transcript pieces (turns, activity rows, task and live cards), reply box, the new chat beside the list, the pane with its tabs, and the permission and question cards |
| `omnibar.js` | The omnibar field, its suggestions, the location row it stands in, and the framed controls around it |
| `files.js` | Files: its row, places, the four views, sort and kind menus, a file beside its folder |
| `browser.js` | Browser with and without a page, and the page's menu |
| `places.js` | The New tab page, Apps and the release notes |
| `floating.js` | The popped-out chat, and the tile peek and draft browser tray the app had before |
| `compose.js` | The docked draft and its bar, composer chips, the model trigger, its problem row and the note over the reply box, the opened reply box and its plus menu |
| `picker.js` | The model picker |
| `overlays.js` | Menus, popovers, dialogs, sheets, toasts, the command menu, the bell's list, a status card, Send feedback |
| `settings.js` | The Settings sheet and its pages |
| `setup.js` | Setup at its own 1080x720, and the plan cards |
| `mac.js` | Outside the window: the Mac and the web |

Tabs, rows and holds are small objects. A tab is `{ chats: true, title }`, `{ site }` (a `SITES` key), `{ file }` (a `FILES` key), `{ folder: name }`, `{ browser: true }`, `{ apps: true }`, `{ newtab: true }`, `{ notes: true }` or `{ title, icon }`, with `agent: true` on one a task is driving. A row is `{ title, preview, step, ask, working, failed, unread, starred, draft, project, time, day, holds }`, a hold `{ file }`, `{ site }` or `{ app }`.

## The window (`window.js`)

| Function | Draws |
| --- | --- |
| `appWindow({ bar, on, body, over, railMark, railExtra, user, dark })` | The whole window at 1280x800: bar and rail on the gray ground, `body` in the rounded card, `over` on a layer over everything |
| `winBar({ tabs, active, hover, density, lead, right, bell, back })` | The 40px bar: the lights in their 80px gutter, back and forward as two 28px buttons, `lead`, the tabs and New tab (the last tab keeps its hairline against the plus), then `right` (status pills) and the bell. `tabs` mix tab objects and finished HTML; `density` defaults to what the strip has room for |
| `barTab(t, { on, hover, density, sep })`, `stripDensity(count, room)` | One tab as `tab-strip.tsx` draws it: growing to 240px, the title fading at its end, × on the tab up or under the pointer; density `full`, `compact` (mark centered) or `icon` |
| `statusPill(kind, { label, icon })` | A pill before the bell: `update`, `updating`, `offline`, `unreachable`, or a quiet one a proposal adds |
| `bell({ dot, count, open })` | The bell, with a dot (`"problem"` red), a count or pressed |
| `rail(on, { mark, user, extra })`, `railItem(word, icon, { on, mark })` | The 76px rail: New, Chat, Files, Browser, Apps, and Feedback over Settings at its foot; `extra` adds places as `[key, word, icon]` |
| `tooltip(title, { left, top, detail, w })` | A tooltip, or a tab's hover card with `detail` under its title |

## The chat list (`inbox.js`)

| Function | Draws |
| --- | --- |
| `inboxCol({ on, hover, w, rows, place, project, drafts, search, tokens, focus, offer, density, byDay, projects, empty, picking, before })` | The 320px list: its head, the projects under a Chats heading (Inbox only, nothing searched; `projects: []` for none), then rows. `place` (drafts, archived) or `project` stands it elsewhere; `search` and `tokens` narrow it and bold what matched; `offer` opens the search's Show only; `density` three, two or one; `byDay` heads each day (`day` on the rows); `rows: []` draws the empty line; `picking` presses the view button; `before` puts a proposal's own rows first |
| `inboxHead({ place, project, search, tokens, focus, offer, open, density })` | The search with the view button at its end and Inbox, Drafts, Archived under it; inside a project, ‹ Inbox, the folded search and the view button |
| `chatSearch({ ph, search, tokens, focus, offer })` | The search field alone: a grey well, raised white while used, Unread and Starred as tokens, Show only under it |
| `viewMenu({ density, byDay, left, top })` | The view button's popover: Three lines, Two lines, One line, and Group by day |
| `projectsSection({ projects, open })` | Projects with its caret and +, a tinted row per project with its count, past four a "N more projects" row |
| `projectBanner(project)` | The head of a project's list: its mark on a white tile, name, instructions, Edit and Open in Files |
| `row(r, { on, hover, last, search, density, noProject })`, `draftRow(d)` | A row: title with the time and star at its end (semibold and the green dot while unseen, red Draft after it while a reply waits), the latest line (`peek`), then the project in its ink and the holds. `hover` swaps the time and star for the row's controls |
| `listHeading(text)` | The small heading over rows: Chats, a day, Outside this filter |
| `chatMenu({ left, top, starred, unread, archived })` | A chat's menu as built (right click on a row) |
| `projectMark(project, size, { plain })`, `projectPill(project, { quiet })`, `projectWords(project)`, `holdMarks(holds, { bare })` | A project's emoji on its tint, its pill (a chat's head), its name in its ink (a row), a row's holds |
| `noChatOpen({ project })` | What Chat shows beside the list with no chat open: `newChat({ project })` from chat.js. There is no Home page |

## A chat (`chat.js`)

Measured 2026-11-07. The transcript keeps changing, so these pieces draw what a turn has today and no more: draw a proposal's own transcript with `thread({ body })` rather than growing them. A chat has no tiles and no line under its title; its tabs show only in the pane beside it.

| Function | Draws |
| --- | --- |
| `thread({ title, body, working, project, pane, head, foot, reply, replyEl, stick, tiles })` | A chat column: head, transcript in its 768px column (`stick: "bottom"` sits a long one on the box), `foot` (a card or note over the box) and the reply box. `working` ends the transcript with a live activity row; `pane` lights the head's tabs button; `tiles` is for proposals |
| `threadHead(title, { project, pane, right, left, toggle, popOut, line, align, side })` | The 48px head: inbox toggle, title and caret, project pill, then the tabs button (`pane` lit, `null` for none) and `right`. `line` and `align: "center"` are for proposals that bring back the line under the title or the centered head |
| `newChat({ project, text, chips, foot, room, pane })` | What New writes beside the list: "New chat" with the project slot, an empty room (`room` shows a project's), and "What do you need?" |
| `turnMeta({ when, model, mark })`, `you(text)`, `agent(text)` | Where a turn starts, the person's tinted bubble, the agent's plain 15px words |
| `activityRow(label, { icon, live, clock, count, sites, explanation, open })`, `workedRow(label, { sites })`, `thinkingRow(clock)`, `stepRow` | A line of work: the tool's mark, the label, the sites, the caret; `live` takes the working dot, the shimmer, the clock and the call going on under it. A finished turn folds into `workedRow`. `stepRow` is the old name |
| `taskCard({ line, title, span, working, failed, sites, card })` | A task the chat started, 460 wide: tinted while it works, flat with a check once done, `card` hung under it |
| `liveCard({ tab, body, title, mark, meta, current, indent })` | The live card: a 208px picture of the page or file the work is on over a 32px foot, glinting while `current` |
| `replyFoot({ took, sources, model, when })`, `fileLine(key)`, `fileRow(key)`, `pageRow(site)` | A reply's footer cluster, a file named in a narrow column, the file card, a page row |
| `workingMark`, `inboxToggle`, `paneToggle(on)`, `addProjectChip`, `projectSlot(project)` | The breathing dot, the head's buttons, "+ Project" and "in <project>" |
| `replyBox({ ph, text, chips })` | The reply box: chips over the words, then plus, words, mic, send |
| `paneCard({ tab, tabs, active, body, w, loc })`, `paneTabs(tabs, active)` | The pane beside the chat: its tabs in the window's tab strip with + and ×, the location row, the page |
| `permissionCard({ kind, name, path, more })` | "Can Instrument use this folder?" over the box, with the cards waiting behind it |
| `questionCard({ question, choices, pick, steps, step })`, `answeredCard(rows)` | The choose card: radio rows, Something else, Add a note, Skip and Send; `steps` for several questions. Once answered, its answers in full |
| `statusLine(text, { tone })`, `statusPop(groups, { left, top })`, `chatTiles(tabs, active, { more })`, `chatTile(t)` | The line under the title, its tasks popover and the tile row, all gone from the app; kept for proposals |

## The omnibar (`omnibar.js`)

| Function | Draws |
| --- | --- |
| `omnibar(t, { crumbs, fold, mark, focus, typed, ph, end, url })` | The field, a 32px grey well (white while typing): a page's host quiet and the rest loud; a folder's or file's path as crumbs (`fold` folds the middle into ···); the open-in icon at its end. `focus` selects the whole address, `typed` types into it. `size` is still taken and ignored |
| `omniMenu(rows, { left, top, w, on })`, `searchMark` | Its suggestions under it, as `[mark, words, hint]` |
| `locRow(t, { close, expand, place, lead, trail, omni, extensions })` | The 44px row over a page or file: back and forward in a pane and reload in a window tab framed together, the omnibar, a page's extensions pill, Ask (a site's only at the window's level), the ⋮, and Expand for a file in a pane. A pane's × is in its tab strip now |
| `TOOL_SURFACE`, `toolGlyph(icon, { dim })`, `toolGroup(inner)`, `toolIcon(icon)`, `askFramed(label)`, `extensionsPill(marks)` | The family every control around the row belongs to (toolbar-control.ts): a 32px card with a hairline ring; bare 28px glyphs sharing one frame; a framed icon button; Ask with the mark; the extensions' buttons and the puzzle piece |

## Files (`files.js`)

| Function | Draws |
| --- | --- |
| `finder({ view, pick, side, search, omni, rows, crumbs })` | Files on the Instrument folder as built, in `icons`, `table`, `columns` or `list` |
| `filesRow({ crumbs, fold, view, side, narrow, search, omni })` | Its one 44px row: sidebar toggle, the four views in a grey well, sort, more and search framed, (or the search open), the omnibar, Ask |
| `finderSidebar({ on, starred, places, disks })` | The 175px places: Recents, Instrument, Pinned, Locations |
| `finderTable(rows, { pick, cols, fill })`, `finderList`, `finderGrid`, `finderColumns(cols, { preview })` | The four views. Table's stripes run to the pane's foot; List puts titles over names; Columns shows a picked file's picture and details |
| `fileBeside({ folder, rows, pick, view, file, crumbs, fold, w, folded, editing, body })` | A file open beside its folder, with the row split at the column's edge |
| `filesPlace({ top, side, head, body, foot })`, `filesFoot(n, { picked })`, `filesViews(view, extra)`, `fileThumb(name, { w })` | The pieces, for a proposal that rearranges them |
| `sortMenu({ sort, group })`, `kindMenu({ kinds })` | Sort and group, and the search's Show only |

## Browser and the other places (`browser.js`, `places.js`)

| Function | Draws |
| --- | --- |
| `placeCard({ tab, body, loc, omni, extensions })` | A page filling the card under its location row |
| `browserHome({ recent, bookmarks, omni, extensions })` | Browser with no page: the location row (omnibar, extensions, ⋮) over Bookmarks and Recent pages |
| `pageMenu({ left, top, bookmarked, zoom })` | The page's ⋮ menu as built, with its Zoom stepper and Extensions |
| `newTabPage({ greeting, recent })`, `cmdRow(icon, label, keys, { on, h })` | The New tab page: the command menu's list in place |
| `appsPlace({ connected, yours })` | Apps with nothing open: Your apps as marks (`yours`, a lost sign-in's dot), the search, Popular as 72px cards with each service's mark |
| `glyphButton(label, { small })` | The product's call to action: a white button with the mark and a verb (Connect) |
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
| `notificationsPop({ items })` | The bell's list: each notice's own action, then Dismiss; empty says "You don't have any notifications." |
| `feedbackDialog({ comment, items, picked, preview })` | Send feedback as built |
| `settingsSheet({ on, body, dev, search, extra })` | Settings over the window; `body` from `settingsGeneral()`, `settingsProviders({ signedIn, connected, plan, email })`, `settingsPermissions()`, `settingsMemory()`, or a proposal's own `settingsSection(label, settingsCard([settingsRow(...)]))` |
| `settingsHead`, `settingsSection`, `settingsCard(rows, { divided })`, `settingsRow({ title, line, sub, icon, tile, end })`, `zoomStepper` | Settings' pieces |
| `button(label, { tone, size, icon, round })`, `iconButton(icon, { ring, on })` | Buttons: `default`, `brand`, `secondary`, `outline`, `ghost`, `destructive`, `link` |
| `toggle(on)`, `checkbox(on)`, `radio(on)`, `segmented(options, on)`, `selectBox(value)`, `textField({ value, ph, focus })`, `textArea`, `badge`, `meter(filled)`, `spinner` | Form controls |

## Composing, the picker, floating, setup

| Function | Draws |
| --- | --- |
| `composeWin({ title, project, words, ph, chips, offer, notice, model, well, h, over })` | The docked draft, 600 wide at the bottom right, over Files, Browser or Apps: its head, the composer on a white card, and `well` (a tab) opening its pane under the composer at 640 tall |
| `composeBar(text, { right, chat })`, `windowButton(icon)` | A draft or popped-out chat put down as a dark bar along the foot; a floating window's 28px button |
| `composerChip(t, { on, x })`, `offerChip(t)` | A chip over a composer's words (`on` raised while its pane shows it); the dashed "Add <name>" for what is in view |
| `modelTrigger(name, { mark, warn })`, `modelProblem(text, { action })`, `replyNote(text, { action, tone, icon })` | The model control, the yellow row inside a draft's composer, and the note floating over a chat's reply box |
| `replyBoxOpen({ extras, text })`, `plusMenu({ left, top, w, model })` | The reply box opened up, and its 288px plus menu |
| `modelPicker({ open, held, list, q, mark })`, `pickerPop`, `pickerCrop`, `pickerRow`, `pickerHead`, `pickerAutoRow`, `pickerAutoOnly`, `PICKER_W`, `PICKER_H` | The model picker at its built 680x520 |
| `smallChat({ title, project, body, working, tabs, peek })` | The popped-out chat, 420x560 at the bottom right, with the chat's own head; `tabs` and `peek` draw the tiles and peek it no longer has |
| `chatPeek(t)`, `agentTray({ tabs, active, body })` | The tile peek and the draft's browser tray the app had before; kept for proposals |
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
