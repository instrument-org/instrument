# Plan: split the orchestrator route component

Status: landed. The four big clusters and the router synchronization are out of `route.tsx`, plus back-and-forward stepping from the "whatever is left" step; the file went from roughly 2,425 lines to roughly 1,380, and `OrchestratorLayout` from roughly 1,830 to roughly 1,065, of which about 430 is the JSX this plan keeps out of scope. Every moved body was checked byte-identical against the route before its commit, types and lint were green after each step, the orchestrator component suite passes, and the 2.0 window was driven end to end afterwards: a draft closed with words, reopened from Drafts and sent into a thread carrying its band's context; a thread reply carrying the page's words; a door, Back, Forward, the Cmd+L chord and an omnibox site; and the screen sweep reporting no console errors after a reload. What was left in place, and why, is under "What landed".

`apps/studio/src/client/routes/orchestrator/route.tsx` held `OrchestratorLayout`, a single function of roughly 1,830 lines inside a file of roughly 2,425. It was the most expensive file in the repository to work in, and the cost was paid by every session that touched the 2.0 window. This plan is a pure structural refactor: **no behavior change, no new features, no adjacent cleanup**.

## Why this file and not another

Measured over one three-week window, from the recorded agent session transcripts for this repository plus `git log`:

| | `route.tsx` | Next-worst file |
| --- | --- | --- |
| Commits touching it | 109 | 70 |
| Agent edits | 180 | 74 |
| Times opened to read | 184 (82 whole-file reads, 102 line-range slices) | 47 |
| Read output returned to a model | ~1.0M characters, roughly 250K tokens | ~0.45M |
| Worst single-session run of consecutive edits | 20 | 23 |

Four of the seven largest single file reads in the entire corpus were this file, at 63-71KB each. Three separate sessions spent 14, 15 and 20 consecutive edits in it without touching anything else. Agents fell back to reading it by line range because opening it whole cost a significant fraction of a context window, and reading it by line range is how a refactor introduces a bug.

The rest of the surface is healthy, which is what made this worth doing rather than despairing of: every one of the 84 non-test components under `components/orchestrator/` is referenced, with no dead files, across 103 files built during the same window. The problem was one file that never got split as it grew, not a directory that needs curating.

## Target

- `route.tsx` under 500 lines: the route definition, the layout composition, its JSX, and nothing else.
- No function in it longer than about 150 lines.
- Every extracted unit is a hook or a helper that can be read on its own without the route open beside it.

The line target is a guide, not a quota. A cluster whose pieces are genuinely mutually entangled should be left in place with a note saying why. A forced split that makes the code harder to follow is worse than the status quo.

## What landed

| Step | Out of the route | Into |
| --- | --- | --- |
| 1 | `useRecordRecents` with `recentFor` and the dwell constant; `useWindowCommands` | `use-record-recents.ts`, `use-window-commands.ts` |
| 2 | `describeTabs`, `fileOf`, `readPage`, `includedContext`, `draftContext`, `tasksFaceView`, `sendContext`, `includedTabOf`, the page-read ceiling | `send-context.ts`, as `contextReaders`, with `send-context.test.tsx` |
| 3 | `openPage`, `openScreen`, `openNamedPath`, the openers ref, the pending-screen effect, the `events.open` stream, `isFreshNewTab`, `isTaskTab` | `use-openers.ts` |
| 4 | `showDraft`, `startDraft`, `newDraft`, `deleteDraft`, `closeDraft`, `startThread`, the message mutation, the starting and arrived ids with their timer, the snapshot pruning, `isIncludable`, the arrival constant | `use-drafts.ts` |
| 5 | the effect that keeps the address following the tab, and the one that keeps a navigation inside the tab it started in | `use-router-sync.ts` |
| 6 | `canGoBack`, `canGoForward`, `goBack`, `goForward` | `use-history-steps.ts` |

Where the landed shape differs from the steps below:

- The send-context cluster is a plain function rather than a hook. `contextReaders` takes the window's pieces (the tabs, the screen view, the drafts and what their windows have up, the names an address cannot say, the state, the face while it is up, the router's address) and returns `draftContext` and `sendContext`, which is what lets its test build fixtures with no providers. The route still assigns `sendContext` into the ref the JSX reads, so a composer that captured the callback in an earlier render reads the latest reader.
- `listedThreads` stayed in the route: only the thread-stepping chord and the pane's `onListed` touch it.
- `leaveGroup` stayed in the route: it is the inbox column's cover handler, not a draft's.
- The launch-time effect that puts a restored draft's group away stayed in the route, whole. It is one pass over restored state together with the place reconciliation, and their order matters: with a draft group restored under a place other than the chat, the draft cleanup has to run before `showPlace`, and an effect split across a hook boundary runs in hook-call order rather than in the order the code reads.
- The hooks read the atoms they alone need (`use-drafts` reads the drafts, their snapshots, the filters and the feature flags; `use-router-sync` and `use-history-steps` read the router) and take the rest as arguments, so each file reads on its own.

Left in the route on purpose, each under about sixty lines: the row measurement, place and chat-group navigation, the pane and tasks-face state, the tab-location derivation, the close-task-browser state and its dialog, the topics, the new-tab prefetch, and the `useWindowCommands` wiring. Each is either entangled with the JSX or the launch-time effect, or too small to earn a file. The 500-line target is not reachable without splitting the JSX, which stays out of scope.

## Extraction order

