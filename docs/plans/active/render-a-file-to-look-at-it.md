# Letting a task look at what it made

**Status:** proposed, 2026-09-07. Nothing built. Written up because the measurement that motivates it is unusually clean and will go stale otherwise.

## Why

A task writes a drawing, a page, or a document, and has no supported way to turn it into pixels. Measured across two rounds of the same five briefs:

| | Finished briefs | Got real pixels | Changed something after |
| --- | --- | --- | --- |
| Before the eval browser was fixed | 17 | 5 | 0 of 5 |
| After | 16 | 7 | 6 of 7 |

Six of seven, across three different models, from one seam change and no prompt edit. Muse's next call after seeing its octopus was "Removing overlapping label from SVG"; GLM's after seeing its sewing machine was "Tightening the thread path so it hugs the machine instead of looping wide", then a re-shoot and a verify. Both are the defect class that shipped unnoticed the round before.

That is the whole argument. Seeing the work changes the work.

What it still costs is discovery. There is no verb for this, so every model improvises: GLM spent six of thirteen calls finding `pip install resvg-py` after `agent-browser`, two `pnpm add sharp` attempts and the `sharp-images` skill all failed it. Muse burned cairosvg and sharp before the browser screenshot worked.

## Shape

A shell command, sibling to `show`, in the always-loaded command list.

```
$ render output/juggler.svg
✓ work/juggler.png  800x600
  read it with the file tool to see it
```

A command rather than a skill because a skill has to be guessed at, loaded and read before the first attempt, and because what the models typed unprompted was a verb: "Opening the SVG in the browser and screenshotting it." Two of them did load `sharp-images` — the skill that ought to have covered this — and went elsewhere. It is filed under manipulating images, not looking at them.

It reads oddly beside `show`, which puts a file in front of the *user*. `render` puts one in front of the *agent*. Same neighborhood, opposite direction, and the pair is probably clearer than either alone.

## Build it on the browser, not on more binaries

The browser already spans SVG, HTML and PDF, is already wired, and already rewrites a task-relative path onto the per-task asset origin, so `render output/page.html` needs no path handling of its own:

```
$ agent-browser open output/page.html
✓ http://assets.<taskId>.localhost:48500/output/page.html
```

For Word, PowerPoint and Excel, render client-side in that same browser rather than bundling a converter. A small bundled viewer page takes the asset URL, renders the document with a JS library, and the existing screenshot path captures it. Bundling LibreOffice to convert to PDF is tens of megabytes in the installer, a separate binary per platform, and a notarization problem, to reach formats a page can already draw.

It is worth knowing how bad the alternative is: nothing on a stock developer machine renders a workbook. There is no LibreOffice, and Quick Look returns a zoomed, clipped corner of sheet one. Comparing eight models' spreadsheets in the eval meant reading their XML. A task is in exactly the same position, and so is anyone who tries to check one by hand.

## Also worth doing, and cheaper

Make `read_file` on an `.svg` return the source **and** a rendered preview, the way it already returns the image for a `.png`:

```
read_file output/juggler.svg
→ <content>…the source…</content>
→ Rendered preview (800x600) [image attached]
```

Zero discovery. Models already read their own deliverable back on nearly every brief — that habit was never the missing piece — so this converts an existing reflex into pixels at no extra call, for the one format where the defects actually hid. It costs tokens on every SVG read and covers nothing else, so it complements the command rather than replacing it.

## Open

- Which JS renderers, and how much they weigh. The viewer page is the whole Office story and none of it has been prototyped.
- Whether `render` returns the image itself or writes a file the agent then reads. Writing a file is one more call; returning it directly needs a shell command that can carry media, which nothing does today.
- Whether a task should be *told* to render before reporting done, or left to reach for it. The prompt already says to open the result the way the user will see it, and until now that instruction had nothing behind it.
