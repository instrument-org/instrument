# Studio wireframe kit

The pieces of Studio, for drawing a proposed flow with the `wireframe` skill. That skill owns everything else: the page shell, true-size frames, the enlarged view, click and changed marks, the marks toggle, and the Share button. This folder only makes the frames look like this product rather than like software in general.

`wireframe` comes from the `instrument-org/skills` registry. It looks for this folder and reads this file when it finds one.

## Drawing a page

A page is a **part**: a script that defines `META` and `states`, and nothing else. `build.mjs` pastes the kit, the template's marks and the part into a copy of the skill's starter, and runs every frame in Node first, so a frame that renders `undefined`, lacks a caption, or redefines a name the kit has fails the build rather than the page:

```bash
node .agents/wireframe-kit/build.mjs part.js ~/wireframes/YYYY-MM-DD-<surface>-<variant>.html
RAW=3 node .agents/wireframe-kit/build.mjs part.js out.html     # also writes out.raw.html: frame 3 alone at true size
RAW=all node .agents/wireframe-kit/build.mjs part.js out.html   # every frame there, one under another
```

It reads the skill from `~/.claude/skills/wireframe`, or from `WIREFRAME_SKILL_DIR`.

```js
const META = {
  title: "Files: titles over names", // the surface, a colon, then what this version tries
  line: "What we're proposing, and what these frames should help decide.",
  source: "What we drew from, and what we made up.",
  slotH: 320, // optional: the tile height in the grid
};

const states = [
  {
    title: "Files list",
    note: "We show each page's title over its file name, so a folder of pages reads by what they're about.",
    body: appWindow({
      on: "files",
      bar: winBar({ tabs: [{ folder: "Instrument" }] }),
      body: finder({ view: "list", pick: 6 }),
    }),
  },
];
```

