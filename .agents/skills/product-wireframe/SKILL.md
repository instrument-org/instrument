---
name: product-wireframe
description: Build a static HTML wireframe of a proposed Studio flow, styled with the app's real design tokens and Tailwind. Use when a plan or design brief needs a picture, when asked for a wireframe or mockup of a feature, or when a proposal would be clearer as a sequence of UI states.
---

# Product wireframe

One self-contained HTML file showing a **flow across states**, embedded in a plan or a Notion page. Not a prototype, not a component spec. It exists to make a proposal legible to someone who will not read the plan.

```bash
cp .agents/skills/product-wireframe/template.html docs/plans/active/wireframes-<topic>.html
```

Name it `wireframes-<topic>.html`, put it beside the plan, and link it from the plan.

**Copy the template, then edit only the `states` array and the constants above it.** Everything else in the file is machinery, and about two thirds of it is a theme block a script maintains. Writing one of these from scratch means retyping all of that for nothing.

Four constants sit at the top of the script:

- `VERSION` drives the tab title and a generated favicon badge. Bump it when you revise. Several of these are usually open at once and they are otherwise indistinguishable. The badge is a green square; visual explanations use a dark one, so the two kinds separate in a row of tabs.
- `SUBTITLE` is a short topic label under the title. Two or three words, not a sentence.
- `W` and `H` are the default frame size. Individual states can override with `w` and `h`.

The tab title comes from the `h1`, so write a real one and leave the `<title>` placeholder alone.

Open it when it is written (`open <path>` on macOS). These exist to be looked at, and a path in a sentence is a file nobody opens.

## Draw at true size

**Draw every frame at the size the thing really is.** A whole Studio window is 1280x800. A settings panel is whatever it actually measures, around 520 wide. Use the ordinary type scale inside it: `text-sm`, `text-xs`, real padding.

The page then measures its own width, works out how many frames fit per row, and scales them with `transform` to match. Clicking one opens it as large as the viewport allows, which is why it also works inside a short Notion embed. Nothing renders above its true size.

So: never shrink a drawing by hand, never set a scale, and never reach for `text-[9px]` to make something fit. A frame drawn small is small twice, once in the grid and again when it is enlarged.

`zoom` looks like a shortcut here and is not: it re-runs layout at the smaller size, so text re-wraps and the miniature stops matching the thing it depicts. `transform` composites a box that was laid out once.

## How it is styled

Tailwind v4 compiles in the page from the CDN browser build, with Studio's light theme in an `@theme` block. Write ordinary Tailwind utilities. Do not build a class library in the `<style>` block; if a pattern repeats within one file, that is fine, and it should not graduate into this template.

**Write class names out whole.** The frames are rendered from JavaScript, and a class assembled by interpolation (`bg-${tone}-500`) is invisible to Tailwind's scanner, so it silently produces no styles. Pass the finished class instead: `dot: "bg-warning-500"`.

Anything the frames repeat should become a small function returning a string, so each state is its own content rather than a copy of the whole window. That is most of what keeps these files short.

## The Studio kit

The template ships the pieces of the real app as functions, so a frame is the thing you are proposing rather than a window you rebuilt: `appWindow`, `navItem`, `navGroup`, `conversation`, `dock`, `composerBox`, `bubble`, `toolRow`, `surface`, `bars`.

They exist because these files usually do not get committed, so a previous wireframe is rarely around to copy from. Without them every wireframe redraws the shell slightly differently, and the drift shows up as "this looks like some other product".

Two rules for using them:

- **Delete the ones you do not call.** They are a starting point, not furniture the file has to carry.
- **They do not override the chrome rule.** Draw no sidebar, panel or composer the proposal is not about, even though drawing one is now a single call.

Use `surface` and a smaller `w`/`h` when a frame is one piece of UI rather than a window. One file can mix both.

This is the same shape as the `wireframe` skill we ship to users, with one difference: that one points at a Tailwind bundle served from the task, which only resolves inside that task. These have to render from a plain file and from a Notion HTML embed, so they load the CDN instead.

The tokens are copied into each file, so a script keeps the copy honest:

```bash
node .agents/skills/product-wireframe/scripts/sync-theme.ts          # rewrite them
node .agents/skills/product-wireframe/scripts/sync-theme.ts --check  # fail if stale
```

