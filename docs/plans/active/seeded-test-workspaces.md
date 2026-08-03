# Plan: seeded, disposable workspaces for driving and testing Studio

Status: corpus, seeder and `studio-drive` wiring landed. CI is the remaining step.

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

## The shape, concretely

What is committed, and what gets built from it:

```
committed to the repo                    built on demand, gitignored
─────────────────────────                ──────────────────────────
fixtures/documents/
  manifest.yaml       ── the tasks   ─┐
  session.json        ── the messages ├─▶  <workspace>/
  files/                              │      workspace/tasks/<id>/
    attention.pdf     ── real inputs ─┘        .instrument/task.db
    weird.pdf                                  output/attention.pdf
    crazy-chart-zoo.xlsx                     preferences.json
                                             tabs.json
```

Then:

```
studio-drive.mjs boot --workspace documents
  │
  ├─ workspace missing?  seed it:  create the tasks, replay the messages,
  │                                copy files/ into place
  ├─ spawn Studio with ELECTRON_USER_DATA_DIR=<workspace> SKIP_ONBOARDING=true
  └─ wait until drivable, then hand back the port
```

No model is involved at any point. `replaySession` writes recorded messages against a `replay-stub` model, so seeding costs nothing and produces the same transcript every time.

## Shape

The corpus lives in [fixtures/workspaces/](../../../fixtures/workspaces/), whose README is the working reference for adding one. What follows is why it is built that way, and what is left.

### 1. Separate what rots from what does not

Three kinds of thing go into a fixture, and they want opposite treatment. Conflating the last two is the easy mistake.

**App state** (`task.db`, `state.json`, the WAL sidecars). Never committed. It is binary, it embeds whatever real content it was captured from, and it rots silently the first time the schema moves. This is the part that gets described in text and rebuilt by replaying through the app's own code paths, which is what makes it survive migrations.

**Input files the fixture opens** (a PDF, a spreadsheet, a deliberately malformed document, an image). Committed, as ordinary files next to the description. They are inert: no schema, nothing to migrate, nothing to drift. Regenerating them on every run would be strictly worse, and for the interesting cases it is not even possible. The whole point of a fixture named `weird.pdf` is that someone found a real file that broke something; a generator cannot reproduce that, and if it could it would be a different file next time.

**Conversations.** Recorded once from a real run, committed as a transcript, replayed deterministically. Not hand-authored, and not regenerated by asking a model.

So the corpus is: text describing the state, plus a `files/` directory of ordinary committed inputs. The only thing built on demand is the database.

### 2. A seeder that builds a workspace from the description

```
pnpm workspace:seed --out <dir> --fixture <name>...
```

Idempotent, and fast enough to run before every CI job: it holds a content hash of the fixtures it built from and does nothing when they have not moved. It builds the workspace through the app's own libraries rather than writing task directories itself, which is the single most important constraint here — both of the adjacent plans above change where task data lives, and a seeder that writes files directly would break when either lands, silently and at a distance.

The open question was whether a `workspaceConfig` can be built outside the Electron main process. It can: `evals/harness.ts` and `scripts/run-workspace.ts` already start the real workspace machine headlessly, and the seeder needs less than either — a config installed with `setWorkspaceConfig`, and `initializeTask` plus `Store`. No Electron, no running app, no server.

One deviation from the sketch above. `workspace.debug.replaySession` re-executes every recorded tool call, which needs the whole runtime: bash sandbox, browser, a model. Seeding has to work in CI with no provider credentials and finish in seconds, so it writes the recorded messages and their recorded tool outputs, and the artifacts a tool would have produced come from the fixture's `files/`. The cost is that a change to what a tool *stores* wants the transcript re-recorded; the check that catches it is a test that parses every committed fixture through the real session schema.

Recording is the other half, and the corpus cannot grow without it:

```
pnpm --filter @instrument-org/workspace run script:record-fixture-session <task-dir-or.zip> --fixture <name> --task <key>
```

It takes a task directory or an export zip, drops the persisted system-prompt snapshot (committing one would pin a copy of the prompt into the corpus), and refuses to write a transcript containing machine-local paths.

### 3. Wire it into studio-drive

```
studio-drive.mjs boot --workspace <name>   # seeds if absent, then boots against it
studio-drive.mjs boot --workspace <name> --fresh   # rebuild from the description first
```

`boot` already controls the child environment, so this is setting `ELECTRON_USER_DATA_DIR` and `SKIP_ONBOARDING` and nothing more. The port and the instance record are both keyed by workspace as well as by checkout, so a fixture run and a plain dev run can be up at once; `--workspace` therefore belongs on every command of a run, not only `boot`.

