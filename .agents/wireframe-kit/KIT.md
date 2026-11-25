# Studio wireframe kit

This folder builds and checks pages of frames for the `wireframe` skill and makes them look like Studio. The skill's `SKILL.md` has the part format, the marks and the rules for titles and notes. That file and this one are all a first page needs: don't read component source, the kit's source, older wireframes or the whole of `REFERENCE.md` to get started.

## Where a frame starts

Choose per frame, and mix them freely on a page.

- **Gray boxes**, for a question of structure or flow, and for any part of a screen the proposal isn't about: `box` and `bars`, inside `card` or a plain bordered `div`.
- **A snapshot** of Studio as it runs, edited by name, for a frame judged by how it sits in a real screen: `snap(state, edit)`. [`SNAPSHOTS.md`](SNAPSHOTS.md) is a short read and has the list of states. Use one for a current-design frame that needs the real look, and for a screen whose look is finished and being kept.
- **The kit's pieces**, for something new in Studio's look: `win`, `card`, `composer`, `bar`, `chip`, `pill`, `crop`, and a function per surface. Find one with `rg -n 'replyBox|menu' .agents/wireframe-kit/REFERENCE.md`. The kit's surfaces lag the app, so take today's screen from a snapshot.

## Build and check

```bash
node .agents/wireframe-kit/build.mjs <part>.frames.html <page>.html
node .agents/wireframe-kit/check.mjs <page>.html            # one picture of the grid, marks on, to the temp folder
node .agents/wireframe-kit/check.mjs <page>.html --frame 3  # frame 3 alone at true size
```

- The build prints a FAIL line with the part's line for each problem and writes the page either way, with an error tile where a frame failed.
- [`check.mjs`](check.mjs) opens the page in a downloaded headless Chromium (never the Chrome in Applications), prints what the picture is too small to settle, and stands in for the skill's browser-tool check. Reach for `--frame` only when a line needs a closer look.
- Both read the skill from `~/.claude/skills/wireframe`, or from `WIREFRAME_SKILL_DIR`.

## Rules

- **Invent nothing around the proposal.** A control, menu item or panel you haven't seen in the app is a gray box or left out.
- **Copy is short and real**: the app's own words for its controls, and the "UI copy" section of the repo's `CLAUDE.md` for new ones. No taglines or blurbs inside a frame; a zero state is a line.
- **One scenario.** Invented data is the kit's help desk pricing chat (`pricing(stage)`, `ROWS`, `FILES`, `SITES`; REFERENCE.md, `scenario.js`), and the `source` line says it is invented. Home folders are `mac-user`.
- **Pass pieces in.** Every kit function takes HTML where a proposal puts its own thing (`tabs`, `rows`, `over`, `body`, `head`, `foot`, `lead`, `right`); don't `.replace()` its output. A part may define a helper under any kit name; only `meta` and `frame` are taken.
- **Classes whole, icons regular.** `bg-${tone}-500` draws nothing, and only Phosphor regular loads (`icon: "lock"`). Outside a window, set `text-foreground` and a ground, or the frame takes the reader's theme. `win(body, { dark: true })` is the dark one.
- **Names** start with the surface, as the skill says, so versions sort together (_Chat tiles: dock over reply box_): Rail, Window bar, Window tabs, Chat list, Chat, Reply box, Pane, Chat tiles, Floating chat, Draft window, Omnibar, Files, Browser, New tab, Command menu, Apps, Release notes, Settings, Send feedback, Bell, Setup; outside the window, Desktop, Menu bar, Dock, Notification, Finder, Website.
- **Never commit a wireframe.** Pages and parts live outside the repository, wherever your own setup keeps them. A decision one settled belongs in the plan's prose or a decision record.

## When you need more

- [`REFERENCE.md`](REFERENCE.md): every kit file and function. Search it for the surface you draw.
- [`baseline.js`](baseline.js): one frame per surface the kit has, each a working call to copy.
- [`PROTOTYPE.md`](PROTOTYPE.md): one live screen instead of frames, and replaying a chat from its records in a design.
- [`MAINTAINING.md`](MAINTAINING.md): measuring the kit against the running app, and adding to or correcting it.
