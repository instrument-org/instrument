---
name: product-wireframe
description: Build a static HTML wireframe of a proposed Studio flow, styled with the app's real design tokens, and render it to PNG. Use when a plan or design brief needs a picture, when asked for a wireframe or mockup of a feature, or when a proposal would be clearer as a sequence of UI states.
---

# Product wireframe

A wireframe here is one self-contained HTML file showing a **flow across states**, rendered to a PNG that can be pasted into a plan or a Notion page. It is not a prototype and not a component spec. It exists to make a proposal legible to someone who will not read the plan.

Start from `template.html` in this skill directory. Copy it next to the plan it illustrates:

```bash
cp .agents/skills/product-wireframe/template.html docs/plans/active/wireframes-<topic>.html
```

Naming: `wireframes-<topic>.html`, beside the plan in `docs/plans/active/`. Link it from the plan.

## The two rules that matter

**Show a sequence, not a screen.** Three columns, one per state: resting, the moment of interaction, the result. A single screen shows what something looks like; a sequence shows what happens, which is the thing a plan actually needs to argue. If a flow genuinely has two states or four, change the column count in `.row`, not the approach.

**Bars for prose, real copy only where the idea lives.** Every piece of text is a decision the reader has to evaluate. Placeholder bars (`.bar` with a width class) for message bodies and anything incidental; real, final-quality copy for the labels, warnings, and buttons that carry the proposal. A wireframe full of lorem reads as unfinished; a wireframe full of real text buries the point. If you find yourself writing a sentence into a bar's place, ask whether that sentence is the idea.

Corollaries:

- The caption under each frame says **what the frame proves**, not what it depicts. "Nothing is sent by hovering" beats "the thumbs buttons".
- Put the burden of proof in the middle frame. That is where the reader looks first.
- Do not draw chrome that is not in question. No sidebar, no title bar, no tab strip, unless the proposal is about them.

## Accuracy

The wireframe should be recognisable as this product. Values below are from the app; re-check them against source if they look stale, since drift here is what makes a wireframe read as generic.

Tokens live in [globals.css](../../../apps/studio/src/client/styles/globals.css). The template carries the light-theme subset a wireframe needs. Light only: a wireframe is a document illustration.

| Thing                 | Value                                                                                                  | Source                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Body font             | Work Sans 400/500/600                                                                                  | `--font-sans`                                                                   |
| Mono                  | JetBrains Mono                                                                                         | `--font-mono`                                                                   |
| Base radius           | 8px, with sm 4 / md 6 / xl 12                                                                          | `--radius`                                                                      |
| Conversation column   | `max-w-2xl` (672px), `p-4`                                                                             | [chat.tsx](../../../apps/studio/src/client/components/task/chat.tsx)            |
| User bubble           | max 80% width, radius 12/4/12/12, gradient `--card` to `--gray-25`, 8px/16px padding, `--elevation-sm` | [user-message.tsx](../../../apps/studio/src/client/components/user-message.tsx) |
| Message action button | 14px icon, 4px padding, 4px radius, `--muted-foreground`, hover `--muted` at 50%                       | [styles.tsx](../../../apps/studio/src/client/lib/styles.tsx)                    |
| Action row visibility | hidden until the message is hovered                                                                    | [user-message.tsx](../../../apps/studio/src/client/components/user-message.tsx) |
| Icons                 | Phosphor regular                                                                                       | `@phosphor-icons/react`                                                         |

Two things that are easy to get wrong and are visible immediately:

- **The user bubble is a white-to-near-white gradient with a shadow, not a grey fill.** The asymmetric corner (small radius, top right) is the most recognisable detail in the transcript.
- **Action buttons are small and quiet.** 14px icons at 4px padding, muted until hover. Drawing them at 24px with visible borders makes the whole frame look like a different product.

Icons: use the sprite in the template and reference with `<svg class="ico"><use href="#i-thumb-up" /></svg>`. Add symbols as needed at `viewBox="0 0 24 24"`, `stroke-width="2"`, round caps, approximating the Phosphor regular weight. Do not pull an icon font or a CDN.

Self-containment: one file, hand-written CSS, no Tailwind CDN and no build step, so it opens from disk and survives being copied around. The one network dependency is the Work Sans link, which falls back to the system sans if offline.

## Layout

Frames in a row have different natural heights, which leaves the captions ragged. Raise `.frame { min-height }` until the tallest state fits, so all three bottom out together. Do this last, once the content is final.

## Render

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=1320,830 \
  --screenshot=wireframe.png \
  "file:///abs/path/to/wireframes-<topic>.html"
```

`--force-device-scale-factor=2` is what makes the PNG legible when embedded. Set `--window-size` height to fit the whole sheet: Chrome screenshots the viewport, so anything below the fold is silently cut. **Read the PNG back and look at it** before handing it over. Clipped captions and uneven frames are invisible in the HTML and obvious in the image.

Write PNGs to the scratchpad, not the repo, unless asked to commit one.

## Publishing to Notion

Prefer the HTML attachment over a screenshot: upload the file with the Notion `create-attachment` tool and place it with an `<embed src="file-upload://...">` block, which renders it inline in a sandboxed iframe. The wireframe stays live and legible at any zoom, and updating it is a re-upload rather than a re-crop. Use a PNG only when the destination cannot embed.
