# Drawing from snapshots

A snapshot is Studio's own page in one state, and `snap(state, edit)` draws a frame from it at true size, edited by name. What the edit leaves alone is the app itself, so there is no component to read and nothing to get wrong.

## Pick a state

The library is `~/wireframes/snaps/`, or wherever `SNAP_LIBRARY` points; a branch whose screens differ keeps its own (`ls -d ~/wireframes/snaps*`), so set it for the build, `peek` and `capture` alike. `INDEX.md` lists the states. Each has three files under `states/`: look at `<name>.png`, search `<name>.outline.txt` for the name of a control, and leave `<name>.json` alone.

```bash
node .agents/wireframe-kit/snap/peek.mjs bell-update "What's new"       # one element as compact HTML, to clone or restyle
node .agents/wireframe-kit/snap/capture.mjs chat-row-menu               # take a state again, in about a minute
```

Capture a state when the library lacks it or the screen has changed since the date in `INDEX.md`. A new one is an entry in `STATES` in `snap/capture.mjs`, in your own worktree: a name, a line on what it shows, its themes, and how to reach it. The capture runs off screen on an invented workspace and leaves every other state as it was. For a state the app can't reach on demand (a failure, a slow load, a screen not built), edit the nearest one.

## Draw it

```html
<script>frame({ title: "Notifications (Current design)", note: "…", body: snap("bell-update.dark") })</script>
<script>frame({
  title: "Notifications",
  note: "We make What's new the main button and quiet Dismiss, so the update reads as good news.",
  body: snap("bell-update.dark", ($) => {
    $({ role: "button", text: "Dismiss", nth: 1 }).css("opacity: 0.7");
    const title = $("Projects are here");
    title.after(title.clone().text("Chats can live in folders now"));
  }),
})</script>
```

- `$(target)` finds one element: its exact words, or `{ contains }`, `{ role, text }`, `{ label }`, `{ selector }`, `{ within, text }`, with `nth` for one of several. One that matches nothing draws the frame as an error naming the close matches, which `check.mjs` prints.
- Edits: `.text()`, `.html()`, `.replace()`, `.before()`, `.after()`, `.append()`, `.prepend()`, `.clone()`, `.remove()`, `.attr()`, `.addClass()`, `.css()`, `.look(target)`, `.find(target)`, `.up("li")`. The skill's `snapshots.md` has the details of each.
- Edits mark nothing: `.note("words")` adds a callout and `.fresh()` NEW, only where the reader should look.
- New markup can use the app's classes written out whole (`bg-popover`, `text-muted-foreground`, `shadow-sm`). A clone of a neighbor is closer than a kit function, which gets only the app's stylesheet there.
- A wholly new surface can replace one region and keep the window around it real. `$.root.append(...)` puts something over everything.
- The in-app browser's page is a picture, so draw over it. Native macOS menus and dialogs are in no snapshot; the kit's `mac.js` has them.
- A dark capture is `<name>.dark`. The build adds each state a part names, so a part never runs the skill's `add-snapshot.mjs`.
- The `source` line says the frames are snapshots of Studio, the date they were captured, and what you drew yourself.

## When something is off

The room starts from `snap/seed/wf-pricing.seed.json`: the files its folder holds (`snap/seed/files/`) and the chats it runs through the model. A machine without the seed makes it on its first capture, which takes a few minutes longer. To give the app something the seed lacks (a kind of chat, a file type, a project), add it to the recipe, delete the cached seed (`~/Library/Caches/instrument-studio-drive/*/walkthrough-seeds/wf-pricing` on a Mac) and capture again.
