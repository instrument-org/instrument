# Studio wireframe kit

The pieces of Studio, for drawing a proposed flow with `create-page`'s wireframe template. That template owns everything else: the page shell, true-size frames, the enlarged view, click and changed marks, the marks toggle, and the Share button. This folder only makes the frames look like this product rather than like software in general.

`create-page` comes from the `instrument-org/skills` registry. Its wireframe template looks for this folder and reads this file when it finds one.

## The window

`window.js` is the window as built (the rail, the window bar and its tabs, Chat with its inbox and pane, the places, the floating chat, and the onboarding window), measured off the running app and redrawn at 1280x800 in the light theme; `brands.js` holds the brand marks it draws, as data URIs. A page is a **part**: a script that defines `META` and `states`, and nothing else. `build.mjs` puts the part, the kit and the template's marks into a copy of the skill's starter and template, and evaluates every frame in Node first, so a frame that renders `undefined` or lacks a caption fails the build rather than the page:

```bash
node .agents/wireframe-kit/build.mjs part.js ~/wireframes/YYYY-MM-DD-<surface>-<variant>.html
RAW=3 node .agents/wireframe-kit/build.mjs part.js out.html   # also writes out.raw.html: frame 3 alone at true size
```

It reads the skill from `~/.claude/skills/create-page`, or from `CREATE_PAGE_DIR`.

```js
const META = {
  title: "Thread pages: live tile column", // surface, then what this take tries
  line: "What is proposed and what the frames settle, in one line.",
  source: "What the frames are drawn against, and what was invented.",
  slotH: 320, // optional: the tile height in the grid
};

const states = [
  {
    title: "A press opens the pane",
    note: "What this frame proves, not what it shows.",
    body: appWindow({
      bar: winBar({ tabs: [{ chats: true, title: LISBON_TITLE }] }),
      body:
        inboxCol({ on: 0 }) +
        thread({ working: "Checking fares on flytap.com" }) +
        paneCard({
          tabs: [{ site: "tap", agent: true }, { file: "itinerary" }],
        }),
    }),
  },
];
```

| Function                                                               | Draws                                                                                                            |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `appWindow({ bar, on, body, over, railMark, user })`                   | The whole window: bar and rail on the gray ground, `body` in the rounded card, `over` on a layer over everything |
| `winBar({ tabs, active, right })`                                      | The 40px bar: back and forward, the window's tabs, and the right corner where status pills go                    |
| `barTab(t, { on })`                                                    | One window tab; `{ chats: true, title }` is a Chats tab                                                          |
| `rail(on, { mark, user })`                                             | The 76px rail: New (feather), Chat, Files, Browser, Apps, Discover, and Settings or the signed-in avatar         |
| `noChatOpen()`                                                         | What Chat shows beside the inbox with nothing open. There is no Home page                                        |
| `inboxCol({ on, w, rows, waiting })`, `row(r, { on })`                 | The 320px inbox: the Chats picker, Starred, Drafts, All, search, and hairline-divided rows; `on: -1` opens none  |
| `thread({ title, body, working, head, foot, reply })`                  | A chat: header, centered transcript, the folded work box, the reply box                                          |
| `threadHead`, `you`, `agent`, `workLine`, `replyBox`                   | Its pieces: the sage user bubble, the white agent bubble, the work box, the "Talk to Instrument" pill            |
| `fileRow(key)`, `pageRow(site)`                                        | A file or page the agent linked, in the transcript                                                               |
| `paneCard({ tabs, active, body, w })`, `chatRail(tabs)`                | The pane flush beside a chat: location row and page, then the chat's 4:3 tiles on a 120px rail                   |
| `locRow(tab)`, `page(tab)`                                             | The back/forward/omnibar row, and a plausible body for a tab (`PAGES`: the Lisbon sites, the files, a fresh tab) |
| `placeCard({ tab, body, loc })`                                        | Files, Browser, an app or a skill filling the card under its location row (`loc: false` for Apps and Discover)   |
| `finder({ pick })`                                                     | Files' Finder                                                                                                    |
| `smallChat({ title, tabs, body, working })`                            | The floating chat, 420 wide at the bottom right                                                                  |
| `miniBar`, `menu(items, pos)`, `sheet(inner, size)`                    | A minimized chat, a popover menu, a modal sheet over a dimmed window                                             |
| `onboardWin({ body, foot, tone })`, `onboardLogin()`, `brandMark(cls)` | Onboarding's own 480x600 window (brand or subtle gradient), its sign-in step as built, and the app mark          |

A tab is `{ site }` (a key of `SITES`), `{ file }` (a key of `FILES`) or `{ newtab: true }`, with `agent: true` on one a task is driving. The shared scenario is the thread "Lisbon trip itinerary with ticket prices" (`LISBON_TITLE`, `lisbon(stage)` for its transcript); keep to it so a round's files compare. It and the other `ROWS` are invented rather than taken from the documents fixture, which holds one chat, and a page's `source` line says so.

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

