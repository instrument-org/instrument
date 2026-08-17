# Plan: a tabbed pane the agent can open into

Status: **landed.**

The right pane holds one artifact at a time, keeps that choice in a URL search param, and two hooks race each other to guess what belongs there. The agent, meanwhile, cannot put anything in it at all. This replaces all of that at once: the pane becomes a tab strip whose state lives on disk beside the task, and `show` is how the agent opens something into it.

It is the imperative half of [presentation-syntax.md](../active/presentation-syntax.md). A ` ```files ` fence is how a reply hands files over and leaves a record; `show` is how it puts one on screen right now. The two are separate on purpose: closing the pane must not erase what the reply said it produced.

Sequenced with [file-references-without-a-watcher.md](file-references-without-a-watcher.md), which deletes the standing file index this plan leaves alone and gives the open tab its own watch. Its stateless-rendering step lands **before** this one (it shrinks what the chip migration here has to touch); the rest lands after, because the tab is what owns a subscription. Same owner for both is the recommendation there.

## What exists now

`artifact-panel.ts` is a single-slot discriminated union, `file | browser`, parsed out of the task route's `artifactPanel` search param. Nine files write it, at eleven call sites: [view.tsx](../../../apps/studio/src/client/components/task/view.tsx) (which both sets and clears), the file chip in [markdown.tsx](../../../apps/studio/src/client/components/markdown.tsx), the cards in [files-grid.tsx](../../../apps/studio/src/client/components/files-grid.tsx), `use-auto-open-output-artifact.ts`, `use-auto-open-browser-artifact.ts`, the composer globe via `use-browser-artifact-toggle.ts`, and three message-part components that open the file they are about: [file-tool-card.tsx](../../../apps/studio/src/client/components/message-part/file-tool-card.tsx), [tool-read-file.tsx](../../../apps/studio/src/client/components/message-part/tool-read-file.tsx), and [tool-generate-image.tsx](../../../apps/studio/src/client/components/message-part/tool-generate-image.tsx) (twice). They all build the same `{ filePath, modifiedAt, type: "file" }` literal, so the migration is mechanical, but it is nine files rather than the six this plan first counted. The two auto-opens contend for the same slot, so whichever fires last wins and the other's work is invisible.

Separately, `external-file-changes.ts` diffs the task-directory file index against a per-session baseline at the top of every message, so the agent can be told what the user touched between turns.

## The decisions, and why

**Pane state goes in `state.json`, not the URL.** A positional tab list does not belong in a search param: it is too much data, drag-reorder would rewrite the URL on every drop, and nothing outside the app ever links to it. `task-state-store.ts` already holds exactly this kind of per-task UI state, and `promptDraft` is the precedent for writing it from the client on a debounce.

**Which turns `show` from an event into a state mutation, and that is the whole design.** An open that must fire exactly once needs delivery, replay suppression, and a restore path of its own. An open that is a write to task state needs none of them: the agent and the user mutate the same field, the renderer reconciles to it, and reopening a task is a read rather than a replay. Everything hard about this feature dissolves at that one decision.

**One command for files and URLs.** `show output/chart.png` and `show https://example.com` are the same act from the user's side. The URL case navigates the session's existing browser target, because there is only one, so the description has to say plainly that it steers the agent's own browsing session rather than opening a separate window.

**`show`, with `open` deliberately unspent.** Opening a file in the user's native app is coming shortly after this. `open`/`xdg-open` is the one name every model already has a hard prior about, and it means precisely that. Spending it on the in-pane case would leave the native case with the confusing name later, so:

```
show output/report.pdf      # in the pane
open output/report.xlsx     # in Excel -- not built yet, name reserved
```

**No tab cap. The turn says what is already open instead.** A cap that silently evicts a tab the user was reading is worse than a long strip. The real risk is an over-eager agent opening twelve things, and the fix for that is telling it what is open at the start of a turn, read straight off `state.json` next to the attached-folders text. That also makes `show` idempotent from the agent's side: it can see a file is already open and not reopen it.