It reads `globals.css`, resolves the `var()` indirection to literal values, and rewrites whatever sits between the `/* sync:start */` and `/* sync:end */` markers in this template, the sibling visual-explanation template, and every `docs/plans/active/wireframes-*.html`. Run it after touching the ramps, and leave the markers alone.

## The two rules that matter

**Show a sequence, not a screen.** One column per state: resting, the moment of interaction, the result. A single screen shows what something looks like; a sequence shows what happens, which is what a plan needs to argue. Some subjects want a different axis (three kinds of data rather than three moments) and that is fine, as long as the columns are doing comparative work.

**Bars for prose, real copy only where the idea lives.** Every piece of text is a decision the reader has to evaluate. Grey bars for message bodies and anything incidental; real, final-quality copy for the labels, warnings, and buttons that carry the proposal. All lorem reads as unfinished; all real text buries the point.

Corollaries:

- The caption under each frame says **what the frame proves**, not what it depicts. "Nothing is sent by hovering" beats "the thumbs buttons".
- Every frame is numbered automatically, in the caption and again under the enlarged view. Those numbers are how someone refers to one in conversation, so order the `states` array the way you would talk through it.
- Put the burden of proof in the middle frame. That is where the reader looks first.
- Draw no chrome that is not in question. No sidebar, title bar, or tab strip unless the proposal is about them.

## Looking like this product

The kit already encodes most of this. What follows is for the parts it does not cover, and for checking the kit itself against source when it looks stale.

| Thing                 | Recipe                                                                                                                                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversation column   | `max-w-2xl p-4` ([chat.tsx](../../../apps/studio/src/client/components/task/chat.tsx))                                                                                                                                       |
| User bubble           | `inline-block max-w-[80%] rounded-tl-xl rounded-tr-sm rounded-br-xl rounded-bl-xl bg-linear-to-b from-card to-gray-25 px-4 py-2 shadow-sm` ([user-message.tsx](../../../apps/studio/src/client/components/user-message.tsx)) |
| Message action button | `rounded-sm p-1 text-muted-foreground` around a `size-3.5` icon, hover `bg-muted/50 text-foreground` ([styles.tsx](../../../apps/studio/src/client/lib/styles.tsx))                                                          |
| Action row            | hidden until the message is hovered                                                                                                                                                                                          |
| Placeholder prose     | `h-[7px] rounded-full bg-gray-300` at varying widths                                                                                                                                                                         |
| Error text and stacks | `font-mono text-[11px]` in `rounded-md bg-muted p-3`, stack collapsed behind a caret ([error-details.tsx](../../../apps/studio/src/client/components/error-details.tsx))                                                     |
| Icons                 | Phosphor regular via CDN, the set the app uses: `<i class="ph ph-gear"></i>`, sized with Tailwind (`text-sm` is the 14px action-row size). `ph-fill` for the filled weight                                                   |

Two that are wrong on sight if you guess:

- **The user bubble is a white-to-near-white gradient with a shadow, not a grey fill.** The small top-right corner against three large ones is the most recognizable detail in the transcript.
- **Action buttons are small and quiet.** 14px icons at 4px padding, muted until hover. Drawn at 24px with borders, the frame reads as a different product.

## Publishing

Prefer the file over a picture of it. In Notion, upload it with the `create-attachment` tool and place it with `<embed src="file-upload://...">`, which renders it inline in a sandboxed iframe. It stays legible at any zoom and revising it is a re-upload. Scripts run there, so the frames render and the enlarge-on-click works.

Pass the file contents to `create-attachment` as `content`. The upload URL that `create-file-upload` hands back sits behind a bot filter that rejects both `curl` and `node`, so the two-step upload flow does not work from here.

When something needs a raster image, screenshot the file with whatever headless browser the machine has. Four things to get right whichever tool that is:

- Give the page time to compile. Tailwind builds at runtime here, so a screenshot taken on the load event can catch the page unstyled.
- Render at 2x device scale, or the text is mushy everywhere it gets embedded.
- Size the viewport to the whole sheet. Browsers capture the viewport, so anything below the fold is silently cut rather than scaled.
- **Read the image back and look at it.** Clipped captions and ragged frame heights are invisible in the HTML and obvious in the picture.

Write images to a scratch directory, not the repo, unless asked to commit one.