Lowest risk first, so the early steps land while the later ones are still being understood. Clusters are named by symbol rather than by line number, because the file takes about five commits a day and any line number written here is wrong within the week.

### 1. Relocate the two hooks that are already hooks

`useRecordRecents` and `useWindowCommands`, plus the `recentFor` helper, already sit at the bottom of the file in hook shape. They only need a file. Roughly 230 lines, no logic changes, and it establishes where the new files go before anything harder moves.

### 2. Send-context gathering

`describeTabs`, `fileOf`, `readPage`, `includedContext`, `draftContext`, and `sendContext`. Roughly 390 lines and the largest single cluster. Mostly data transformation over tabs, threads and drafts, so it is the most testable thing in the component and the best candidate for a unit test that did not previously exist.

### 3. Openers

`openPage`, `openScreen`, `openNamedPath`, and the `openers` ref that holds them for the command stream. Roughly 260 lines. These close over the tabs as they are at the moment of each ask, which is deliberate and documented in the existing comments; preserve that, and preserve the comments that say so.

### 4. Draft lifecycle

`showDraft`, `startDraft`, `newDraft`, `closeDraft`, `deleteDraft`, `startThread`, and the effect that puts away a draft's leftover group. `useCompose` already owns the windows themselves, so this is the surrounding lifecycle rather than the compose surface.

### 5. Router and tab synchronization

The effects that keep the router following the tab on screen and that walk back and forward across screens and guests. These are the subtlest behavior in the file and carry the most load-bearing comments. Take them last, or leave them.

### 6. Whatever is left

Row measurement and inbox sizing, place and chat-group navigation, pane and tasks-face state, and the topics and messages mutations are each small enough that they may not earn a file of their own. Judge them once the four big clusters are out and the remaining shape is visible.

## Conventions

- **React Compiler is enabled for Studio.** Do not add `memo`, `useMemo` or `useCallback`. The component has none, and that is correct.
- **Where hooks go.** Orchestrator-specific hooks sit beside the components as `components/orchestrator/use-<name>.ts`, following `use-ideas.ts`. Only genuinely generic ones go in `client/hooks/`.
- **No compatibility shims.** Move code outright. No re-export barrels, no aliases kept for a caller that can be updated in the same commit.
- **Comments move verbatim with the code they describe.** This file's comments are unusually load-bearing and written in a specific voice: present tense, describing the behavior as it stands. Never add one that references the refactor itself.
- **Avoid casts.** Prefer `satisfies`; reuse existing types rather than redefining them per file.
- **Do not hand-format.** A hook runs the formatter on every edited file, and the linters on stop. Writing source through `sed -i` or a heredoc bypasses both, so use ordinary file edits, or run the formatter and the lint fixers on anything a script wrote.

## Verification

Run from the repository root; do not `cd` into the package.

```bash
pnpm exec turbo run check:types check:lint --filter=@instrument-org/studio
pnpm --filter @instrument-org/studio exec vitest run src/client/components/orchestrator/
```

If `check:types` reports errors enumerating members that do not match the file on disk, delete `apps/studio/tsconfig.tsbuildinfo` and re-run; that is a stale incremental build artifact, not a real error.

`components/task/pane-tabs.browser.test.tsx` fails two width snapshots by one pixel on some machines, because the snapshots were recorded on different hardware. Confirm any such failure reproduces on an unmodified checkout before treating it as caused by this work.

There is no behavioral test suite covering the whole window, so the meaningful check on the extracted clusters is the type checker plus reading the diff, and a driven pass through the 2.0 window afterwards (the `studio-chrome-devtools` skill, against a fixture workspace). Where a cluster is pure enough to test directly, the test goes in the same commit as the extraction.

`send-context.test.tsx` covers the readers: what a thread's send says about the tab on screen, a file shown as a page, a guest that never answers, and the face over the tab; and what a draft's send says about its band, the thing it was opened over (a folder, a file, an app, a page), and a band showing home. It is a `.test.tsx` although it renders nothing: `screen-presentation.tsx`'s import graph reaches an atom that reads `localStorage` on load, which the node project does not have.

## Landing it

This file is the one every session working on the 2.0 window has open, and it frequently carries another session's in-flight edits. That makes sequencing part of the work rather than an afterthought:

- Confirm the file is clean before starting, and check again before each commit. An edit that is not yours means someone is mid-experiment in the same function.
- Land each step as its own commit rather than accumulating the whole refactor in the working tree. A pathspec commit takes the working tree, so a half-finished extraction sitting uncommitted can be swept into someone else's commit.
- Stage explicitly by path. New files need adding by exact path and committing with no pathspec.
- Steps 1 through 3 are independent of each other and can land in any order. Step 4 is easier after 2, and step 5 is easier after everything.
- Cut a cluster by slicing the route's own lines into the new file rather than retyping them, and diff the result against the committed route before the commit: a body that is byte-identical needs no second reading.

## Out of scope

- Behavior changes of any kind, including ones that look like obvious improvements while passing through.
- The other large files in the same area. `components/extend/file-system.tsx` is larger at roughly 5,510 lines and has its own case, but it is a different component with a different shape and does not belong in this change.
- Splitting the JSX into more components than the extraction naturally produces. The column components it renders into already exist; the goal is to stop the route holding logic, not to invent a new component hierarchy.

## Related

- [agent-driving-studio-friction.md](../active/agent-driving-studio-friction.md) and [driving-studio-in-batches.md](../active/driving-studio-in-batches.md) measure the other half of the same harness cost, in the commands an agent runs rather than the files it reads.