A pleasant side effect: dev instances currently share one application-data directory, so two Studio windows fight over the same tabs and preferences. A per-workspace directory removes that for anything booted this way.

### 4. Then CI

Not done, and deliberately last: only once the above is boring. `.agents/cloud-dev.md` has the headless notes already (`NO_SANDBOX`, Xvfb). The shape is: seed, boot, drive assertions through `studio-drive`, capture a screenshot on failure as the artifact. Keep the first CI job small — one workspace, a handful of surfaces — because the value is in it running at all, and a broad suite that flakes gets muted.

## Settings are per workspace, and that is a feature

Redirecting `userData` moves more than the tasks. `preferences.json`, `features.json`, `app-state.json`, `window-state.json` and `providers.json` all live there, so a fixture can pin the settings a surface needs instead of depending on how the developer left their app: feature flags on or off, theme, developer mode, window size. Zoom is not among them; like the open tabs below, it is renderer state in `localStorage`.

The manifest declares only what the fixture actually depends on, and everything else falls through to the app's own defaults. A fixture that pins every setting will break every time a default changes, which is the opposite of what it is for. A fixture for the skills UI should say "skills enabled" and nothing more. The keys themselves are written verbatim and validated by the app's own store schemas on load, since those schemas live in Studio and the seeder does not: a typo silently does nothing rather than failing the seed.

Open tabs are the exception, and worth checking early because it is the one most people would expect to pin. The tab model is a renderer atom persisted to `localStorage`, so it lives in the Chromium profile's leveldb rather than a file the seeder can write. There is a stale `tabs.json` in the application-data directory from an earlier implementation; nothing reads it. Either seed tabs by driving the app once after boot and letting it persist, or treat "which tabs are open" as something a run sets with `goto` rather than something the fixture owns. The second is simpler and probably right, and is what the wiring assumes: a seeded workspace starts with no persisted tabs, so nothing paints over the first `goto`.

One thing does not follow this pattern. A seeded workspace has no provider credentials, and it must not: they cannot be committed. That is fine for a replayed transcript, which never calls a model. A fixture that needs a live model has to take credentials from the environment, and in CI that means a secret, which is a good reason to keep live-model fixtures out of the first pass.

## Lifecycle and disk

Seeded workspaces are small. The state a fixture actually needs is the task database and its output: in a representative existing task those are 200 KB and 80 KB. What makes real task directories large is `work/`, which reaches hundreds of megabytes once an agent has run `pnpm install` or built a virtualenv in it. Replay never does that, so a seeded workspace stays in the low megabytes however many tasks it holds.

The bloat only appears when a fixture is used to run a live agent. That distinction should drive the cleanup design rather than a blanket policy:

- Workspaces go under the OS cache directory keyed by checkout, the way `studio-drive` already keys its session file. Never in the repo, never in the shared application-data directory.
- `--fresh` rebuilds one. That covers the common case, which is a fixture that has drifted rather than disk pressure. It refuses to clear a directory that has contents but no seeder marker, because the obvious typo in `--out` is a real application-data directory holding someone's actual tasks.
- Reaping happens on age at boot, not by asking people to run a clean command, because nobody runs a clean command. A workspace untouched for two weeks is dropped: it costs a reseed, which is cheap by construction.
- Installed dependencies inside a task (`work/node_modules`, `work/.venv`) go after three days. They are the only part that grows, always reproducible, and deleting them does not invalidate the fixture. Only a live agent run creates them, so a workspace used for driving never has any.
- CI needs none of this. The runner is ephemeral, so seed, use, discard.

The measured numbers back the estimate: the `documents` workspace is 188 KB seeded, against the 20 MB `work/` the live run that produced its transcript left behind.

## Risks worth naming up front

- **Both adjacent plans move task storage.** Going through app libraries rather than the filesystem is what makes this survivable. The seeder says so at the top of the file, not only here.
- **A fixture corpus becomes a second product to maintain.** Prefer a few fixtures that cover distinct surface families over one per surface. If a fixture only exists to make one screenshot reproducible, it is probably not worth the upkeep.
- **A replayed transcript covers conversations, not everything.** A live browser guest, a running agent, a mid-stream transcript are all states a replay does not reproduce. Some surfaces will still need a live run; that is fine, they just should not be the first ones in CI.
- **Determinism is more than the workspace.** Model output, timestamps, and relative dates ("just now") all move. Seeding anchors a transcript to seed time rather than replaying its recorded dates, which keeps relative dates reading the way they did when captured, but anything asserting on pixels still needs them masked.

## Not doing

Committing a pre-built workspace directory to the repo. It is the fastest thing to get working and the worst thing to own: opaque in review, impossible to diff, and stale the moment the schema changes.
