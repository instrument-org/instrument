# Studio wireframe kit

The pieces of Studio, for drawing a proposed flow with the `wireframe` skill. That skill owns everything else: the page shell, true-size frames, the enlarged view, click and changed marks, the marks toggle, and the Share button. This folder only makes the frames look like this product rather than like software in general.

`wireframe` comes from the `instrument-org/skills` registry. It looks for this folder and reads this file when it finds one.

This file is the method. [`REFERENCE.md`](REFERENCE.md) lists every file in `kit/` and every function, with what each draws and takes; open it for the surfaces a round draws. Read each in a call of its own, not in one shell call with the skill's `SKILL.md`: together they run past what one tool call returns whole, and what comes back is cut short.

## Drawing a page

A page is a **part**: a script that defines `META` and `states`, and nothing else. `build.mjs` pastes the kit, the template's marks and the part into a copy of the skill's starter, and runs every frame in Node first, so a frame that renders `undefined` or `NaN`, has a size that is not a number, lacks a caption, or redefines a name the kit has fails the build rather than the page, naming the frame and quoting the text. That run has what the browser and Node both define (`URL`, `TextEncoder`, `crypto`, `structuredClone`, `console`) and nothing of either alone, so a part never touches `process`, `require`, `document` or `window`:

```bash
node .agents/wireframe-kit/build.mjs ~/wireframes/parts/YYYY-MM-DD-<surface>-<variant>.js ~/wireframes/YYYY-MM-DD-<surface>-<variant>.html
RAW=3 node .agents/wireframe-kit/build.mjs part.js out.html     # also writes frame 3 alone at true size to the temp folder, and prints where
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

## Checking a page

```bash
node .agents/wireframe-kit/check.mjs ~/wireframes/YYYY-MM-DD-<surface>-<variant>.html            # writes <name>.check.png to the temp folder, and prints where
node .agents/wireframe-kit/check.mjs ~/wireframes/YYYY-MM-DD-<surface>-<variant>.html --frame 3  # frame 3 alone at true size, for a closer look
```

[`check.mjs`](check.mjs) opens a built page once in a downloaded headless Chromium (Playwright's or Puppeteer's, never the Chrome in Applications), turns the marks on, and writes one picture of the whole grid with every frame as large as one image allows, then prints what that picture is too small to settle: script errors and failed loads, a frame that drew blank, content reaching past a frame's edge or past its own box, and every mark with the element it rings and where, or that it ringed nothing because its wrapper has no size. Read the lines first and the picture for the rest: every frame drawn and the one its caption names, the window and its panels where they belong, nothing cut off at a frame's edge, each ring on the element the frame is about. That one picture and the report stand in for the skill's browser-tool check and for any loop of single-frame screenshots; reach for `--frame` only when a line needs a closer look.

## The kit

The kit is `kit/`, one file per surface, pasted in the order `KIT_FILES` in [`kit.mjs`](kit.mjs) gives. Every function is a global that returns HTML, and every one takes finished HTML wherever a proposal needs to put its own thing in (`tabs`, `rows`, `over`, `body`, `head`, `foot`, `lead`, `right`), so a part passes its own pieces in rather than patching the kit's output with `.replace()`.

[`REFERENCE.md`](REFERENCE.md) lists the files and every function, with what each draws and takes, and the shapes a tab, a row and a hold take.

## The scenario

The shared scenario is the chat "Help desk pricing against competitors" (`PRICING_TITLE`, `pricing(stage)` for its transcript): someone at a help desk company lining up competitors' list prices against their own plans, filed under the Pricing project. The other `ROWS`, the `PROJECTS`, the Instrument folder's `FOLDER_ROWS`, the competitors' `PAGES` and the `RELEASES` all come from it. Keep to it so a round's files compare, keep new scenario data to work people do for a business, and add to it rather than renaming what is there. It is invented, prices included, rather than taken from the documents fixture, which holds one chat, and a page's `source` line says so. The home folder is `mac-user`, never a real one.

## The baseline

[`baseline.js`](baseline.js) is a part with one frame per surface as it stands: the chat list in each of its states, the window tabs, the bell and a status pill, Files in each view with its menus and search, Browser, New tab, ⌘K, Apps, the release notes, Settings, Send feedback, a dialog and a toast, the chat with its activity rows, task and live cards, its pane and its cards, a new chat beside the list, the docked draft, the floating chat, the model picker, setup, and the desktop, menu bar extra, notification, context menu and website. Build it and look at it before drawing a round:

```bash
node .agents/wireframe-kit/build.mjs .agents/wireframe-kit/baseline.js ~/wireframes/kit-baseline.html
```

`appWindow({ dark: true })` draws the dark theme for everything built on tokens; hard-coded light colors (page bodies, tiles) stay light. Not in the kit yet, so drawn by hand when a round needs it: an app's own page and a task opened on its own.

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

- **When a round draws a surface the kit lacks**, or corrects one it draws wrong, move that piece into the kit file for its surface as a function, add a frame for it to `baseline.js` (with a `measure` key and a state in `capture.mjs` when the app can reach it), rebuild the baseline, and list it in [`REFERENCE.md`](REFERENCE.md).
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
  --design ~/wireframes/parts/<the design's part>.js --title "Chat replay: <what>" --chat "<the chat's title>" [--pictures | --icons]
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

Only finished pages sit at the top level of that folder (`~/wireframes` in the commands above): a part lives in its `parts/` folder under the page's name with `.js` in place of `.html`, and so does a helper a round pastes in front of its parts. Anything made on the way to a page, such as a concatenated part, a screenshot or the frame page `RAW` writes, goes in your scratch or temp folder, never beside the pages.
