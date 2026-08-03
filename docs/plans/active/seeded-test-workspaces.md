# Plan: seeded, disposable workspaces for driving and testing Studio

Status: proposal, not started. Owner: TBD.

Context for why this is wanted: [driving-studio-for-ui-capture.md](../../findings/driving-studio-for-ui-capture.md) lists ambient workspace state as the last unaddressed source of flakiness in scripted runs. Adjacent and worth reading before starting, because both move where task data lives: [user-chosen-working-folder.md](./user-chosen-working-folder.md) and [conversation-storage.md](./conversation-storage.md).

## Summary

Make it possible to say "boot Studio against *this* workspace", where the workspace is a directory built from a checked-in description rather than whatever the developer happened to do last. Two payoffs, and the second is the reason to do it properly:

1. A scripted run (screenshot capture, a repro, a smoke pass) stops depending on one machine's history. Today, finding a task that contains a PDF means grepping the developer's application-data directory and hoping.
2. CI can drive the real app against a known workspace. That is currently impossible, not because of the driving, which is solved, but because there is no workspace to drive it against.

## What already exists

Most of the plumbing is there. This is mostly a corpus and a seeder, not new app machinery.

| Piece | Where | Note |
| --- | --- | --- |
| Point the app at an arbitrary workspace | `ELECTRON_USER_DATA_DIR`, handled in `electron-main/setup-environment.ts` | Redirects `userData` wholesale, and the workspace lives at `userData/workspace`. Everything follows: tasks, preferences, tabs, providers, browser session |
| Skip the provider-setup gate | `SKIP_ONBOARDING=true`, checked in `shouldShowOnboarding` in `electron-main/index.ts` | Without this a fresh workspace opens the onboarding window and the main window never reveals, which in CI reads as a hang |
| Whole-task round trip | `task.exportZip` and `task.importTask` (`packages/workspace/src/rpc/routes/task/index.ts`, `lib/export-task-zip.ts`) | Import takes base64 zip data, so a seeder can drive it without the file picker |
| Deterministic conversations | `workspace.debug.replaySession` (`packages/workspace/src/rpc/routes/debug.ts`) | Replays a recorded session into a new task or session against a `replay-stub` model. No provider, no network, no spend |
| Call any route from a script | `window.__studioDebug.rpc(path, input)` | Gated on the Developer Mode preference at call time |
| Drive the app | `.agents/skills/studio-chrome-devtools/scripts/studio-drive.mjs` | Already spawns Studio with a controlled environment |

## Proposed shape

### 1. Fixtures as a description, not as committed databases

A fixture workspace is a directory of text: one file per task describing its name, its messages, the files it should contain, and any state a surface needs (an open artifact, a browser session, an error).

Resist committing `task.db` files or task zips as the source of truth. They are binary, they carry WAL sidecars, they embed whatever real content they were captured from, and they rot silently the first time the schema moves. A description replayed through the app's own code paths survives migrations because it goes through them.

Binary artifacts a fixture genuinely needs (a PDF to open, a spreadsheet to render) should be **generated** by the seeder rather than checked in. There is precedent: the existing document fixtures in the shared dev workspace were produced by a short generator script, not authored by hand.

### 2. A seeder that builds a workspace from the description

```
pnpm workspace:seed --out <dir> [--fixture <name>...]
```

Idempotent, and fast enough to run before every CI job. It should build the workspace by calling the same routes the app does rather than writing task directories itself. That is the single most important constraint here: both of the adjacent plans above change where task data lives, and a seeder that writes files directly will break when either lands, silently and at a distance.

Open question for the implementer: the seeder needs a running app to reach those routes, or the workspace package needs a headless entry point that can construct a workspace config outside Electron. The second is cleaner and probably more useful, but check whether `workspaceConfig` can be built without the Electron main process before committing to it.

### 3. Wire it into studio-drive

```
studio-drive.mjs boot --workspace <name>   # seeds if absent, then boots against it
studio-drive.mjs boot --workspace <name> --fresh   # rebuild from the description first
```

`boot` already controls the child environment, so this is setting `ELECTRON_USER_DATA_DIR` and `SKIP_ONBOARDING` and nothing more. Note the port is currently derived from the checkout path; if CI ever runs two workspaces at once from one checkout, that derivation needs a workspace component too.

A pleasant side effect: dev instances currently share one application-data directory, so two Studio windows fight over the same tabs and preferences. A per-workspace directory removes that for anything booted this way.

### 4. Then CI

Only once the above is boring. `.agents/cloud-dev.md` has the headless notes already (`NO_SANDBOX`, Xvfb). The shape is: seed, boot, drive assertions through `studio-drive`, capture a screenshot on failure as the artifact. Keep the first CI job small — one workspace, a handful of surfaces — because the value is in it running at all, and a broad suite that flakes gets muted.

## Risks worth naming up front

- **Both adjacent plans move task storage.** Going through app APIs rather than the filesystem is what makes this survivable. Worth a note in the seeder itself, not just here.
- **A fixture corpus becomes a second product to maintain.** Prefer a few fixtures that cover distinct surface families over one per surface. If a fixture only exists to make one screenshot reproducible, it is probably not worth the upkeep.
- **`replaySession` covers conversations, not everything.** A live browser guest, a running agent, a mid-stream transcript are all states a replay does not reproduce. Some surfaces will still need a live run; that is fine, they just should not be the first ones in CI.
- **Determinism is more than the workspace.** Model output, timestamps, and relative dates ("just now") all move. Anything asserting on pixels will need those pinned or masked.

## Not doing

Committing a pre-built workspace directory to the repo. It is the fastest thing to get working and the worst thing to own: opaque in review, impossible to diff, and stale the moment the schema changes.
