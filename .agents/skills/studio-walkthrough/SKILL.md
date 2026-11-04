---
name: studio-walkthrough
description: Record a walkthrough of a Studio feature from a script, then build it into a chaptered player, looping snippets, HTML stills an agent can read, and MP4 or GIF clips. Use when asked for a walkthrough, demo, product video, feature clip, changelog GIF or release-note footage of Studio, or for stills of a flow to hand an agent.
---

# Studio walkthroughs

A take is Studio driven by a short script in a clean room, recorded as it runs: the page itself, through the internal repo's recorder (rrweb), and beside it a track of what the script meant (chapters, captions, presses, keys, camera pushes, stills). Everything a person watches is built from that one recording afterwards, so the chapters, the snippets, the stills and the clips always agree, and a take is re-cut without re-recording.

The replay is the app's own DOM, styles and fonts, so it matches a live screenshot to within half a percent of pixels and stays sharp when the camera pushes in. [DESIGN.md](DESIGN.md) is how it is built and why, with its sources; read it before changing the skill.

```bash
W=$(git rev-parse --show-toplevel)/.agents/skills/studio-walkthrough/scripts/walkthrough.mjs

node $W seed examples/household.seed.json          # once: a clean room with sample chats
node $W take my-feature.walk.mjs --seed household --out ~/walkthroughs/my-feature
open -g ~/walkthroughs/my-feature/contact-sheet.png  # look before anyone watches
node $W render ~/walkthroughs/my-feature --chapter 2 --gif
node $W share ~/walkthroughs/my-feature --page snippets
```

Commands that drive Studio need the shell's sandbox off, as `studio-drive` does.

## Seed

A seed file names the chats to start, with real agent turns, files to put in the workspace, and the model New starts with:

```json
{
  "name": "household",
  "chats": ["Help me compare three quotes for kitchen cabinets …", "…"],
  "files": { "Projects/Garden/AGENTS.md": "---\nemoji: 🌱\n---\n\nAnswer in metric." },
  "newChatModel": "Claude Haiku"
}
```

A file's value is its text, or `"@<path>"` to copy a file from beside the seed file, for pictures. `seed` boots the `walkthrough` clean room fresh with the developer's sign-ins, makes all that, and keeps a copy; every `take` puts the copy back first. Keep sample data generic: no real names, paths or chats. A seed lives in studio-drive's cache for this checkout and is reaped with it; seeding again takes a minute.

## Write the walk

`node $W open <seed>` boots the seed's clean room and leaves it running, to find names and try a step with `studio-drive` (`snapshot`, `click`, `shot`, each with `--clean-room walkthrough`) before writing it down.

A walk script is a `studio-drive run` script that drives Studio through `createAct` ([examples/projects.walk.mjs](examples/projects.walk.mjs) is a whole one). Address things by the name a person sees, the way `studio-drive snapshot` prints them:

| Call | Does |
|---|---|
| `act.chapter(title, caption)` | starts a chapter; the caption shows under the replay |
| `act.click(target, { right, double })` | moves the hand there in an arc, presses |
| `act.hover(target)` | moves there and rests, for what shows only under a hand |
| `act.type(text)` | types at a person's pace into what has focus |
| `act.key("Enter")` | presses a key or chord, shown as keycaps |
| `act.caption(text)` | a caption of its own |
| `act.camera(target, { zoom })`, `act.camera(null)` | pushes in by hand and back out |
| `act.still(name, caption, { poster })` | the page as HTML and PNG; `poster` makes it its chapter's picture |
| `act.waitFor(expression)`, `act.hold(ms)` | waits on the page, or for a beat |

The script gets `args.out` (hand it to `createAct`) and `args.workspace`, the clean room's folder, for Files addresses (`/files?path=<folder in it>&root=<args.workspace>&view=list`). `act.prepare({ rootCrumb: path.basename(args.workspace) })` hides the address bar's folders above the workspace, which name this machine's own.

A target is `{ text }` (the exact name), `{ contains }`, `{ label }` (aria-label), `{ placeholder }`, or `{ selector }`, alone or together. A target covered by something else is refused rather than clicked through.

The camera pushes in by itself wherever the hand keeps working in one small area (a dialog, a row and its menu, a field being typed into) and pulls back as the hand leaves; a chapter opens wide. Add `act.camera` only for what the hand never touches, such as an answer appearing. An agent's answer is sped through at 3x, from a moment after Enter until the take's next still.

Presentation mode hides the development pills and swaps the signed-in account's photo while recording, and the build takes this machine's paths out of every file. It cannot reach what a model writes: an answer can still name the signed-in person.

## Look before sharing

`take` ends with `contact-sheet.png`, a frame every two seconds of the cut. Read it the way a designer would, and fix the walk and take again rather than explain a fault: a window left open, a press that missed, the camera on an empty corner, a caption over what it describes.

## What a take folder holds

| File | For |
|---|---|
| `snippets.html` | a loop per chapter, the easiest to take in |
| `chapters.html` | the whole take, chapters beside it; Open this moment opens any frame as its own page |
| `stills.html` | each still as a picture, the live page and an outline; Copy for agent hands over all three |
| `video/` | `render` writes MP4s here at 1080p, `--gif` a GIF beside each, `--plain` one without captions or camera |
| `share/` | `share` writes a page as one file (data and posters inside) for the instrument-page skill's `share.mjs`; the host takes up to 8 MB, about four minutes of Studio |
| `recording/` | the raw take: `events.jsonl`, `script.jsonl`, the stills as taken |

## Limits

- The in-app browser's pages run in their own processes, so a DOM recording does not see them.
- A movie renders slower than real time while CSS animations run on the clock, so entrances look quicker in an MP4 than in the app.
- Hover follows the recorder's 50 ms pointer samples, a little behind the drawn hand.
- Agent answers differ every take; captions describe what happens, never quote it.

## The bundles

`vendor/capture.js` and `vendor/player.js` are built from the internal repo's recorder and the sources in `player/`: `node vendor/build.mjs <internal checkout>` after changing either. The capture needs the recorder's `maskInputs` option.
