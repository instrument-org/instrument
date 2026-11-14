# Drawing from snapshots

A frame can start from Studio as it runs instead of from the kit's redrawing of it. `snap/capture.mjs` keeps the app's own page in each state a round may start from, and `snap(state, edit)` draws a frame from one through the wireframe skill's snapshot frames: the page in an iframe at true size, edited by name. Edits mark nothing: `.note("words")` adds a callout and `.fresh()` NEW, only where the reader should look. Whatever the edit leaves alone is the app itself, in its real layout, type and theme, so it cannot be out of date or invented.

How snapshot frames work, every target and every edit is the skill's: read "Frames from a snapshot" in its `SKILL.md` and in its `patterns.md` (the installed skill, `~/.claude/skills/wireframe`) before a round. This file is only what Studio adds: the library, and how `snap()` differs in a kit part.

## When to snapshot and when to draw

- **Snapshot** a frame that is about how something sits in the screen as it is: a change to a control, a row, a menu, a card, a panel, in a screen the app already has. This is most rounds.
- **Draw** with the kit, or in grey bars, a frame about a flow whose screens don't exist yet, or one where the screen's detail would distract from the question. A wholly new surface can still sit in a snapshot: replace the region it takes with your own markup and keep the window around it real.
- Mix them freely on one page. Fidelity is a choice per frame.

## The library

`~/wireframes/snaps/` (or `SNAP_LIBRARY`). Read its `INDEX.md` first: every state, whether it has a dark capture (`<name>.dark`), and what it shows. Each state has three files under `states/`: `<name>.png` (look at it before you write anything), `<name>.outline.txt` (every control by the name `$()` finds it by) and `<name>.json` (the snapshot; don't read it whole, use `peek`).

```bash
node .agents/wireframe-kit/snap/peek.mjs bell-update "What's new"                       # one element as compact HTML
node .agents/wireframe-kit/snap/peek.mjs files-table '{"role":"row","nth":3}' --depth 4  # a JSON target, deeper
```

Peek before you clone or restyle something, so you know its classes and what is inside it.

### A state the library lacks, or one gone stale

When the state a frame needs is missing, or its row in `INDEX.md` says it was captured more than a week ago, capture it rather than editing a neighbor your way there:

```bash
node .agents/wireframe-kit/snap/capture.mjs chat-row-menu    # one state, light and dark if it asks for both
```

It boots the pricing scenario's clean room off screen, signed in, puts the state's snapshot, picture and outline in the library, adds its row to `INDEX.md`, leaves every other state as it was, and stops the room; a state takes about a minute. A state that isn't there yet is one entry in `STATES` in `snap/capture.mjs`: its name, a line on what it shows, its themes, and how to reach it from a window with one tab open (open a chat, click a control by its name, right-click a row). Look at its `.png` before you draw from it. With no name, the command captures every state.

## snap(state, edit) in a part

```js
const states = [
  { title: "Notifications (Current design)", note: "…", body: snap("bell-update.dark") },
  {
    title: "Notifications",
    note: "We make What's new the main button and quiet Dismiss, so the update reads as good news.",
    body: snap("bell-update.dark", ($) => {
      $({ role: "button", text: "Dismiss", nth: 1 }).css("opacity: 0.7");
      const title = $("Projects are here");
      title.after(title.clone().text("Chats can live in folders now"));
    }),
  },
];
```

- The state is a library name, not a file: `build.mjs` puts every state the part names into the page with the skill's `add-snapshot.mjs`, so a part never runs it.
- The build checks that each state is in the library. The edits run on the page, so a target that matches nothing stops the page with an error naming the close matches, which `check.mjs` prints.
- The window's lights are drawn over every snapshot frame.
- The library keeps the app's whole stylesheets, and `build.mjs` keeps in the page only the rules whose classes appear in the states the part names or anywhere in the part's or the kit's source. So new markup you write inside a snapshot can use any of the app's classes and tokens, written out whole (`bg-popover`, not `bg-${tone}`, which the page would draw unstyled) (`bg-popover`, `text-muted-foreground`, `border`, `shadow-sm`, `rounded-xl`): peek a neighbor and copy its classes, or clone it, rather than inventing a look. Kit functions inside a snapshot get only the app's stylesheet, not the page's, so a clone of the real thing is closer.
- `$.root` is the snapshot's own body, for something positioned over everything (`$.root.append(...)` with `absolute` and a `left`/`top`), in the app's colors.

## Rules

- List the states first. Before drawing, write down every state the proposal passes through (empty, loading, an error, many items, dark, the moment after each action) and give each its own frame. Capture any the app can reach that the library lacks; edit a snapshot your way to the rest. A page that shows only the happy path is one a reader can't decide from.
- Start from the state nearest the proposal and change only what the proposal is about. If the change needs a state the app can reach, capture it; one it can't reach on demand (a failure, a slow load, a screen not built yet) you edit your way to from the nearest state (open a menu by adding its markup, cloned from a menu that is in another state), and say so in the source line.
- The in-app browser's page is a picture of the page, not its DOM: draw over it, don't edit into it. Native macOS menus and dialogs are not in any snapshot; draw them with the kit's `mac.js`.
- The page's `source` line says the frames are snapshots of Studio, the date the library was captured (`INDEX.md`), and what you drew yourself.