Start from the [baseline](#the-baseline) frame nearest the proposal and change only what it argues about. Anything new goes in `fresh(...)` so it reads as the proposal.

## The kit

The kit is `kit/`, one file per surface, pasted in the order `KIT_FILES` in [`kit.mjs`](kit.mjs) gives. Every function is a global that returns HTML, and every one takes finished HTML wherever a proposal needs to put its own thing in (`tabs`, `rows`, `over`, `body`, `head`, `foot`, `lead`, `right`), so a part passes its own pieces in rather than patching the kit's output with `.replace()`.

| File | Draws |
| --- | --- |
| `brands.js` | `BRAND_URI`: brand marks as data URIs (`openai`, `claude`, `anthropic`, `googlegemini`, `grok`, `gmail`, `notion`, `figma`, `instrumentglyph`, …) |
| `marks.js` | The small pieces: `brand`, `letterMark`, `fileMark`, `tabMark`, `tabTitle`, `planningDot`, `pulse`, `bars2`, `openIn`, `askButton`, `kbd`, `topicTint` |
| `controls.js` | Buttons and form controls as `components/ui` draws them |
| `scenario.js` | The shared, invented data: `SITES`, `FILES`, `ROWS`, `TOPICS`, `FOLDER_ROWS`, `PAGES`, `APP_ROWS`, `RELEASES`, `PRICING_TITLE` and `pricing()` |
| `window.js` | The frame: ground, bar, window tabs, status pills, bell, rail, `appWindow`, `tooltip` |
| `inbox.js` | The chat list: its head, view menu, topics, rows, drafts, a chat's menu, and Chat with nothing open |
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

Tabs, rows and holds are small objects. A tab is `{ chats: true, title }`, `{ site }` (a `SITES` key), `{ file }` (a `FILES` key), `{ folder: name }`, `{ browser: true }`, `{ apps: true }`, `{ newtab: true }`, `{ notes: true }` or `{ title, icon }`, with `agent: true` on one a task is driving. A row is `{ title, preview, step, ask, working, unread, starred, draft, topic, time, holds }`, a hold `{ file }`, `{ site }` or `{ app }`.

### The window (`window.js`)

| Function | Draws |
| --- | --- |
| `appWindow({ bar, on, body, over, railMark, railExtra, user, dark })` | The whole window at 1280x800: bar and rail on the gray ground, `body` in the rounded card, `over` on a layer over everything |
| `winBar({ tabs, active, hover, density, lead, right, bell, back })` | The 40px bar: the lights, back and forward, `lead`, the tabs and New tab, then `right` (status pills) and the bell. `tabs` mix tab objects and finished HTML; `density` defaults to what the strip has room for |
| `barTab(t, { on, hover, density, sep })`, `stripDensity(count, room)` | One tab as `tab-strip.tsx` draws it: growing to 240px, the title fading at its end, × on the tab up or under the pointer; density `full`, `compact` (mark centered) or `icon` |
| `statusPill(kind, { label, icon })` | A pill before the bell: `update`, `updating`, `offline`, `unreachable`, or a quiet one a proposal adds |
| `bell({ dot, count, open })` | The bell, with a dot, a count or pressed |
| `rail(on, { mark, user, extra })`, `railItem(word, icon, { on, mark })` | The 76px rail: New, Chat, Files, Browser, Apps, and Feedback over Settings at its foot; `extra` adds places as `[key, word, icon]` |
| `tooltip(title, { left, top, detail, w })` | A tooltip, or a tab's hover card with `detail` under its title |

### The chat list (`inbox.js`)

| Function | Draws |
| --- | --- |
| `inboxCol({ on, hover, w, rows, place, topic, drafts, search, empty, picking, before })` | The 320px list: its head, then rows. `place` (unread, starred, drafts, archived) or `topic` stands it in another view; `search` types into it and bolds what matched; `rows: []` with `empty` draws the empty list; `before` puts a proposal's own rows first |
| `inboxHead({ place, topic, search, open })` | The picker and the search. Typing folds the picker to its mark; a topic tints the head and puts its instructions and Edit topic under it |
| `row(r, { on, hover, last, search })`, `draftRow(d)` | A row's three lines: title (semibold while unseen, red Draft after it while a reply waits), topic pill and star in the corner, the latest line, the holds and time. `hover` swaps the corner for the row's controls |
| `viewMenu({ on, counts, topics, left, top })` | The picker's menu: the views with their counts (Drafts only with `counts.drafts`), the topics, New topic |
| `chatMenu({ left, top, starred, unread })` | A chat's menu as built (right click on a row) |
| `topicMark(topic, size)`, `topicPill(topic, { quiet })`, `holdMarks(holds)` | A topic's emoji on its tint, its pill, a row's holds |
| `noChatOpen()` | What Chat shows beside the list with nothing open. There is no Home page |

### A chat (`chat.js`)

The transcript's look is under active redesign, so these stay deliberately plain: draw a proposal's own transcript with `thread({ body })` rather than growing them.

| Function | Draws |
| --- | --- |
| `thread({ title, body, working, topic, tiles, head, foot, reply, replyEl, stick })` | A chat column: head, transcript (`stick: "bottom"` sits a long one on the box), tiles, `foot` (a card over the box) and the reply box |
| `threadHead(title, { line, right, left, side, align, topic, popOut })` | The 56px head. `side` widens its equal outer columns when `right` needs room; `align: "left"` puts the title at the left |
| `statusLine(text, { tone })` | The line under the title: run, done, wait or failed |
| `turnMeta`, `you`, `agent`, `fileRow`, `pageRow`, `stepRow` | The transcript's pieces |
| `replyBox({ ph, text })` | The reply box: plus, words, mic, send |
| `chatTiles(tabs, active, { more })`, `chatTile(t)`, `paneCard({ tab, body, w })` | The tiles over the box and the pane beside the chat |
| `permissionCard({ kind, name, path, more })` | "Can Instrument use this folder?" over the box, with the cards waiting behind it |
| `questionCard({ question, choices, pick, steps, step })` | The choose card: radio rows, Something else, Add a note, Skip and Send; `steps` for several questions |
| `statusPop(groups, { left, top })` | The tasks the status line opens |

### The omnibar (`omnibar.js`)

| Function | Draws |
| --- | --- |
| `omnibar(t, { crumbs, fold, mark, focus, typed, ph, size, end, url })` | The field: a page's host quiet and the rest loud; a folder's or file's path as crumbs (`fold` folds the middle into ···); the open-in icon at its end. `focus` selects the whole address, `typed` types into it, `size` 7 (28px) or 8 (Files' 32px) |
| `omniMenu(rows, { left, top, w, on })`, `searchMark` | Its suggestions under it, as `[mark, words, hint]` |
| `locRow(t, { close, expand, place, lead, trail, omni })` | The 40px row over a page or file: back and forward in a pane, reload in a window tab, the omnibar, Ask, the menu, Expand and × |

### Files (`files.js`)

