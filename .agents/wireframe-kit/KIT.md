# Studio wireframe kit

The pieces of Studio, for drawing a proposed flow with the `wireframe` skill. That skill owns everything else: the page shell, true-size frames, the enlarged view, click and changed marks, the marks toggle, and the Share button. This folder only makes the frames look like this product rather than like software in general.

`wireframe` comes from the `instrument-org/skills` registry. It looks for this folder and reads this file when it finds one.

## The window

`window.js` is the window as built (the rail, the window bar and its tabs, Chat with its inbox and pane, the places, the floating chat, and the onboarding window), measured off the running app and redrawn at 1280x800 in the light theme; `brands.js` holds the brand marks it draws, as data URIs. A page is a **part**: a script that defines `META` and `states`, and nothing else. `build.mjs` puts the part, the kit and the template's marks into a copy of the skill's starter and template, and evaluates every frame in Node first, so a frame that renders `undefined` or lacks a caption fails the build rather than the page:

```bash
node .agents/wireframe-kit/build.mjs part.js ~/wireframes/YYYY-MM-DD-<surface>-<variant>.html
RAW=3 node .agents/wireframe-kit/build.mjs part.js out.html   # also writes out.raw.html: frame 3 alone at true size
```

It reads the skill from `~/.claude/skills/wireframe`, or from `WIREFRAME_SKILL_DIR`.

```js
const META = {
  title: "Thread pages: live tile column", // the surface, a colon, then what this version tries
  line: "What we're proposing, and what these frames should help decide.",
  source: "What we drew from, and what we made up.",
  slotH: 320, // optional: the tile height in the grid
};

const states = [
  {
    title: "Pane open",
    note: "We open a tile in the pane when you press it, so you can watch the agent work without leaving the chat.",
    body: appWindow({
      bar: winBar({ tabs: [{ chats: true, title: PRICING_TITLE }] }),
      body:
        inboxCol({ on: 0 }) +
        thread({
          working: "Reading plans on zendesk.com",
          tiles: chatTiles(
            [{ site: "zendesk", agent: true }, { file: "comparison" }],
            0,
          ),
        }) +
        paneCard({ tab: { site: "zendesk", agent: true } }),
    }),
  },
];
```

