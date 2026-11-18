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

Commands that drive Studio need the shell's sandbox off, as `studio-drive` does. Studio boots from the checkout the skill's scripts sit in, with the shell's environment: run a worktree's own copy to film its feature, and set `INSTRUMENT_PLATFORM_API` to point the take at a stand-in API.

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

A file's value is its text, or `"@<path>"` to copy a file from beside the seed file, for pictures. A seed with no `chats` needs no signed-in model. `seed` boots the `walkthrough` clean room fresh with the developer's sign-ins, makes all that, and keeps a copy; every `take` puts the copy back first. Keep sample data generic: no real names, paths or chats. A seed lives in studio-drive's cache for this checkout and is reaped with it; seeding again takes a minute.

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

## Feature clips

A clip for What's new or a release note plays once, muted, at most 448 pixels wide, beside one line. Judge it there, never from a full-size frame: a whole 1240-pixel window shows Studio's 14 px text at 5 px.

```bash
node $W render ~/walkthroughs/my-feature --clip   # video/walkthrough-clip.mp4, 3:2, its poster, strip and check
node $W check ~/walkthroughs/my-feature/video/walkthrough-clip.mp4
```

`--clip` renders without captions, shows keys pressed large in the middle, and checks the result. Each problem prints as `FAIL <what>: <measured> -> <fix>`:

| Check | Limit | Measures |
|---|---|---|
| lead | 0.6 s | first frame to the first change |
| dead | 1.2 s | longest stretch with nothing changing |
| tail | 1.6 s | last change to the end |
| length | 9 s | the whole clip |
| text | 8.5 px | Studio's body text as shown, wherever the hand or a key acts |

Text shows at 14 × UI zoom × camera zoom × 448 ÷ window width, so a clip needs both levers:

- **Raise the app's UI zoom** before the take: `window.api.keptState.set("view", "zoom.v1", 1.5)`, then reload. Use 1.25 where 1.5 truncates the thing being shown.
- **Frame only the feature from the first frame.** An `act.camera(target, { ms: 1, tight: true, zoom: 3 })` noted before `act.begin` frames the take before it starts. `tight` drops the padding, and a target may be `{ box: { x, y, w, h } }` measured from the page.
- **Start on the action.** Park the hand next to its first target and give a click a short `ms`, so something changes within half a second. Show one idea: a second idea is a second clip.
- **Measure boxes once the page holds still.** A sidebar closing or a pane opening animates, and a box read during it is not where the take finds it.
- **Hover right to left** along a row whose items widen under the hand, so each one stays where the hand finds it.

`--clip` also writes `walkthrough-clip-strip.png`: the clip at 448 pixels, a frame every half second, each stamped with its text size. Read it, then hand it with the line it goes beside to a fresh agent, asking what a first-time viewer would think it shows and where it wastes time, before anyone else watches it.

## What a take folder holds

| File | For |
|---|---|
| `snippets.html` | a loop per chapter, the easiest to take in |
| `chapters.html` | the whole take, chapters beside it; Open this moment opens any frame as its own page |
| `stills.html` | each still as a picture, the live page and an outline; Copy for agent hands over all three |
| `video/` | `render` writes MP4s here at 1080p, `--gif` a GIF beside each, `--plain` one without captions or camera, `--clip` a feature clip |
| `share/` | `share` writes a page as one file (data and posters inside) for the instrument-page skill's `share.mjs`; the host takes up to 8 MB, about four minutes of Studio |
| `recording/` | the raw take: `events.jsonl`, `script.jsonl`, the stills as taken |

## Video in the page

A page's `<video>` replays from its file's URL: `render` sets each video to its frame's time and waits for the seek before capturing, and the live pages let it play, so it moves as smoothly as the app's. A file only Studio can reach (an `instrument-local://` one in Files) does not load in a replay.

For any clip of a page with a moving video in it, take one here. Studio's own screenshots (`studio-drive shot`, CDP `Page.captureScreenshot`) never draw a new video frame, and a video laid over screenshots afterwards, or a capture taken before a seek lands, stutters against the page.

## Limits

- The in-app browser's pages run in their own processes, so a DOM recording does not see them.
- A movie renders slower than real time while CSS animations run on the clock, so entrances look quicker in an MP4 than in the app.
- Hover follows the recorder's 50 ms pointer samples, a little behind the drawn hand.
- Agent answers differ every take; captions describe what happens, never quote it.

## The bundles

`vendor/capture.js` and `vendor/player.js` are built from the internal repo's recorder and the sources in `player/`: `node vendor/build.mjs <internal checkout>` after changing either. The capture needs the recorder's `maskInputs` option.