| Function | Draws |
| --- | --- |
| `finder({ view, pick, side, search, omni, rows, crumbs })` | Files on the Instrument folder as built, in `icons`, `table`, `columns` or `list` |
| `filesRow({ crumbs, fold, view, side, narrow, search, omni })` | Its one 40px row: sidebar toggle, the four views, sort, more, search (or the search open), the omnibar, Ask |
| `finderSidebar({ on, starred, places, disks })` | The 175px places: Recents, Instrument, Pinned, Locations |
| `finderTable(rows, { pick, cols, fill })`, `finderList`, `finderGrid`, `finderColumns(cols, { preview })` | The four views. Table's stripes run to the pane's foot; List puts titles over names; Columns shows a picked file's picture and details |
| `fileBeside({ folder, rows, pick, view, file, crumbs, fold, w, folded, editing, body })` | A file open beside its folder, with the row split at the column's edge |
| `filesPlace({ top, side, head, body, foot })`, `filesFoot(n, { picked })`, `filesViews(view, extra)`, `fileThumb(name, { w })` | The pieces, for a proposal that rearranges them |
| `sortMenu({ sort, group })`, `kindMenu({ kinds })` | Sort and group, and the search's Show only |

### Browser and the other places (`browser.js`, `places.js`)

| Function | Draws |
| --- | --- |
| `placeCard({ tab, body, loc, omni })` | A page filling the card under its location row |
| `browserHome({ recent, bookmarks, omni })` | Browser with no page: the omnibar over Bookmarks and Recent pages |
| `pageMenu({ left, top, bookmarked })` | The page's ⋮ menu as built |
| `newTabPage({ greeting, recent })`, `cmdRow(icon, label, keys, { on, h })` | The New tab page: the command menu's list in place |
| `appsPlace({ connected })` | Apps with nothing open |
| `releaseNotes({ versions, yours, ready, fresh })` | What's new: versions in full, then folded; a downloaded update's card first |

### Overlays, Settings, controls (`overlays.js`, `settings.js`, `controls.js`)

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

### Composing, the picker, floating, setup

| Function | Draws |
| --- | --- |
| `composeWin({ title, model, words, h, over })` | The draft: a 600px compose window docked at the bottom right |
| `modelTrigger(name, { mark, warn })`, `modelProblem(text, { action })`, `replyBoxOpen({ extras, text })`, `plusMenu({ left, top, w, model })` | The model control, its problem bar, the reply box opened up, its plus menu |
| `modelPicker({ open, held, list, q, mark })`, `pickerPop`, `pickerCrop`, `pickerRow`, `pickerHead`, `pickerAutoRow`, `pickerAutoOnly`, `PICKER_W`, `PICKER_H` | The model picker at its built 680x520 |
| `smallChat({ title, tabs, peek, body, working })`, `chatPeek(t)` | The popped-out chat, 420x560 at the bottom right, and a tile peeked at in it |
| `agentTray({ tabs, active, body })` | The browser a draft sets up for the agent |
| `setupWin`, `setupPage`, `setupFoot`, `setupButton`, `setupChooseAI`, `setupSubscriptions`, `setupRows`, `setupRowButton`, `SETUP` | Setup at its own 1080x720 (spread `...SETUP` into the frame) |
| `planCard`, `planButton`, `OFFER_PLANS`, `brandMark` | The plan cards setup and the plan sheet draw, and the app mark |

### Outside the window (`mac.js`)

These frames are the desktop's size, so a state that uses them spreads `DESKTOP` into itself (`{ title, note, ...DESKTOP, body }`), and the window goes onto the desktop through `placed`, scaled. They are drawn from macOS and a generic browser rather than measured off anything of ours; a page using them says so in its `source` line.

| Function | Draws |
| --- | --- |
| `macDesktop({ bar, windows, dock, over, wallpaper })` | The 1512x982 desktop: wallpaper, menu bar, Dock, `windows` and `over` placed absolutely |
| `placed(html, { left, top, w, h, scale })` | A true-size frame (`appWindow`, `setupWin`, `browserWindow`, `finderWindow`) scaled into place, 0.8 default |
| `menuBar({ app, menus, extra, lit })`, `menuBarPanel(inner, { right, w, h })` | The menu bar, with Instrument's glyph among the status items, and a panel hanging from it |
| `dock({ apps, running, mark })`, `macNotification({ title, sub, body, time })` | The Dock and a notification banner |
| `finderWindow({ title, items, pick })`, `contextMenu(items, { left, top })` | The person's own Finder window and the Mac's right-click menu, as opposed to Studio's Files and `menu` |
| `browserWindow({ url, tabs, body })` | Someone else's browser, for the website and anything seen before installing |

## The scenario

The shared scenario is the chat "Help desk pricing against competitors" (`PRICING_TITLE`, `pricing(stage)` for its transcript): someone at a help desk company lining up competitors' list prices against their own plans, filed under the Pricing topic. The other `ROWS`, the `TOPICS`, the Instrument folder's `FOLDER_ROWS`, the competitors' `PAGES` and the `RELEASES` all come from it. Keep to it so a round's files compare, keep new scenario data to work people do for a business, and add to it rather than renaming what is there. It is invented, prices included, rather than taken from the documents fixture, which holds one chat, and a page's `source` line says so. The home folder is `mac-user`, never a real one.

