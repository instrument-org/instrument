---
name: studio-chrome-devtools
description: Use when working with Chrome DevTools against the Studio Electron app in this repo. Load this for Studio-specific connection details and page selection. Especially relevant when the user mentions Electron, `chrome-devtools`, `chrome-devtools-cli`, browser views, smoke tests, or debug routes.
---

# Studio Chrome DevTools

How to drive and inspect the Studio Electron app.

`studio-drive.mjs` is the way in. The generic `chrome-devtools` / `chrome-devtools-cli` skills describe a tool that has never heard of Studio: it cannot derive this checkout's port, cannot tell a restart from a crash, and reports both as "Could not connect to Chrome. Check if Chrome is running", which sends a run off to hunt for a browser that was never involved. Read them when you need the profiler's own syntax ([The CLI, for what it alone can do](#the-cli-for-what-it-alone-can-do)), not to decide how to reach the app.

## Driving: `studio-drive.mjs`

Resolve the path from the repo root rather than writing it relative, so a later `cd` into a package does not turn every command in the run into `MODULE_NOT_FOUND`:

```bash
DRIVE=$(git rev-parse --show-toplevel)/.agents/skills/studio-chrome-devtools/scripts/studio-drive.mjs

node $DRIVE boot --purpose "skills dialog"           # your own instance
node $DRIVE goto /release-notes
node $DRIVE state
node $DRIVE snapshot --selector '[role=dialog]'
node $DRIVE click --text "New skill"
node $DRIVE shot out.png --selector '[role=dialog]' --pad 8
node $DRIVE rpc workspace.task.list '{}'
node $DRIVE stop
```

Also `press`, `type`, `wait`, `modal`, `eval`, `run`, and `port` (the bare number, for pointing another tool at this instance). It speaks CDP directly, so there is no daemon to go stale and no reconnect to invalidate page ids, and it handles the things that otherwise fail quietly: real input, visible-only element matching, browser-side screenshot cropping, and a check that something is mounted before capturing.

One command is one process and one connection. That is the right shape for a single question and the wrong one for a sequence, so as soon as you know two things you want to do, reach for [`run`](#a-sequence-run) instead.

`snapshot` is the read to reach for before deciding how to address anything. It prints the accessibility tree as indented `role "name"` lines, in the same terms `click --text` matches on and at a fraction of the size of the DOM, so one call answers what is on screen and what each thing is called. Scope it with `--selector` and go deeper with `--depth` (12 by default); an unscoped app page is a few hundred lines.

A control that comes back as a bare `button`, with no name after it, cannot be reached by text at all. That is a labeling bug rather than a fact about the tool, and a screen reader gets the same nothing, so it is worth reporting. To get past one in the meantime, mark it in an `eval` and click the mark, which keeps the real input path rather than falling back to `element.click()`:

```bash
node $DRIVE eval 'document.querySelectorAll("button[aria-haspopup=menu]")[3].setAttribute("data-probe", "kebab")'
node $DRIVE click --selector '[data-probe=kebab]'
```

`boot` requires `--purpose` with a terse description of what this instance is testing, such as `"hotkeys"` or `"document viewer"`. Keep it to one or two short words; the launcher rejects anything over 24 characters. The purpose labels the instance for its lifetime so a person can distinguish agent-driven windows at a glance. Reusing the instance with the same purpose works normally; asking to reuse it with a different purpose fails and tells you to stop it first so the window never carries a stale label.

The port is derived from the checkout you are standing in. `boot` will not fall back to 48160 because that is the conventional port and almost always a window a person is using, so driving it means their clicks fight yours and their quit ends your run. Pass `--port` to target one deliberately.

It also clears `ELECTRON_RUN_AS_NODE` from the app's environment, so there is no need to unset it first. Some editor integrations set it, and with it set Electron runs as plain Node and exits without ever opening a window.

`modal` takes its names from the running app (`modal` with none prints them), so the list cannot drift from the openers the renderer has.

Route and modal commands go through `window.__studioDrive`, a dev-only handle the renderer attaches (`client/lib/studio-drive.ts`). A packaged build, and any checkout without that file, will not have it.

`boot` returns as soon as that handle exists, which is when the app can be driven — not when the restored route has finished loading. A `shot` fired straight after `boot` can therefore catch a task pane still filling in. When a command depends on route content rather than on the chrome, wait for the thing itself:

```bash
node $DRIVE wait 'document.querySelectorAll("[data-slot]").length > 40'
```

An instance this boots holds its main process and preload scripts at the bytes it started with, so another agent's edit under `electron-main/` or `packages/` no longer relaunches the app underneath a run. The cost is that a change you make there does not reach it: stop and boot again, or add `--hot` to the boot for a run that is iterating on main or testing reload behavior. A hand-started instance (`pnpm dev:studio`, the VS Code launch configs, port 48160) is unaffected and hot reloads everything.

Renderer HMR stays on, so any write under `src/client` — another agent's edit, a commit, a formatter — still rebuilds component state, and a change HMR cannot apply reloads the page and takes the state a run navigated to with it. When that has happened since the previous command, the next one says so on stderr:

```plaintext
studio-drive: the app reloaded since the last command. Whatever was navigated to, opened, or typed is gone; ...
```

Believe it. A result that disagrees with the one before it, after that line, is describing the reload and not the code. Re-establish the state and take the reading again rather than explaining the difference.

A command that arrives while the app is still restarting waits for it to come back, so a rebuild landing mid-run costs a pause rather than a failure. "Nothing is running for this checkout" means the instance is gone, not that it is busy.

A plain `boot` uses the shared dev application-data directory, so what a run can reach depends on what that machine did last. `--workspace <fixture>` boots against a disposable one built from a committed description:

```bash
node $DRIVE boot --purpose "document viewer" --workspace documents
node $DRIVE goto /tasks/generated-pdf --workspace documents
```

It seeds when the fixture is absent or has changed (`--fresh` forces a rebuild) and reports the seeded task ids, so a script addresses a task by name instead of grepping for one. `--workspace` belongs on every command of the run: it picks the port and the instance record, so a fixture run and a plain dev run can both be up. `pnpm workspace:seed --list` shows what exists; `fixtures/workspaces/README.md` covers adding one.

## A sequence: `run`

`run` hands a script the app from `scripts/studio-app.mjs` over one held connection. The script default-exports `(app, args)` and returns whatever is worth reporting:

```bash
node $DRIVE run sequence.mjs --args '{"taskId":"…"}'
cat sequence.mjs | node $DRIVE run -          # or on stdin, no quoting to get wrong
```

```javascript
export default async (app, args) => {
  await app.goto("/skills");
  await app.click("New skill");
  await app.waitFor('document.querySelector("[role=dialog]")');
  await app.expect(
    'window.__studioDrive.state().dialog === "New skill"',
    "the dialog to open",
  );

  // branch on what you found, which a shell chain cannot do
  const { tasks } = await app.rpc("workspace.task.list", {});
  if (tasks.length === 0) await app.click("New task");

  return { taskCount: tasks.length };
};
```

`app` carries `state`, `goto`, `click`, `press`, `type`, `openModal`, `closeModal`, `rpc`, `eval`, `snapshot`, `shot`, `waitFor`, `waitForIdle`, and `expect`. Anything it has no verb for is reachable through `app.cdp`, so a sequence is limited by what CDP can do rather than by what the CLI has been taught to parse. A promoted helper imports the same module and takes `app` as its first argument, so turning a sequence you have now written twice into a reusable function is a refactor rather than a rewrite.

Why this and not a command apiece: a primitive costs 0.3ms to 30ms over a held connection, while deciding the next command costs seconds. A twelve-step sequence measured at 1.2s in total, against roughly two minutes as twelve commands.

- **Every call is traced.** The result is `{ok, steps, trace}` plus your return value, and a failure keeps the trace: `ok: false`, `stoppedAt`, and the failing step's own error. A run that dies at step 7 still reports the six that worked, so there is nothing to reconstruct.
- **`waitFor` replaces `sleep`.** A string is evaluated in the page, a function runs in Node. It reports `waitedMs`, which is usually a fraction of the sleep it replaces.
- **`expect` fails on the step that was wrong**, with your message, rather than surfacing three steps later as something unrelated.
- **A reload stops the run.** A write under `src/client` hot-updates the renderer, and one HMR cannot apply reloads the page; a long sequence is a larger thing to lose that way than one command is. If the load changes mid-run the step is marked `reloaded` and the run stops there. Pass `--allow-reload` when the sequence expects one, or is testing one.

## Asking the app instead of reading the page

`rpc` calls any oRPC route on the renderer's real client, through `window.__studioDebug` (`client/lib/debug-rpc-bridge.ts`):

```bash
node $DRIVE rpc workspace.task.list '{}'
node $DRIVE rpc workspace.task.agentStatus.byIds '{"ids":["generated-pdf"]}'
node $DRIVE rpc gateway.models.list
```

The input is one JSON argument, and the routes are the ones in `packages/workspace/src/rpc/routes/` under `workspace.`, plus Studio's own (`apps/studio/src/electron-main/rpc/routes/`) at the top level.

Reach for this before the DOM whenever the question is about state rather than about pixels. Scraping `document.body.innerText` for a status answers what the UI painted; the route answers what the UI painted _from_, which is the thing under test, and it does not move when a component does.

## Running a command in the app's own sandbox

`bash` runs one command in a task's real sandbox and returns `stdout`, `stderr`, `exitCode`, and `durationMs`, through `workspace.debug.runBash`:

```bash
node $DRIVE bash 'curl -sS -o /dev/null -w "%{http_code}" https://example.com' --task <task-id>
node $DRIVE bash 'ffprobe /nope.mp4 2>/dev/null; echo exit=$?' --task <task-id>
```

The session is the task's most recent unless `--session` names one, and a packaged build needs an explicit `--task` for the same reason every other command does.

This is not `run-bash`, and the difference decides which one answers a question. `run-bash` builds its own sandbox from a checkout's dependencies, with no task and no app, which makes it fast and makes it blind to anything about a package: a command missing from a bundle resolves fine from `node_modules` and reports success. `bash` runs the mounts, shims, network policy, and bundled binaries of the build that is actually running. Verifying a shipped release wants this one; iterating on a shell fix wants the other.

- It is gated on the **Developer Mode** preference, checked per call. Fixture workspaces pin it on; the shared dev workspace depends on what was last set in Settings > General, and the bridge cannot turn it on for you.
- `live.*` routes are event iterators and cannot come back through a single evaluation. Call the plain sibling in a loop instead (`task.agentStatus.byIds`, not `task.agentStatus.live.byId`).
- Errors come back as data, so a Zod failure prints its issues rather than a stack.

## Running a task without touching the UI

One route creates the task and sends the first prompt, and no part of this has to go through the composer (whose React-controlled textarea is its own trap, see [references/repro-recipes.md](references/repro-recipes.md)):

```bash
node $DRIVE rpc gateway.models.list                  # pick one; build <author>/<canonicalId>?provider=…&providerConfigId=…
node $DRIVE rpc workspace.task.create '{"modelURI":"<uri>","prompt":"…","name":"smoke"}'
node $DRIVE wait --idle --task <task-id>
node $DRIVE rpc workspace.message.list '{"id":"<task-id>","sessionId":"<session-id>"}'
```

`task.create` returns `{id, sessionId}`; `message.create` takes both and sends a follow-up into the same session. A seeded fixture workspace holds no credentials, so a live turn needs a plain `boot` against the dev workspace.

### Waiting for a turn

`wait --idle` polls `task.agentStatus.byIds` until the task has no live agent, which is the signal the app itself uses. Without `--task` it takes the task the active tab is showing.

```bash
node $DRIVE wait --idle --task <task-id>     # blocks for the turn, default timeout 10m
```

Two things about that status are worth knowing before trusting a wait built on it by hand:

- Busy is the `agent.alive` tag, carried by every non-final state of the session machine. A task whose turn is over reports **no sessions at all** rather than `agent.done`, because the workspace machine drops the ref when the session finishes.
- Which makes "no sessions" also what a task reports _before_ its turn starts. `wait --idle` covers that by requiring idle to hold for `--settle` (2s) until it has seen the task busy, and reports `sawBusy` so you can tell which happened. `sawBusy: false` on a wait that was meant to follow a prompt means the prompt never started an agent.

A **replay** is not an agent turn and none of this sees it: it runs its own loop outside the session machine. Poll `workspace.replay.status '{"sessionId":"…"}'` for that one.

## Page model

Studio is one window and one web contents: `AppChrome` and every open tab mount in the same page. Agent-browser tabs are renderer `<webview>` guests inside it, not separate DevTools targets. The app root carries `data-testid="app-page"`.

The renderer keeps the current route out of the window URL, and the main window restores its persisted tab session on load. So `location.hash` is not the route, and navigating the web contents to a route URL does not open it — the restored tabs paint over it. Use `state` to read where you are and `goto` to move.

In `state`, `path` is authoritative; `tabs[].pathname` mirrors it a moment later.

## States a dev build otherwise cannot reach

Both have a dev panel entry under the `dev` badge:

- **Updates > Simulate updated toast (reloads)** — the toast only fires when the app launches on a newer version than the last launch. The item queues the bump and reloads, the path a real update takes. It auto-dismisses in a few seconds, so capture promptly.
- **Force quit guard** — dev builds skip the running-agent quit prompt so hot reload is never blocked on a dialog nobody sees. In memory only, so a relaunch clears it; while on, a main-process rebuild waits on the dialog.

The quit prompt is a native `showMessageBox`, outside the web contents. CDP cannot capture it.

## Traps

- `element.click()` from an evaluated script dispatches a bare `click`, so it misses a handler mounted on an ancestor (how file cards and list rows are built) and every menu, popover and select, whose Radix triggers open on `pointerdown` and carry no click handler at all. It returns normally either way, so the run carries on against an unchanged UI. Use real input.
- A control scrolled out of a long list is brought into view and then clicked, and the step reports `scrolledIntoView` so a capture taken afterward is not read as the same viewport. One still clipped after that (inside a collapsed pane, behind an overlay) fails saying so, with the coordinate, rather than dispatching at a point the window does not cover.
- `press` takes combinations: `press 'Meta+k'`, `press 'Control+Shift+R'`, `press Escape`, `press ArrowDown`. A modifier changes what gets sent, so `Meta+k` fires the shortcut without also typing a `k`.
- `use-stick-to-bottom` releases auto-follow on `wheel`, so assigning `scrollTop` is overridden immediately, and UI that only appears when scrolled off the live edge stays unreachable.
- `?` opens the shortcut guide only when focus is outside an editable and nothing is blocking. Pressing it while the composer has focus does nothing and reads as the tool failing.
- After a main-process edit, the relaunched Electron can lose the debug port to the dying instance (`bind() failed: Address already in use`) and come back with no endpoint. Restart the dev server.
- Studio sets Chromium's `allow-pre-commit-input` so CDP mouse input works against `<webview>` guests.

## The CLI, for what it alone can do

Performance traces, Lighthouse, heap snapshots. Not driving: for anything `studio-drive` covers, it is the same job through a daemon that goes stale, on a port it guesses wrong.

```bash
CDT=.agents/skills/studio-chrome-devtools/scripts/cdt

$CDT list_pages
$CDT performance_start_trace --reload true --autoStop true
```

`cdt` resolves this checkout's port through `studio-drive.mjs port`, starts the daemon against it, and sets both quieting variables, so output is the answer rather than the answer plus an update nag. Reaching for `pnpm exec chrome-devtools` directly means picking the port and remembering the variables yourself, and 48160 is almost certainly someone else's window.

`bash .agents/skills/studio-chrome-devtools/scripts/connect-cli.sh [browserUrl] [urlFragment]` does the same and then selects a page by URL fragment, which is worth it when the profiler has to attach to a specific webview guest rather than the app page.

Know this before reaching for a trace, because it is a dead end that costs several minutes to find: **the CLI profiles page loads, not interactions.** Its report is organized as insight sets split by navigations, so a trace with no navigation in it has nothing to report, and on 1.6.0 `performance_stop_trace` returns nothing at all either way, `--filePath` included. The one path that reports is:

```bash
$CDT performance_start_trace --reload true --autoStop true    # prints its summary
```

Which reloads the app, and therefore cannot answer what an in-page interaction costs: opening a modal, switching tabs, rendering a task. For those, drive CDP's `Tracing` domain directly (`Tracing.start`, do the thing, `Tracing.end`, collect `Tracing.dataCollected`), the way `studio-drive` already speaks CDP. Mark the interaction with `performance.mark` so the window is findable in the events afterward.

- `--browserUrl` belongs on `start`; later subcommands talk to the daemon.
- The daemon outlives invocations and keeps its old version after a package upgrade. `stop` then `start` to pick up a new one, or to clear a stale socket behind an `ENOENT`.
- `evaluate_script` requires an anonymous `function () { ... }` string, not an arrow or a bare expression. (`studio-drive eval` accepts either.)
- Input commands exist beyond the obvious ones: `press_key` takes combinations like `Control+Shift+R`, plus `type_text`, `handle_dialog`, `upload_file`, `screencast_start`. `studio-drive` covers the same ground without the daemon.

## Reference

[references/repro-recipes.md](references/repro-recipes.md): replaying a recorded task instead of live-driving the agent, the `#/debug/*` pages, the composer's controlled-input gotcha where `fill` leaves the send button disabled, reading a `<webview>` guest's internal state, and why screenshot pixel math should never be hand-converted.