[`baseline.js`](baseline.js) is a part with one frame per surface as it stands: Chat empty, at work and with its pane, Files, Browser, the floating chat, a menu and a sheet, onboarding, and the desktop, menu bar extra, notification, context menu and website. Build it and look at it before drawing a round, and start each proposal from the nearest frame, changing only what the proposal argues about:

```bash
node .agents/wireframe-kit/build.mjs .agents/wireframe-kit/baseline.js ~/wireframes/kit-baseline.html
```

Not in the kit yet, so drawn by hand when a round needs it: Settings, Apps and Discover's contents, the draft window, and the dark theme.

## Changing the kit

The kit is meant to be edited by whoever draws with it. When a round draws a surface the kit lacks, or corrects one it draws wrong, move that piece into `window.js` (inside the window) or `mac.js` (outside it) as a function, add a frame for it to `baseline.js`, rebuild the baseline, and list it in the tables above. When the app itself changes, re-measure (below) rather than patching from memory. Fixed scenario data (`ROWS`, `SITES`, `FILES`, `PAGES`) is shared across rounds so files compare; add to it rather than renaming what is there.

## What rounds here keep correcting

- **Draw the real window.** The template says to draw no chrome a proposal is not about; in this product the opposite holds, because a proposal is judged by how it sits in the window as it is. Start from `appWindow` and the baseline frame nearest the proposal, and crop to a part only when the frame is about one control.
- **Draw only what the app has, unless the proposal adds it.** No Home page, no inline task cards, no invented panels or widths. Anything new is wrapped in `fresh` so it reads as the proposal, and everything else matches the baseline.
- **Mark sparingly.** One `clickable` per frame at most, on the frame before the click, never over the content it reveals. Leave marks off a page meant for screenshots.
- **Copy is short and real.** No taglines, tags, or explanatory blurbs inside the frame; a zero state is a line, not a paragraph. Use the Lisbon scenario's words where they fit.
- **Fewer takes when the question is narrow.** Several sibling files suit an open question; a narrow one gets one file.
- **Stay in the kit's look.** Kit classes and tokens only; a frame that drifts into a generic component library's styling is the wrong product.

Marks come from the template (`clickable`, `fresh`, `noted`, `ann`, `cursor`) and are in scope for a part. Icons are Phosphor regular only (`ph ph-name`): the starter loads no other weight, so `ph-fill` draws nothing, and a lit rail place keeps its outline icon in the brand color where the app swaps to the fill weight.

The kit draws Studio in its light theme whatever theme the reader has picked: `[color-scheme:light]` on `appWindow` and `onboardWin` is what the skin's `light-dark()` tokens resolve against inside the frame. Anything drawn outside them sets its own `text-foreground` and ground, or it inherits the reader's theme. Write class names out whole, since a class built by interpolation (`bg-${tone}-500`) is invisible to Tailwind's scanner and produces no styles. Placeholder prose is `h-[7px] rounded-full bg-gray-300` at varying widths (`bars2`). A third party's logo is inlined in `brands.js`, never a runtime URL into an icon CDN.

When the product moves, measure it again rather than trusting this file: boot a disposable instance (`studio-drive.mjs boot --purpose "kit measure" --workspace documents`), screenshot it in the light theme, then correct `window.js` to match.

## Naming a page

`create-page`'s wireframe template sets the rule: the surface, a colon, then what this take tries, with the claim in the line under it. The surfaces, in the words to use:

Rail, Window bar, Window tabs, Inbox, Chat, Reply box, Pane, Chat tiles, Floating chat, Draft window, Files, Browser, Apps, Discover, Onboarding, Settings; outside the window, Desktop, Menu bar, Dock, Notification, Finder, Website.

A page about how two surfaces share the screen names the pair (_Page and chat: chat as corner picture_). Takes on one question share the surface so they sort together: _Chat tiles: dock over reply box_, _Chat tiles: dock under reply box_.

## Where the files go

Wireframes are working artifacts, not history: write them outside the repository, wherever your own setup keeps pages, and never commit one. A decision a wireframe settled belongs in the plan's prose or a decision record, where the next reader will find it.

## Walking a set

Several wireframes usually get made for one proposal. [`build-index.ts`](build-index.ts) builds one page that plays a whole set: a rail of titles, the selected wireframe filling the rest, arrow keys or `j`/`k` between them, `f` to hide the rail. Run it from the folder the wireframes are in:

```bash
node <repo>/.agents/wireframe-kit/build-index.ts                  # every wireframes-*.html, in name order
node <repo>/.agents/wireframe-kit/build-index.ts a.html b.html    # exactly these, in this order
```

It writes `wireframes-index.html` beside them. A `wireframes-index.txt` there curates the set: one `file.html | Title` per line, `# Heading` to start a group. A line naming a file that is gone is skipped with a warning.

Every wireframe is inlined into the output with `srcdoc`, because Chrome refuses to load a sibling `file://` document into an iframe and renders it blank with no error. So the index holds copies: rerun it after changing any wireframe in the set.
