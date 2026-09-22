# Studio wireframe kit

The pieces of Studio, for drawing a proposed flow with `create-page`'s wireframe template. That template owns everything else: the page shell, true-size frames, the enlarged view, click and changed marks, the marks toggle, and the Share button. This folder only makes the frames look like this product rather than like software in general.

`create-page` comes from the `instrument-org/skills` registry. Its wireframe template looks for this folder and reads this file when it finds one.

## Using it

1. Start from the wireframe template as `create-page` describes.
2. Paste the functions below that the flow calls into the page's script, in place of the template's neutral ones of the same name (this `navItem` replaces that one). Leave out the rest.
3. Draw at true size: a whole Studio window is 1280x800, a settings panel about 520 wide.

The kit draws Studio in its light theme whatever theme the reader has picked: `[color-scheme:light]` on `appWindow` and `surface` is what the skin's `light-dark()` tokens resolve against inside the frame. Write class names out whole, since a class built by interpolation (`bg-${tone}-500`) is invisible to Tailwind's scanner and produces no styles.

## The functions

| Function                             | Draws                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------- |
| `appWindow(sidebar, main, panel?)`   | The whole window: sidebar, conversation column, optional artifact panel |
| `navItem(label, { active, dot })`    | A task row in the sidebar                                               |
| `navGroup(text)`                     | A heading above a run of sidebar rows                                   |
| `conversation(inner)`                | The centered transcript column                                          |
| `dock(inner)`                        | Anchors the composer, or whatever replaces it, at the bottom            |
| `composerBox({ placeholder, busy })` | The composer; `busy` swaps send for stop                                |
| `bubble(text)`                       | A user message                                                          |
| `toolRow(icon, text)`                | A tool call as the transcript shows one                                 |
| `surface(inner)`                     | One piece of UI on its own, for frames that are not a whole window      |

A shape the flow repeats and the kit does not cover becomes a small function in the page. When a second wireframe wants it too, it belongs here.

```js
/** The whole window: sidebar, conversation, and an optional artifact panel. */
const appWindow = (sidebar, main, panel = "") => `
  <div class="flex h-full bg-gray-50 [color-scheme:light]">
    <aside class="w-64 shrink-0 border-r border-border bg-gray-100/70 p-4">
      <div class="mb-4 h-9 rounded-lg bg-gray-200/70"></div>
      ${sidebar}
    </aside>
    <section class="relative min-w-0 flex-1 p-8">${main}</section>
    ${panel ? `<aside class="w-[420px] shrink-0 border-l border-border bg-white">${panel}</aside>` : ""}
  </div>`;

/** A task row in the sidebar. */
const navItem = (label, { active = false, dot = "" } = {}) => `
  <div class="flex items-center gap-2 rounded-md px-3 py-2 ${active ? "bg-gray-200" : ""}">
    ${dot ? `<span class="size-2 shrink-0 rounded-full ${dot}"></span>` : ""}
    <span class="text-[15px] ${active ? "font-medium" : "text-muted-foreground"}">${label}</span>
  </div>`;

/** A group heading above a run of nav items. */
const navGroup = (text, toneClass = "text-muted-foreground") =>
  `<p class="px-3 pt-4 pb-1 text-xs font-medium tracking-wide ${toneClass} uppercase">${text}</p>`;

/** The conversation column, centered the way the app centers it. */
const conversation = (inner) => `<div class="mx-auto max-w-2xl">${inner}</div>`;

/** Anchors its contents where the composer sits. Put the composer, or
 *  whatever replaces it, in here. */
const dock = (inner) => `
  <div class="absolute inset-x-8 bottom-8"><div class="mx-auto max-w-2xl">${inner}</div></div>`;

/** The composer at rest. `busy` swaps the send button for stop. */
const composerBox = ({ placeholder = "", busy = false } = {}) => `
  <div class="grid h-20 grid-rows-[1fr_auto] rounded-[20px] bg-white p-4 shadow-sm">
    ${placeholder ? `<span class="text-sm text-gray-400">${placeholder}</span>` : `<div class="h-2.5 w-32 rounded-full bg-gray-300"></div>`}
    <div class="flex items-center justify-between pt-2">
      <i class="ph ph-plus text-lg text-muted-foreground"></i>
      <div class="grid size-8 place-items-center rounded-full ${busy ? "bg-gray-900" : "bg-gray-300"}">
        <i class="ph ${busy ? "ph-stop" : "ph-arrow-up"} text-sm text-white"></i>
      </div>
    </div>
  </div>`;

/** A user message. The one small corner against three large ones is the
 *  most recognizable detail in the transcript, so keep it. */
const bubble = (text) => `
  <div class="flex justify-end">
    <div class="inline-block max-w-[80%] rounded-tl-xl rounded-tr-sm rounded-br-xl rounded-bl-xl bg-linear-to-b from-card to-gray-25 px-4 py-3 shadow-sm">
      <span class="text-sm">${text}</span>
    </div>
  </div>`;

/** A tool call, as the transcript shows one. */
const toolRow = (icon, text) => `
  <div class="mt-2.5 flex items-center gap-2.5 rounded-lg border border-border bg-white px-3.5 py-2">
    <i class="ph ${icon} text-base text-muted-foreground"></i>
    <span class="text-sm text-muted-foreground">${text}</span>
  </div>`;

/** One piece of UI on its own, for frames that are not a whole window.
 *  Set a smaller w and h on those states. */
const surface = (inner) => `
  <div class="h-full bg-gray-50 p-5 [color-scheme:light]">
    <div class="h-full rounded-xl border border-border bg-white p-5 shadow-sm">${inner}</div>
  </div>`;
```

