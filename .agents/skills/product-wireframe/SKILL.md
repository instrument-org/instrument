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

## How it is styled

Tailwind v4 compiles in the page from the CDN browser build, with Studio's light theme in an `@theme` block. Write ordinary Tailwind utilities. Do not build a class library in the `<style>` block; if a pattern repeats within one file, that is fine, and it should not graduate into this template.

This is the same shape as the `wireframe` skill we ship to users, with one difference: that one points at a Tailwind bundle served from the task, which only resolves inside that task. These have to render from a plain file and from a Notion HTML embed, so they load the CDN instead.

The tokens are copied into each file, so a script keeps the copy honest:

```bash
node .agents/skills/product-wireframe/scripts/sync-theme.ts          # rewrite them
node .agents/skills/product-wireframe/scripts/sync-theme.ts --check  # fail if stale
```

It reads `globals.css`, resolves the `var()` indirection to literal values, and rewrites whatever sits between the `/* sync:start */` and `/* sync:end */` markers in the template and every `docs/plans/active/wireframes-*.html`. Run it after touching the ramps, and leave the markers alone.

## The two rules that matter

**Show a sequence, not a screen.** One column per state: resting, the moment of interaction, the result. A single screen shows what something looks like; a sequence shows what happens, which is what a plan needs to argue. Some subjects want a different axis (three kinds of data rather than three moments) and that is fine, as long as the columns are doing comparative work.

**Bars for prose, real copy only where the idea lives.** Every piece of text is a decision the reader has to evaluate. Grey bars for message bodies and anything incidental; real, final-quality copy for the labels, warnings, and buttons that carry the proposal. All lorem reads as unfinished; all real text buries the point.

Corollaries:

- The caption under each frame says **what the frame proves**, not what it depicts. "Nothing is sent by hovering" beats "the thumbs buttons".
- Put the burden of proof in the middle frame. That is where the reader looks first.
- Draw no chrome that is not in question. No sidebar, title bar, or tab strip unless the proposal is about them.

## Looking like this product

Values worth getting right, since drift here is what makes a wireframe read as generic. Re-check against source if they look stale.

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

## Layout

Frames in a row have different natural heights, which leaves the captions ragged. Raise `min-h-*` on the frames until the tallest state fits, so they bottom out together. Do it last, once the content is final.

## Publishing

Prefer the file over a picture of it. In Notion, upload it with the `create-attachment` tool and place it with `<embed src="file-upload://...">`, which renders it inline in a sandboxed iframe. It stays legible at any zoom and revising it is a re-upload.

When something needs a raster image, screenshot the file with whatever headless browser the machine has. Four things to get right whichever tool that is:

- Give the page time to compile. Tailwind builds at runtime here, so a screenshot taken on the load event can catch the page unstyled.
- Render at 2x device scale, or the text is mushy everywhere it gets embedded.
- Size the viewport to the whole sheet. Browsers capture the viewport, so anything below the fold is silently cut rather than scaled.
- **Read the image back and look at it.** Clipped captions and ragged frame heights are invisible in the HTML and obvious in the picture.

Write images to a scratch directory, not the repo, unless asked to commit one.