## The baseline

[`baseline.js`](baseline.js) is a part with one frame per surface as it stands: the chat list in each of its states, the window tabs, the bell and a status pill, Files in each view with its menus and search, Browser, New tab, ⌘K, Apps, the release notes, Settings, Send feedback, a dialog and a toast, the chat with its cards, the floating chat, the draft, the model picker, setup, and the desktop, menu bar extra, notification, context menu and website. Build it and look at it before drawing a round:

```bash
node .agents/wireframe-kit/build.mjs .agents/wireframe-kit/baseline.js ~/wireframes/kit-baseline.html
```

`appWindow({ dark: true })` draws the dark theme for everything built on tokens; hard-coded light colors (page bodies, tiles) stay light. Not in the kit yet, so drawn by hand when a round needs it: an app's own page, a task opened on its own, and the transcript's newer pieces.

## Measuring against the app

A baseline frame that names a state of the running app in `measure` is checked against it. [`measure/measure.mjs`](measure/measure.mjs) takes a picture of every baseline frame at true size, has [`measure/capture.mjs`](measure/capture.mjs) put a booted Studio into each named state and take a picture at the same 1280x800, 1x and light theme (with what only a developer sees in the bar hidden), and writes `compare.html`, each frame laid over the app with a slider between them, so drift shows up as a ghost:

```bash
DRIVE=.agents/skills/studio-chrome-devtools/scripts/studio-drive.mjs
node $DRIVE boot --purpose "kit measure" --workspace documents
node .agents/wireframe-kit/measure/measure.mjs ~/wireframes/kit-measure          # everything, about a minute and a half
node .agents/wireframe-kit/measure/measure.mjs ~/wireframes/kit-measure --only files-table,files-list
node .agents/wireframe-kit/measure/measure.mjs ~/wireframes/kit-measure --no-app  # retake only the kit's pictures
node $DRIVE stop --workspace documents
```

It writes the Instrument folder Files is shown on into the output folder, files the fixture's chat under Pricing, and leaves the app's theme as it found it. `--only` writes a `compare.html` of just those states. A state the app cannot reach in a fixture (the release notes need the API) has no `measure` and is checked by reading the code it names.

## Changing the kit

The kit is meant to be edited by whoever draws with it.

- **When a round draws a surface the kit lacks**, or corrects one it draws wrong, move that piece into the kit file for its surface as a function, add a frame for it to `baseline.js` (with a `measure` key and a state in `capture.mjs` when the app can reach it), rebuild the baseline, and list it in the tables above.
- **When the app changes, measure** (above) rather than patching from memory, then correct the kit until the ghosts go away. Each file's header says when it was last measured.
- **A new file** goes in `kit/` and in `KIT_FILES`, after the files whose top-level values it uses.
- **Names are global.** A part that defines a name the kit has fails the build with that name; a new kit name that a part's helper already uses is fine, since the build says what to do. Avoid the template's own top-level names (`layout`, `stage`, `step`, `views`, `more`, `rack`, `shortcut`), which the build's compile check catches.

## What rounds here keep correcting

- **Draw the real window.** The template says to draw no chrome a proposal is not about; in this product the opposite holds, because a proposal is judged by how it sits in the window as it is. Start from `appWindow` and the baseline frame nearest the proposal, and crop to a part only when the frame is about one control.
- **Draw only what the app has, unless the proposal adds it.** No Home page, no inline task cards, no invented panels, menu items or widths. Anything new is wrapped in `fresh` so it reads as the proposal, and everything else matches the baseline.
- **Pass pieces in, don't patch them.** Every function takes HTML where a proposal puts its own thing; a `.replace()` on kit output breaks the next time the kit changes.
- **Mark sparingly.** One `clickable` per frame at most, on the frame before the click, never over the content it reveals. Leave marks off a page meant for screenshots.
- **Copy is short and real.** No taglines, tags, or explanatory blurbs inside the frame; a zero state is a line, not a paragraph. Use the pricing scenario's words where they fit, and the app's own words for its controls.
- **Fewer takes when the question is narrow.** Several sibling files suit an open question; a narrow one gets one file.
- **Stay in the kit's look.** Kit functions, classes and tokens only; a frame that drifts into a generic component library's styling is the wrong product.