## Looking like this product

The kit encodes most of this. The table is for what it does not cover, and for checking the kit against source when it looks stale.

| Thing                 | Recipe                                                                                                                                                                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversation column   | `max-w-2xl p-4` ([chat.tsx](../../apps/studio/src/client/components/task/chat.tsx))                                                                                                                                                                  |
| User bubble           | `inline-block max-w-[80%] rounded-tl-xl rounded-tr-sm rounded-br-xl rounded-bl-xl bg-linear-to-b from-card to-gray-25 px-4 py-3 shadow-sm` ([user-message.tsx](../../apps/studio/src/client/components/user-message.tsx))                            |
| Message action button | `rounded-sm p-1 text-muted-foreground` around a `size-3.5` icon, hover `bg-muted/50 text-foreground` ([styles.tsx](../../apps/studio/src/client/lib/styles.tsx))                                                                                     |
| Action row            | hidden until the message is hovered                                                                                                                                                                                                                  |
| Placeholder prose     | `h-[7px] rounded-full bg-gray-300` at varying widths                                                                                                                                                                                                 |
| Error text and stacks | `font-mono text-[11px]` in `rounded-md bg-muted p-3`, stack collapsed behind a caret ([error-details.tsx](../../apps/studio/src/client/components/error-details.tsx))                                                                                |
| Icons                 | Phosphor regular, the set the app uses: `<i class="ph ph-gear"></i>`, sized with Tailwind (`text-sm` is the 14px action-row size). `ph-fill` for the filled weight                                                                                   |
| Brand marks           | A third party's logo (a model provider, a service the frame names) is fetched while writing, checked, and inlined as SVG or a data URI. Never a runtime URL into an icon CDN: those drop brands on request and leave a 404 in every viewer's console |

Two that are wrong on sight if you guess:

- **The user bubble is a white-to-near-white gradient with a shadow, not a grey fill.** The small top-right corner against three large ones is the most recognizable detail in the transcript.
- **Action buttons are small and quiet.** 14px icons at 4px padding, muted until hover. Drawn at 24px with borders, the frame reads as a different product.

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