**The pane toggle migrates rather than duplicating.** Closed, it sits at the right end of the task header, which is flush with the window's right edge because the sidebar is full width. Open, it sits at the right end of the pane's tab strip, also flush with the window's right edge. Same pixel, so toggling repeatedly never moves the cursor. Duplicating the control would put two of them on screen and lose that.

**One landing.** Each piece is broken alone: tabs with no second thing to open is dead code, and `show` without tabs recreates the single-slot collision it exists to escape.

## The state

```jsonc
{
  "pane": {
    "open": true,
    "selected": "file:output/report.pdf", // or "browser"
    "tabs": [
      { "type": "browser" },
      { "filePath": "output/report.pdf", "type": "file" }
    ]
  }
}
```

`selected` is a key rather than an index so reorder and close do not have to renumber anything. Tabs carry no `modifiedAt`, and half of that is already done: the search param's copy is optional, the grid's selected-card highlight compares paths, and [view.tsx](../../../apps/studio/src/client/components/task/view.tsx) resolves the file it is showing regardless. What is left is dropping the field when the param goes. It stays out afterwards, when the index is replaced by the per-tab watch in [file-references-without-a-watcher.md](file-references-without-a-watcher.md), which is where the open tab's freshness comes from.

Two things about `setTaskState` have to be fixed in the same change:

- **It is an unserialized read-modify-write.** It reads the whole file, merges, and writes. Today's writers are rare enough that a clobber is theoretical; add tab writes from both the agent and the renderer and a debounced draft landing on top of an agent's open becomes plausible. A per-task promise chain in the store fixes it and is worth doing on its own merits.
- **Tab switches are frequent.** Debounce the client's writes the way `createDraftSaver` already does, and write only on committed changes.

## The `show` command

A `just-bash` command in [shell-commands/](../../../packages/workspace/src/lib/shell-commands/), alongside `agent-browser` -- which is the precedent that matters here, being a bash command whose whole effect is on app UI. The alternative was a dedicated tool, and the reason not to is composition: the thing being shown is usually produced by the command immediately before it, so `python build.py && show output/chart.png` wants to be one call, and a loop over `output/*.png` wants to be possible without a tool call per file.

```
show <path-or-url>...
```

- **Paths in the agent's own vocabulary**, task-relative or `/mnt/...`, resolved through the same `resolveCommandContext` / `resolvePathArgs` helpers every other command uses. Containment is therefore whatever bash already allows and there is nothing new to reason about. It is the same path grammar the fence uses, which matters more than any convenience either could gain by diverging.
- **Variadic**, so the batch case is one call without forbidding the loop. Tabs append in argument order and the last one focuses.
- **An argument matching `https?://` is a URL**: it routes through `browser.open` plus a navigate, records the use via `recordBrowserUse`, and focuses the browser tab.
- **Opens the pane if it is closed.** An explicit `show` is a request, unlike the inferred auto-opens being deleted here, so it is allowed to take the screen.
- **Already open means focus, not duplicate.**
- **A path that resolves to nothing exits non-zero** with one line per failure on stderr, while still showing the arguments that did resolve. Deliberately unlike the fence, which degrades silently: a fence is a description and a bad line should cost nothing, but a command is imperative and the agent should learn it failed.
- **stdout is one line per opened argument**, so the agent has something to check rather than something to assume.

What it does not do, all three worth stating in the description because models conflate them: it does not open the file in the user's native app, it does not download anything, and it does not raise or focus the window.

**How the effect lands.** Command → `setTaskState` merged on `pane` → `task.state.live.get` pushes → the renderer reconciles its tabs. That is the identical path the user's own tab actions take, so there is no new publisher, no new event, and no second code path that can drift.

**Replay is already correct.** `ActiveReplays` and the tutorial replay materialize recorded parts rather than re-running tools, so a replayed session does not re-open anything.

**In the transcript** it renders as an ordinary bash row via [tool-display.ts](../../../apps/studio/src/client/lib/tool-display.ts). Acceptable to start; a `show`-specific row naming the file would read better and is not required to land.