Marks come from the template (`clickable`, `fresh`, `noted`, `ann`, `cursor`) and are in scope for a part. Icons are Phosphor regular only (`ph ph-name`): the starter loads no other weight, so `ph-fill` draws nothing, and a lit rail place keeps its outline icon in the brand color where the app swaps to the fill weight.

The kit draws Studio in its light theme whatever theme the reader has picked: `[color-scheme:light]` on `appWindow` and `setupWin` is what the skin's `light-dark()` tokens resolve against inside the frame. Anything drawn outside them sets its own `text-foreground` and ground, or it inherits the reader's theme. Write class names out whole, since a class built by interpolation (`bg-${tone}-500`) is invisible to Tailwind's scanner and produces no styles. A color class copied from the app that the skin lacks fails the build. A third party's logo is inlined in `brands.js`, never a runtime URL into an icon CDN.

## A prototype, and replaying a chat

A part that defines `META` and `SCREEN` (`{ w, h, draw, controls }`, the skill's "A prototype instead of frames") instead of `states` builds one live screen from the skill's `prototype.html`, with the same build command.

[`replay/`](replay/) plays a chat back from its records in a design under exploration, as such a prototype with a scrubber under it. The point is to draw a design against real chats, with their real pauses, long runs of steps, tasks and failures, rather than against made-up ones:

```bash
node .agents/wireframe-kit/replay/build-replay.mjs <chat-records-dir> ~/wireframes/YYYY-MM-DD-chat-replay-<what>.html \
  --design ~/wireframes/<the design's part>.js --title "Chat replay: <what>" --chat "<the chat's title>" [--pictures | --icons]
```

- `<chat-records-dir>` is a chat's `.instrument/chats/<id>/` folder, with its tasks' logs beside its own. An eval keeps one per chat in its run's workspace, a temp folder the system clears in time, so copy the workspace out if the run is worth replaying later.
- `--design` is the part whose pieces draw the replay. The replay takes everything above its `// ---- the scenario` line (or its `META`), and needs `says`, `working`, `workedLine`, `head`, `DOT`, `pillDark`, `pillSoft`, `shimmerText`, `miniDot`, `taskHeader` and `chatBrief` from it, and for a chat that browses, `tabsPill`, `pageTab`, `siteMark`, `usedPage`, `addressRow`, `docPage` and `iconBtn`. A design that changes those changes every replay built from it.
- `--pictures` takes a picture of each tab's page at the pane's width, since the records keep none, so the page's source line should say they were taken at build time. Without it a tab shows a stand-in page. `--icons` fetches only the tabs' favicons, for a chat whose pages are behind a sign-in that a picture taken now would show instead.
- A sign-in the chat asked for (`connect_app`) draws as the app's sign-in card until the app turns up connected, and the chat's row says "Sign in to …" while it waits.
- A line that sums steps up (the live working line, the folded line, the chat's row, a task card) shows the step's `activity`, the short label calls running together share, so it holds still while they run; the list it opens onto names each call by its `explanation`, the one sentence the agent writes for that call.
- `records-to-timeline.mjs` is the reader on its own: `node records-to-timeline.mjs <chat-records-dir>` prints the timeline as JSON, with seconds from the chat's start for every message, step, task step, ask, failed request and wake.

In the page, drag the timeline or use ← and → to jump from one event to the next, Space plays at the real pace (1×, 4× or 8×, picked beside the timeline), and a folded line of steps opens on a click. When the chat browses, its tabs show at the top right; clicking them opens the pane and closes the chat list, and the page Instrument is using glows.

## Naming a page

The `wireframe` skill sets the rules. A page is named for the surface, a colon, then what this version tries. Each frame is named like an artboard, with the screen's name in a word or two, and its note says in one first-person sentence what we're doing there and why. When a frame shows Studio as it ships today, add _(Current design)_ to its title, as in _Welcome (Current design)_. Use these names for the surfaces:

Rail, Window bar, Window tabs, Chat list, Chat, Reply box, Pane, Chat tiles, Floating chat, Draft window, Omnibar, Files, Browser, New tab, Command menu, Apps, Release notes, Settings, Send feedback, Bell, Setup; outside the window, Desktop, Menu bar, Dock, Notification, Finder, Website.

A page about how two surfaces share the screen names both of them (_Page and chat: chat as corner picture_). Versions that answer the same question start with the same surface, so they sort together: _Chat tiles: dock over reply box_, _Chat tiles: dock under reply box_.

## Where the files go

Wireframes are working artifacts, not history: write them outside the repository, wherever your own setup keeps pages, and never commit one. A decision a wireframe settled belongs in the plan's prose or a decision record, where the next reader will find it. The same goes for a measure run's pictures.