| Function                                                                                                       | Draws                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `appWindow({ bar, on, body, over, railMark, user })`                                                           | The whole window: bar and rail on the gray ground, `body` in the rounded card, `over` on a layer over everything                                                                                                                                                                                                                                                                                 |
| `winBar({ tabs, active, right })`                                                                              | The 40px bar: back and forward, the window's tabs, and the right corner where status pills go                                                                                                                                                                                                                                                                                                    |
| `barTab(t, { on })`                                                                                            | One window tab; `{ chats: true, title }` is a Chats tab                                                                                                                                                                                                                                                                                                                                          |
| `rail(on, { mark, user })`, `finderGlyph(cls)`                                                                 | The 76px rail: New (feather), Chat, Files (the Finder's face, as on the Mac), Browser, Apps, and Settings or the signed-in avatar; `finderGlyph` is that Files mark anywhere else                                                                                                                                                                                                                |
| `noChatOpen()`                                                                                                 | What Chat shows beside the inbox with nothing open. There is no Home page                                                                                                                                                                                                                                                                                                                        |
| `inboxCol({ on, w, rows, place })`, `row(r, { on })`, `holdMarks(holds)`                                       | The 320px inbox: the view picker chip beside the search, then hairline-divided rows of three lines: title (semibold when unread) and star, the latest line (`step` shimmering while it works, `ask` behind an amber glyph while it waits, else `preview`), and what it holds (`holds`: files as named chips, `{ site }` and `{ app }` as marks) with the time in the corner; `on: -1` opens none |
| `inboxCol({ drafts })`, `draftRow(d)`, `inboxHead({ place })`                                                  | The inbox standing in another view: `place` (starred, drafts, archived) names it in the picker in its tint, led by its mark, and the search reads inside it; `drafts` (`{ title, time, holds }`) lists draft rows                                                                                                                                                                                |
| `thread({ title, body, working, tasks, tiles, head, foot, reply })`                                            | A chat: header (the work in flight at its right while `working` names a step, or with `tasks` the checklist of finished ones), centered transcript, then its tiles and the reply box                                                                                                                                                                                                             |
| `threadHead`, `you`, `agent`, `workLine`, `turnMeta`, `replyBox`                                               | Its pieces: the head (inbox toggle, title and caret, what is in flight, pop-out), the sage user bubble, the white agent bubble, the work in flight (the planning dot and the step in the shimmer; `compact` for the dot alone), the time-and-model line the transcript opens with, the "Talk to Instrument" pill                                                                                 |
| `fileRow(key)`, `pageRow(site)`                                                                                | A file the agent linked, as the transcript's card (picture, name, kind), or a page it opened, as a thin row                                                                                                                                                                                                                                                                                      |
| `chatTiles(tabs, active, { more })`, `chatTile(t, { on, icon })`                                               | A chat's tiles in a row over its reply box: 96px, the picture at the tile's width from the top with its mark on a small corner badge, the name under it, the one shown large ringed, New at the end; `more` draws the paging arrows over fades, `icon` a tile with no picture                                                                                                                    |
| `paneCard({ tab, body, w })`                                                                                   | The pane flush beside a chat: location row ending in Expand and the × that puts it away, and the page                                                                                                                                                                                                                                                                                            |
| `locRow(tab, { close, expand, place })`, `openIn(kind)`, `askButton(label)`, `page(tab)`                       | The location row: three columns with the omnibar centered at up to 640px and the open-in pill at its end (the Mac app it opens in), Ask and the menu at the right; back and forward in a pane or peek (`close` adds Expand and ×), reload when it fills Browser (`place`). `page` is a plausible body for a tab (`PAGES`: the competitors' pricing pages, the files, a fresh tab)                |
| `placeCard({ tab, body, loc })`, `browserHome({ recent })`                                                     | Browser, an app or a skill filling the card under its location row (`loc: false` for Apps); Files has `filesPlace`. `browserHome` is Browser with no page: the omnibar over Bookmarks and Recent pages                                                                                                                                                                                           |
| `finder({ pick })`                                                                                             | Files on the Instrument folder in list view, as built: `filesPlace` with the places, the Finder's header and its listing                                                                                                                                                                                                                                                                         |
| `filesPlace({ top, side, head, body })`                                                                        | Files filling the card: the top row, then `side` (`finderSidebar`, `fileTree`, or `""` when folded), then `head` over `body`                                                                                                                                                                                                                                                                     |
| `filesTop({ crumbs, mark, open, right, left })`                                                                | Files' 40px top row: the sidebar toggle, the omnibar centered across the card (`mark` leads it: a folder, or the open file's type) ending in the open-in pill for `open`'s app, and `right` for an open file's controls                                                                                                                                                                          |
| `fileActions({ editing, ask, expand })`                                                                        | An open file's controls in the top row: Viewing (or Editing), Ask, its menu; `expand` adds Expand, which a file filling a window tab does not have                                                                                                                                                                                                                                               |
| `finderSidebar({ on, starred, places })`, `finderHeader({ title, views, ask })`, `finderViews(view, extra)`    | The 175px places (Recents, Instrument, the `places` pinned under Pinned, Locations), the 48px header (name, Ask, the views, sort, filter, more, search), and the view picker; `extra` adds views as `[key, icon]`                                                                                                                                                                                |
| `finderListView(rows, { pick })`, `fileTree(rows, { on })`                                                     | The list view's columns over 24px striped rows, and the 240px tree a file opens beside, in place of the places                                                                                                                                                                                                                                                                                   |
| `smallChat({ title, tabs, peek, body, working, tasks })`, `chatPeek(t)`                                        | The popped-out chat, 420x560 and docked flush to the window's foot 20px from the right like the draft, its head the chat's own (title and caret, what is in flight, minimize, expand, ×), its tiles over its reply box; `peek` opens a tile in a card over the conversation, with Expand and ×                                                                                                   |
| `miniBar`, `menu(items, pos)`, `sheet(inner, size)`                                                            | A minimized chat, a popover menu, a modal sheet over a dimmed window                                                                                                                                                                                                                                                                                                                             |
| `composeWin({ title, model, words, h, over })`, `modelTrigger(name, { mark, warn })`                           | The draft: a 600-wide compose window docked at the bottom right, its head the title, + Topic, the model control and the arrow, then minimize, expand, ×; the words; the band with the ways in; pass it as `over`                                                                                                                                                                                 |
| `replyBoxOpen({ extras, text })`, `modelProblem(text, { action })`, `plusMenu({ left, top, w, model })`        | The reply box opened up with a row over the words (the amber model bar, with its fix at the end, leads it), and its plus menu as wide as the reply box: Browser, This Mac, Attach files, Add a folder, Apps, Skills, and the model                                                                                                                                                               |
| `modelPicker({ open, held, list, q, mark })`, `pickerPop(inner, { left, top })`, `pickerCrop(inner)`           | The model picker at its built 680x520 (`PICKER_W`, `PICKER_H`): search over the rail of `PICKER_CONNS` and the open connection's `list`; `held` checks the connection with the chosen model, `q` searches across all of them; place it over a window with `pickerPop`, or fill a frame with `pickerCrop`                                                                                         |
| `pickerRow(name, { mark, sub, on })`, `pickerHead(t, mark)`, `pickerAutoRow({ on })`, `pickerAutoOnly({ on })` | Its list: a model row (the maker's mark, an optional line under the name, tint and check when chosen), a group label, Auto leading a longer list with its rule, and Auto alone and centered with its button                                                                                                                                                                                      |
| `onboardWin({ body, foot, tone })`, `onboardLogin()`, `brandMark(cls)`                                         | Onboarding's own 480x600 window (brand or subtle gradient), its sign-in step as built, and the app mark                                                                                                                                                                                                                                                                                          |

A tab is `{ site }` (a key of `SITES`), `{ file }` (a key of `FILES`), `{ folder }`, `{ browser: true }` or `{ newtab: true }`, with `agent: true` on one a task is driving. The shared scenario is the thread "Help desk pricing against competitors" (`PRICING_TITLE`, `pricing(stage)` for its transcript): someone at a help desk company lining up competitors' list prices against their own plans. Keep to it so a round's files compare, and keep new scenario data to work people do for a business, not errands from home. It and the other `ROWS` are invented, as are the prices on the competitors' pages, rather than taken from the documents fixture, which holds one chat, and a page's `source` line says so.

## Outside the window

`mac.js` draws what surrounds the app: the Mac it runs on and the web people meet it on first. These frames are the desktop's size, so a state that uses them spreads `DESKTOP` into itself (`{ title, note, ...DESKTOP, body }`), and the window goes onto the desktop through `placed`, scaled.

| Function                                              | Draws                                                                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `macDesktop({ bar, windows, dock, over, wallpaper })` | The 1512x982 desktop: wallpaper, menu bar, Dock, `windows` and `over` placed absolutely                       |
| `placed(html, { left, top, w, h, scale })`            | A true-size frame (`appWindow`, `onboardWin`, `browserWindow`, `finderWindow`) scaled into place, 0.8 default |
| `menuBar({ app, menus, extra, lit })`                 | The menu bar; `extra` puts Instrument's glyph among the status items, `lit` draws it pressed                  |
| `menuBarPanel(inner, { right, w, h })`                | A panel hanging from that glyph                                                                               |
| `dock({ apps, running, mark })`                       | The Dock; `"instrument"` is the app mark, `mark` hangs annotations on an icon                                 |
| `macNotification({ title, sub, body, time })`         | A notification banner at the top right                                                                        |
| `finderWindow({ title, items, pick })`                | The user's own Finder window, not Studio's Files place                                                        |
| `contextMenu(items, { left, top })`                   | The Mac's right-click menu, as opposed to Studio's `menu`                                                     |
| `browserWindow({ url, tabs, body })`                  | Someone else's browser, for the website and anything seen before installing                                   |

Unlike the window, these are drawn from macOS and a generic browser rather than measured off anything of ours; a page using them says so in its `source` line.

## The baseline

[`baseline.js`](baseline.js) is a part with one frame per surface as it stands: Chat empty, in Drafts, at work and with its pane, Files with and without its places and with a file open, Browser with and without a page, the floating chat, a menu and a sheet, onboarding, and the desktop, menu bar extra, notification, context menu and website. Build it and look at it before drawing a round, and start each proposal from the nearest frame, changing only what the proposal argues about:

```bash
node .agents/wireframe-kit/build.mjs .agents/wireframe-kit/baseline.js ~/wireframes/kit-baseline.html
```

Not in the kit yet, so drawn by hand when a round needs it: Settings, Apps' contents, and the dark theme.

## Changing the kit

The kit is meant to be edited by whoever draws with it. When a round draws a surface the kit lacks, or corrects one it draws wrong, move that piece into `window.js` (inside the window) or `mac.js` (outside it) as a function, add a frame for it to `baseline.js`, rebuild the baseline, and list it in the tables above. When the app itself changes, re-measure (below) rather than patching from memory. Fixed scenario data (`ROWS`, `SITES`, `FILES`, `PAGES`) is shared across rounds so files compare; add to it rather than renaming what is there.

## What rounds here keep correcting

- **Draw the real window.** The template says to draw no chrome a proposal is not about; in this product the opposite holds, because a proposal is judged by how it sits in the window as it is. Start from `appWindow` and the baseline frame nearest the proposal, and crop to a part only when the frame is about one control.
- **Draw only what the app has, unless the proposal adds it.** No Home page, no inline task cards, no invented panels or widths. Anything new is wrapped in `fresh` so it reads as the proposal, and everything else matches the baseline.
- **Mark sparingly.** One `clickable` per frame at most, on the frame before the click, never over the content it reveals. Leave marks off a page meant for screenshots.
- **Copy is short and real.** No taglines, tags, or explanatory blurbs inside the frame; a zero state is a line, not a paragraph. Use the pricing scenario's words where they fit.
- **Fewer takes when the question is narrow.** Several sibling files suit an open question; a narrow one gets one file.
- **Stay in the kit's look.** Kit classes and tokens only; a frame that drifts into a generic component library's styling is the wrong product.

Marks come from the template (`clickable`, `fresh`, `noted`, `ann`, `cursor`) and are in scope for a part. Icons are Phosphor regular only (`ph ph-name`): the starter loads no other weight, so `ph-fill` draws nothing, and a lit rail place keeps its outline icon in the brand color where the app swaps to the fill weight.

The kit draws Studio in its light theme whatever theme the reader has picked: `[color-scheme:light]` on `appWindow` and `onboardWin` is what the skin's `light-dark()` tokens resolve against inside the frame. Anything drawn outside them sets its own `text-foreground` and ground, or it inherits the reader's theme. Write class names out whole, since a class built by interpolation (`bg-${tone}-500`) is invisible to Tailwind's scanner and produces no styles. Placeholder prose is `h-[7px] rounded-full bg-gray-300` at varying widths (`bars2`). A third party's logo is inlined in `brands.js`, never a runtime URL into an icon CDN.

When the product moves, measure it again rather than trusting this file: boot a disposable instance (`studio-drive.mjs boot --purpose "kit measure" --workspace documents`), screenshot it in the light theme, then correct `window.js` to match.

## Naming a page

The `wireframe` skill sets the rules. A page is named for the surface, a colon, then what this version tries. Each frame is named like an artboard, with the screen's name in a word or two, and its note says in one first-person sentence what we're doing there and why. When a frame shows Studio as it ships today, add _(Current design)_ to its title, as in _Welcome (Current design)_. Use these names for the surfaces:

Rail, Window bar, Window tabs, Inbox, Chat, Reply box, Pane, Chat tiles, Floating chat, Draft window, Files, Browser, Apps, Onboarding, Settings; outside the window, Desktop, Menu bar, Dock, Notification, Finder, Website.

A page about how two surfaces share the screen names both of them (_Page and chat: chat as corner picture_). Versions that answer the same question start with the same surface, so they sort together: _Chat tiles: dock over reply box_, _Chat tiles: dock under reply box_.

## Where the files go

Wireframes are working artifacts, not history: write them outside the repository, wherever your own setup keeps pages, and never commit one. A decision a wireframe settled belongs in the plan's prose or a decision record, where the next reader will find it.
