# Studio wireframe kit

The pieces of Studio, for drawing a proposed flow with the `wireframe` skill. The skill owns the page: the part format, true-size frames, the grid and enlarged view, marks, groups and the Share button. This folder makes the frames look like this product rather than like software in general, and builds and checks the page with them.

[`REFERENCE.md`](REFERENCE.md) lists every kit file and function with what each draws and takes. Don't read it whole: search it for the surface you draw (`rg -n 'thread|replyBox' .agents/wireframe-kit/REFERENCE.md`), or read the one section you need, in a call of its own.

## Drawing a page

A page is a part of frames, written as the skill's `SKILL.md` describes (`meta()`, then one `frame()` per frame, helpers just above the first frame that uses them), with the kit's functions in scope. Build it with the kit's build, then check it:

```bash
node .agents/wireframe-kit/build.mjs ~/wireframes/parts/YYYY-MM-DD-<surface>-<variant>.frames.html ~/wireframes/YYYY-MM-DD-<surface>-<variant>.html
node .agents/wireframe-kit/check.mjs ~/wireframes/YYYY-MM-DD-<surface>-<variant>.html            # one picture of the grid, marks on, to the temp folder
node .agents/wireframe-kit/check.mjs ~/wireframes/YYYY-MM-DD-<surface>-<variant>.html --frame 3  # frame 3 alone at true size
```

- The build runs every block in Node first and prints a FAIL line with the part's line for a block that fails, a frame that draws `undefined` or `NaN`, a field the page doesn't read, an empty callout, and a color class the skin lacks. The page is written either way, with an error tile where a frame failed. `RAW=3` or `RAW=all` also writes frames alone at true size to the temp folder.
- [`check.mjs`](check.mjs) opens the page once in a downloaded headless Chromium (never the Chrome in Applications) and writes one picture of the whole grid, then prints what the picture is too small to settle: script errors, failed loads, error tiles, a blank frame, content past a frame's edge, and each mark with what it rings. Read the lines first and the picture for the rest. That one picture stands in for the skill's browser-tool check; reach for `--frame` only when a line needs a closer look.
- It reads the skill from `~/.claude/skills/wireframe`, or from `WIREFRAME_SKILL_DIR`. A part written as a JS file with `META` and `states` still builds the same way.

A part may define a helper under any kit name (`row`, `card`, `W`); only `meta` and `frame` are taken. Every kit function takes finished HTML wherever a proposal puts its own thing (`tabs`, `rows`, `over`, `body`, `head`, `foot`, `lead`, `right`), so pass your pieces in rather than patching the kit's output with `.replace()`.

## Where a frame starts

- **A snapshot** of Studio as it runs, edited by name: `snap(state, edit)`. Reach for one whenever the frame is about a screen the app already has. [`SNAPSHOTS.md`](SNAPSHOTS.md) is the library and how to use it.
- **The baseline**, [`baseline.js`](baseline.js): one frame per surface as it stands (the chat list, window tabs, Files, Browser, New tab, ⌘K, Apps, Settings, Send feedback, the chat and its cards, the docked draft, the floating chat, the model picker, setup, and the Mac around the window). Build it and look before a round, then copy the nearest frame's object into your `frame(...)` and change only what the proposal argues about:

```bash
node .agents/wireframe-kit/build.mjs .agents/wireframe-kit/baseline.js ~/wireframes/kit-baseline.html
```

- **The pieces**, for what neither has: `win`, `card` and `composer` in Studio's look, plus the skill's `bar`, `chip`, `pill`, `crop` and `box` (REFERENCE.md, "Pieces").

## The scenario

The shared scenario is the chat "Help desk pricing against competitors" (`PRICING_TITLE`, `pricing(stage)` for its transcript): someone at a help desk company lining up competitors' list prices against their own plans, filed under the Pricing project. The other `ROWS`, the `PROJECTS`, the Instrument folder's `FOLDER_ROWS`, the competitors' `PAGES` and the `RELEASES` all come from it. Keep to it so a round's files compare, keep new scenario data to work people do for a business, and add to it rather than renaming what is there. It is invented, prices included, and a page's `source` line says so. The home folder is `mac-user`, never a real one.

## What rounds here keep correcting

- **Draw the real window.** The skill says to draw no chrome a proposal is not about; in this product the opposite holds, because a proposal is judged by how it sits in the window as it is. Start from `appWindow` (or `win`) and the baseline frame nearest the proposal, and crop to a part only when the frame is about one control.
- **Draw only what the app has, unless the proposal adds it.** No Home page, no inline task cards, no invented panels, menu items or widths. Anything new is wrapped in `fresh` so it reads as the proposal, and everything else matches the baseline.
- **Read the component first.** Before drawing a surface the app has, read its component under `apps/studio/src/client/` or take its snapshot, so the frame matches what ships today.
- **Pass pieces in, don't patch them.** Every function takes HTML where a proposal puts its own thing; a `.replace()` on kit output breaks the next time the kit changes.
- **Mark sparingly.** One `clickable` per frame at most, on the frame before the click, never over the content it reveals. Leave marks off a page meant for screenshots.
- **Copy is short and real.** No taglines, tags, or explanatory blurbs inside the frame; a zero state is a line, not a paragraph. Use the pricing scenario's words where they fit, the app's own words for its controls, and the "UI copy" section of the repo's `CLAUDE.md` for anything new.
- **Fewer takes when the question is narrow.** Several sibling files suit an open question; a narrow one gets one file.
- **Stay in the kit's look.** Kit functions, classes and tokens only; a frame that drifts into a generic component library's styling is the wrong product.

Icons are Phosphor regular only (`ph ph-name`; kit functions take the bare name, `icon: "lock"`): the starter loads no other weight, so `ph-fill` draws nothing. The kit draws Studio in its light theme whatever the reader picked; `appWindow({ dark: true })` or `win(body, { dark: true })` draws the dark one for everything built on tokens. Anything drawn outside a window sets its own `text-foreground` and ground, or it inherits the reader's theme. Write class names out whole, since a class built by interpolation (`bg-${tone}-500`) produces no styles. A third party's logo is inlined in `brands.js`, never a runtime URL.

## Naming a page

The skill sets the rules: the surface, a colon, then what this version tries. Use these names for the surfaces:

Rail, Window bar, Window tabs, Chat list, Chat, Reply box, Pane, Chat tiles, Floating chat, Draft window, Omnibar, Files, Browser, New tab, Command menu, Apps, Release notes, Settings, Send feedback, Bell, Setup; outside the window, Desktop, Menu bar, Dock, Notification, Finder, Website.

A page about how two surfaces share the screen names both of them (_Page and chat: chat as corner picture_). Versions that answer the same question start with the same surface, so they sort together: _Chat tiles: dock over reply box_, _Chat tiles: dock under reply box_.

## Where the files go

Wireframes are working artifacts, not history: write them outside the repository, wherever your own setup keeps pages, and never commit one. A decision a wireframe settled belongs in the plan's prose or a decision record. Only finished pages sit at the top level of that folder (`~/wireframes` above): a part lives in its `parts/` folder under the page's name, and anything made on the way (a screenshot, the frames `RAW` writes) goes in your scratch or temp folder.

## When you need more

- [`PROTOTYPE.md`](PROTOTYPE.md): one live screen instead of frames, and replaying a chat from its records in a design.
- [`MAINTAINING.md`](MAINTAINING.md): measuring the kit against the running app, and adding to or correcting it.
