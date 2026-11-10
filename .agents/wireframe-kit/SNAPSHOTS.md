# Drawing from snapshots

A frame can start from Studio as it runs instead of from the kit's redrawing of it. `snap/capture.mjs` keeps the app's own DOM in each state a round may start from, and `snap(state, edit)` draws a frame from one, edited by name. Whatever the edit leaves alone is the app itself, in its real layout, type and theme, so it cannot be out of date or invented. Every edit is marked "new" unless it says `{ quiet: true }`, so the reader sees exactly what the proposal changes, and pressing B on the page shows every frame as it was captured, before the edits.

## When to snapshot and when to draw

- **Snapshot** a frame that is about how something sits in the screen as it is: a change to a control, a row, a menu, a card, a panel, in a screen the app already has. This is most rounds.
- **Draw** with the kit, or in grey bars, a frame about a flow whose screens don't exist yet, or one where the screen's detail would distract from the question. A wholly new surface can still sit in a snapshot: replace the region it takes with your own markup and keep the window around it real.
- Mix them freely on one page. Fidelity is a choice per frame.

## The library

`~/wireframes/snaps/` (or `SNAP_LIBRARY`). Read its `INDEX.md` first: every state, whether it has a dark capture (`<name>.dark`), and what it shows. Each state has three files under `states/`: `<name>.png` (look at it before you write anything), `<name>.outline.txt` (every control by the name `$()` finds it by) and `<name>.html` (the snapshot; don't read it whole, use `peek`).

```bash
node .agents/wireframe-kit/snap/peek.mjs bell-update "What's new"                       # one element as compact HTML
node .agents/wireframe-kit/snap/peek.mjs files-table '{"role":"row","nth":3}' --depth 4  # a JSON target, deeper
```

Peek before you clone or restyle something, so you know its classes and what is inside it.

## snap(state, edit)

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
      $({ role: "button", text: "What's new" }).click();
    }),
  },
];
```

`$(target)` finds exactly one element, and fails the build, naming the frame and the close matches, when it finds none or several. A target is the element's words (`"Send"`), or `{ text, contains, label, role, selector, nth, within }` alone or together. Words find the innermost element holding them (the `<span>` inside a button); add `role` (`button`, `link`, `textbox`, `heading`, `listitem`, `row`, `menuitem`, `tab`, `dialog`, …) to get the element itself, or `.up("button")` to climb. `$.root` is the frame, for something positioned over everything (`$.root.append(...)` with `absolute` and a `left`/`top`).

| Edit | Does |
|---|---|
| `.text(to)`, `.text(from, to)` | changes words; the one-argument form needs exactly one piece of text inside |
| `.html(s)`, `.replace(s)` | new insides, or a new element in its place |
| `.before(x)`, `.after(x)`, `.append(x)`, `.prepend(x)` | puts HTML or a clone beside or inside it |
| `.clone()` | a copy to change, then place with the above; the copy is marked once placed |
| `.look(target)` | takes another element's classes and variant: "make this button look like that one" |
| `.addClass(c)`, `.removeClass(c)`, `.css("width: 320px")`, `.attr(n, v)` | restyles; to override a class, remove it too, since the app's own class may win |
| `.remove()`, `.hide()` | takes it out, or keeps its room and draws nothing |
| `.find(target)`, `.up(selectorOrRole)` | moves within or around it |
| `.click()`, `.mark(label)` | the frame's one click mark, or a mark of your own word |

Each edit takes a last `{ quiet: true }` for a change that isn't the proposal, such as words changed to fit the scenario. New markup you write inside a snapshot is drawn by Studio's own stylesheet first, so use the app's classes and tokens (`bg-popover`, `text-muted-foreground`, `border`, `shadow-sm`, `rounded-xl`): peek a neighbor and copy its classes, or clone it, rather than inventing a look. Kit functions work inside a snapshot too, though a clone of the real thing beside them is closer.

## Rules

- Start from the state nearest the proposal and change only what the proposal is about. If the change needs a state the library lacks, take the nearest one and edit your way there (open a menu by adding its markup, cloned from a menu that is in another state), and say so in the source line.
- One `.click()` per frame, on the thing clicked to get to the next frame.
- The window's lights are drawn on every snapshot frame. The in-app browser's page is a picture of the page, not its DOM: draw over it, don't edit into it. Native macOS menus and dialogs are not in any snapshot; draw them with the kit's `mac.js`.
- `check.mjs` reports content "reaching past its own box" inside the app's own scroll areas (tables, the chat list). Those are the app's, not yours; read only the lines about what you added.
- The page's `source` line says the frames are snapshots of Studio, the date the library was captured (`INDEX.md`), and what you drew yourself.