## The pane

The tab strip is a new row at the top of the pane, and the close control moves into its right end. `FileViewerHeader` loses `onClose` and keeps the title and expand (and the native-open action later); `TaskBrowserPanel` loses `onClose`; the shell in `view.tsx` reshapes around both. A rich document viewer will then have three rows -- tabs, title, viewer toolbar -- which is fine.

**The browser is one tab, and only one, because there is only one target per session.** Selecting it behaves exactly as today's globe does: [browser-panel.tsx](../../../apps/studio/src/client/components/task/browser-panel.tsx) already fires `browser.open` on mount when no guest is live and focuses its URL bar when the page is blank, so the zero state needs nothing new. The globe leaves the composer, and `prompt_browser_toggle` becomes the gate on the browser tab's presence -- renamed, since it will describe a button that no longer exists. With the flag off the tab still appears once the browser is actually in use, which is today's behavior.

**The toggle is always in the task header when the pane is closed**, and opens the pane in its zero state. It does not come and go with the pane's contents the way the files trigger does, because it is how the pane is reopened after being closed and has to be findable when there is nothing in it.

## What gets deleted

- Both auto-open hooks and `should-auto-open-output-artifact.ts`. The output one is fed by `task.outputArtifactsCreated`, which is published from the same `consumeTurnChanges` result that [file-references-without-a-watcher.md](file-references-without-a-watcher.md) deletes, so the publisher, `outputArtifactsFromChanges`, and this hook go in one move across the two plans.
- `use-browser-artifact-toggle.ts` and `prompt-browser-toggle.tsx`.
- The `artifactPanel` search param and its schema, replaced by the `pane` state.
- `external-file-changes.ts`, its call in [new-message.ts:131](../../../packages/workspace/src/lib/new-message.ts#L131), and `file-index-baseline.ts` with its storage key, if nothing else consumes the baseline ([main.ts:363](../../../packages/workspace/src/agents/main.ts#L363) and `branch-task.ts`'s `clearFileIndexBaselines` are the other callers and go with it).

The case for keeping external-change detection is that the user edits a file between turns and the agent should know. That argument gets stronger under [user-chosen-working-folder.md](../active/user-chosen-working-folder.md), not weaker -- but it needs a different mechanism regardless, because this one is task-directory-only and structurally cannot see `/mnt`. Deleting it removes a half-measure covering the one directory that is about to stop mattering, and forecloses nothing.

The live file index stays **for this landing only**, and goes shortly after in [file-references-without-a-watcher.md](file-references-without-a-watcher.md). Two of its three readers — the fence's fast path and the chip's existence check — are already gone, since references no longer resolve at render; the third, the toolbar's file list, needs a list rather than a live one. Nothing here depends on it beyond not having to move it yet.

## Order within the landing

Internal sequencing, not phases, since none of these is shippable alone:

1. `pane` in `state.json`, plus serializing `setTaskState`.
2. Move every existing writer off the search param onto it; delete the param.
3. The tab strip, the migrated toggle, and the browser as a tab.
4. `show`, and the open-tabs line in the turn context.
5. Delete the auto-opens and external-change detection.

## What the evals have to answer

The name is the open risk, so [the harness](../../../packages/workspace/evals/harness.ts) has to check that current models are not confused by a bare `show` -- specifically that they reach for it when the user would want to see something, do not reach for it as a substitute for the fence, and do not assume it means the native app. If it does read as ambiguous, `show-user` is the runner-up and the change is one string.

Worth measuring alongside: whether the open-tabs context line actually restrains repeat opens, and whether the URL form gets used where a screenshot would have been better.

## Deferred

- **Opening in the user's native app.** Named `open`, expected shortly after this; the file row in the pane is where the action goes.
- **More than one browser.** Tabs do not depend on it -- the dependency runs the other way -- so this lands first and [lazy-browser-targets-and-multiple-tabs.md](../active/lazy-browser-targets-and-multiple-tabs.md) fills in the second target later. Until it does, `show <url>` moves the agent's own browser and the user's view follows it.

  What that will need, since the data model was checked against it: the ordered list of a discriminated union is already the right shape, and files and browsers can intermingle in it by construction. The gap is identity -- `{ type: "browser" }` carries no id and `tabKey` returns the constant `"browser"` -- and closing it is additive: an optional `targetId`, with the key falling back for anything written before it. Nothing has to migrate, because nothing persists a browser tab at all. The real work is the three places that treat the browser as fixed and singleton (`openTabs` skips it, `view.tsx` puts it at the front, the strip draws it outside the reorder group), and undoing that trades away the zero state below.
- ~~**Drag to reorder.**~~ Landed, along with middle-click to close: the same `Reorder.Group`/`Reorder.Item` primitives and the same pointer-down button handling as the window's tab bar, though not the same component -- that one is bound to `TabData`, task icons, unread dots and status icons, almost none of which has a counterpart here.

## What landed, where it differed

The design above held. Six things are worth recording because the code reads differently from the plan.

**The browser tab is fixed, not stored.** The plan gated its presence on a feature flag, falling back to "appears once the browser is in use". Both were wrong for the same reason: with no tab, an open pane renders nothing, the tab strip that carries the close control never appears, and the toggle has already left the header -- so opening the pane on a task with no files was a dead end with no way back. The browser is now the pane's zero state: always the first tab, never closable, drawn ahead of the stored ones. The flag is gone rather than repurposed, since nothing is left for it to gate.

**The strip is a row inside the pane's card**, not a row above it. The viewers already stack a title row and their own toolbar inside one frame, so the tabs join that band: the pane owns `rounded-xl bg-card shadow-sm`, and the viewer and the browser panel each take a `className` that drops the card they would otherwise draw. No rule under the tabs -- the row below draws its own, and two hairlines a row apart read as a seam rather than a separation.

**Tab writes are immediate, not debounced.** The plan asked for a debounce on the grounds that tab switches are frequent. What that would buy is not worth what it costs: a write still inside its window can be reverted on screen by any unrelated `task.updated` push, and there is one of those per message. Each tab action is a discrete user act rather than a keystroke, the write is a small JSON file behind a per-task queue, and an optimistic cache update already covers the latency.

**`setTaskState` gained `updateTaskPane` alongside the promise chain.** Serializing the file write is not enough on its own: the tab reducers are a read-modify-write on top of one, so a read taken before the queue reintroduces exactly the clobber the queue exists to prevent. `updateTaskPane` runs the reducer inside the queue, which is what makes two `show` calls on one command line both land.

**The browser tab is never stored.** `show <url>` could once append one, which would have put a fixed thing inside an order the user can drag. `openTabs` treats opening the browser as a selection and never an insertion, so `pane.tabs` holds only the task's own files and the whole list is free to move. The schema keeps the variant because the view still builds one as a runtime value and `selected: "browser"` is persisted.

**The open-tabs turn line only speaks when it has news.** Written every turn at first, which restates an unchanged fact and reads in the transcript as though something happened. It now follows `createBrowserStatusPart` and is created only when the answer has changed since this session was last told, compared as a set so a drag is silent -- the agent is being told what it need not open, and order has nothing to do with that.

**Pane writes publish `task.stateUpdated`, not `task.updated`.** They have to push, because the pane is read back off that stream, but `task.updated` is what the task list subscribes to and the list is ordered by a filesystem timestamp. See [task-list-order-followed-file-mtimes.md](../../findings/task-list-order-followed-file-mtimes.md) for what that turned out to be hiding.

`isAddressableTaskFilePath` moved from the renderer into the workspace package on the way, so `show`, the pane schema, the file chip and the fence all ask one implementation.

## Still open

- **Drag to reorder**, as deferred above. The state shape supports it.
- **The evals the plan asks for.** `show` is committed with unit coverage of its own behavior, but nothing yet measures whether models reach for it where a user would want to see something, whether they mistake it for the fence, or whether the open-tabs turn line actually restrains repeat opens. That measurement is the open risk on the name.
