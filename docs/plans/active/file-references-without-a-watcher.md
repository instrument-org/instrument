# Plan: file references resolve at click, and the folder watcher goes

Status: **designed, not started.** Owner: TBD.

Three mechanisms currently infer, from disk, what the user should see and how fresh it is: a recursive watcher over the task directory, a per-turn diff of that watcher into a change card, and a per-reference existence query at render. All three exist because the app had to guess what a turn produced. It no longer has to guess: a ` ```files ` fence says what the reply hands over ([presentation-syntax.md](presentation-syntax.md)) and `show` says what goes on screen ([pane-tabs-and-the-show-command.md](pane-tabs-and-the-show-command.md)). This deletes the guessing.

The forcing function is [user-chosen-working-folder.md](user-chosen-working-folder.md): the work is about to live in a folder the user picked, which can be a monorepo. A recursive index over that is not a thing to tune, it is a thing not to build.

## The two rules

1. **Nothing resolves a file over the network while rendering.** A reference draws from its path alone. Truth is established when someone clicks.
2. **Freshness is scoped to what is on screen.** Exactly one thing is live — the file the pane is showing — and it is watched on demand, not found inside a standing index.

Everything below follows from those.

## What gets deleted

- **`data-fileChanges`** end to end, and not compatibly: the schema member, `FileChangesCard`, its `chat-stream-data-parts` entry, and the `consumeTurnChanges` call that produces it. Old messages carrying the part render nothing. The fence replaces it, and the agent is answerable for naming what it wants shown.
- **`task-file-watcher.ts`** and the `@parcel/watcher` dependency of this feature, with `files.live.list` and its `seedLiveQuery`. `files.list` stays as a one-shot walk.
- **`CurrentTaskFilesProvider`** and its four hooks, which exist only to answer questions nothing asks anymore.
- **The render-time `fileInfo` queries** in `TaskFileLink` and `AgentFilesBlock`. One is a round trip per link, the other N per fence; both decide something at render that is stale by the time anyone acts on it.
- **`?version=`** on transcript asset URLs.

Already on the `show` plan's list and not repeated here: both auto-open hooks, the `artifactPanel` search param, `external-file-changes.ts`, `file-index-baseline.ts`.

Untouched: **skill change tracking.** It never used the watcher — `workspace-skill-index.ts` is a `readdir` + `stat` snapshot plus write hooks fired from the virtual filesystem, which is the write-tracker pattern the folder plan wants. It survives intact and is the working prototype if file attribution is ever wanted back.

Also untouched: `getTaskLayoutContext`, which walks the directory directly rather than reading the index.

## How a reference renders

From the path, with no lookup:

| Needed | Where it comes from |
| ------ | ------------------- |
| Card shape, icon | The extension, via `getFileType` |
| Thumbnail URL | `assetBase + path` |
| Label | The basename |

For an image, **the asset request is the existence check**: the origin is a static file server, so an `<img>` either loads or 404s and `ImageWithFallback` already draws the failure. That is free, correct at the moment it matters, and needs no new machinery.

For everything else, the card draws optimistically and the click resolves. A file that is gone reports itself then — a toast for a chip, an inline state for a card — which is both the honest moment and the only one that can be accurate about a file deleted a minute ago.

Two consequences to take deliberately:

- **A hallucinated path becomes clickable.** Today it degrades to plain text, which hides that the reply claimed a file at all. Click-then-report makes the claim visible, which is the better failure.
- **The render-time missing state goes**, including the one already built for the fence. It is replaced by the 404 fallback for images and by click for everything else. What survives from that work is the streaming gate, for a new reason: a fence still arriving has a half-typed last line, and an optimistic renderer would draw a card for `output/ch` and then for `output/cha`. **Draw only lines the fence has finished.**

## How the open file stays fresh

One subscription, owned by the pane tab that is showing a file, torn down when the tab closes or the task is switched away from.

Not the transcript. A card is a record of what a reply handed over; if the bytes change while someone reads the conversation, a stale thumbnail is a small harm, and the case that feels like it needs live updating — the agent writing right now — is the message streaming in and the image loading for the first time, which is already live. The message list is **not** virtualized, so a per-card subscription would be per card in the whole transcript.

### The one case this really loses

An agent that overwrites the same path repeatedly — `output/chart.png` three times across a conversation — currently has every card for that path snap to the newest bytes, because `useLiveAssetUrl` rewrites each URL as the index sees a new mtime. Without it, a card already painted keeps the bytes it decoded until something makes it refetch.

Worth being precise about which way that cuts. **The behavior being lost is arguably the wrong one.** A transcript should keep meaning what it meant, and a card in a three-turn-old message silently becoming a picture of something else is history rewriting itself. Losing it moves toward the "resolution happens once" property this design has always wanted, not away from it.

What we cannot do is the fully correct thing — show each card the bytes that existed when it was written — because nothing versions the file. So an old card shows old bytes until it refetches and current bytes afterwards, which is unstable in a small way either direction. Not worth a watcher. If it ever reads as broken, the honest fix is content-addressed history, not a subscription; and the file someone is actually looking at is covered by the pane's own watch. The prompt already steers toward new filenames for revisions, which is what keeps this rare.

### The mechanism

`@parcel/watcher` cannot do this: its API is `subscribe(dir, fn, opts)`, directory-only and recursive-only. The on-demand tier is `fs.watch`, and the portable unit is **the parent directory, non-recursively** — not the file. Per-file is a Linux luxury (one inotify descriptor) and not expressible at all on Windows, where `ReadDirectoryChangesW` is handle-per-directory, or meaningfully on macOS, where FSEvents is subtree-oriented. Parent-directory watching is cheap on all three and collapses several displayed files into one handle.

VS Code runs exactly this shape and the parts worth copying are the failure paths, which are easy to underestimate:

- **A watch that fails is suspended and polled, not dropped.** `fs.watchFile(path, { persistent: false, interval: 5007 })` until the path appears, then the real watch resumes. This is not an edge case for us: the pane will be pointed at a file that was just deleted, or one the agent is about to create.
- **Check whether an existing watch already covers the path** before opening a handle.
- **Throttle the request diff, not the watch.** Tab switches and task switches are diffs, so teardown and stand-up land in the same throttle for free.
- **Correlate requests to their requester**, needed as soon as two windows show the same file.
- **Refuse `fs.watch` on suspected network shares.** New exposure: a user-chosen folder can be a network mount or a cloud-sync root in a way our own directory never was.

References: `nodejsWatcher.ts`, `baseWatcher.ts`, `common/watcher.ts` in VS Code's `platform/files`.

### What replaces each freshness consumer

- **The pane's live mtime** — the subscription above. It also supplies the cache-buster for the pane's own URL, which is the only place one is still needed.
- **The toolbar's file-list popover** — the only surviving reader of the standing index. It needs a list, not a live list: read on open, and refresh when a turn ends.
- **Transcript cards** — no version parameter, so `no-store`, which is already what every mounted file gets.

## One thing to reconcile

[pane-tabs-and-the-show-command.md](pane-tabs-and-the-show-command.md) says "The live file index stays. It is what the sidebar list, the fence's fast path, and the chip's existence check all read." Two of those three readers are deleted here and the third does not need it to be live, so that line should go when this lands. Nothing else in that plan depends on it.

Both plans should also share one path-normalization function rather than two that agree today: `show` and the fence deliberately use the same path grammar, and a `file:` URL is already normalized on the link path but not the fence path.

## Order, and who does it

Interleaved with [pane-tabs-and-the-show-command.md](pane-tabs-and-the-show-command.md), because both rewrite the same three files — `markdown.tsx`'s chip, `files-grid.tsx`'s cards, and `view.tsx` — and both rewrite the same function, the one that opens a file into the pane.

1. **Stateless rendering** (here). Delete the render-time `fileInfo` queries and `?version=` from transcript references; draw from the path; resolve on click. The standing index is still there and simply stops being read by these surfaces. **First**, because it removes two index readers before the other plan has to migrate them.
2. **The whole pane landing** (there). Tabs, `state.json`, `show`, and its deletions. Not divisible; its own plan says so.
3. **The pane subscription** (here). Non-recursive on-demand watch with suspend/poll/resume, owned by the file tab, which step 2 is what creates.
4. **Delete `data-fileChanges`** (here). Product call, taken: the fence is the record. Re-measure adherence first — see Risks.
5. **The file-list popover to a one-shot read**, then delete the watcher, `files.live.list`, and `CurrentTaskFilesProvider`.

**One owner for all five**, not two in parallel. Steps 1, 3, 4, and 5 are consequences of 2 rather than a separate feature, they land in the files 2 rewrites, and splitting them produces conflicts in exactly the code both would be restructuring. Two plans is still right — one answers "how does the pane work", the other "how does a reference resolve and stay fresh", and later readers will arrive with one question or the other — but they are one piece of work.

## Risks

- **The fence is the only record now, and adherence is a prompt property.** Measured across four prompt revisions: the model behind the auto setting used it in every case tested, and `claude-haiku-4.5` dropped it about half the time. A turn that produces a file and does not name it produces nothing the user sees.

  Re-measure before step 4 rather than after, and against the harness's current `MODELS` — which is now frontier-per-provider plus the strongest open-weights one, so it covers the case that actually matters here. Haiku is not the bar; a model someone would run a whole workspace on is.

  **Do not reach for a tool-output nudge**, which is the obvious lever and the wrong one. Measured over four real image-production runs: 24 `write_file` / `edit_file` / `generate_image` calls, and **not one of them wrote a deliverable** — every one wrote a script under `work/`, while every finished file came out of `bash` running that script. A reminder attached to the file tools would fire 24 times naming throwaway scripts and zero times naming what the user asked for. It is not blind to bash; it is anti-correlated with the output.

  That shape is the normal one for real work — write a script, run it, inspect, edit, re-run. The file tools are how the agent writes its own tooling; bash is how that tooling produces the result. Any trigger keyed to a file-producing tool has it backwards, which is the same reason inferring deliverables from disk never worked.

  The reassuring half of the same measurement: both of those runs emitted a correct fence anyway, naming four files produced entirely through bash. The model reaches for it from what it accomplished rather than from which tool it called, which is a better signal than any trigger could supply.
- **`fs.watch` is less reliable than the recursive backends** — duplicate events, rename semantics, network shares. It is watching one directory instead of a tree, so the blast radius is one open tab rather than the whole index.
- **Reading the popover on open loses live file appearance** during a run. Refreshing on turn end covers the common case; if it reads as broken, that surface is a candidate for its own on-demand watch rather than a reason to keep a standing one.
