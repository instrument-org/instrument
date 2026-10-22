---
name: studio-chrome-devtools
description: Use when working with Chrome DevTools against the Studio Electron app in this repo. Load this for Studio-specific connection details and page selection. Especially relevant when the user mentions Electron, `chrome-devtools`, `chrome-devtools-cli`, browser views, smoke tests, or debug routes.
---

# Studio Chrome DevTools

How to drive and inspect the Studio Electron app.

`studio-drive.mjs` is the way in. The generic `chrome-devtools` / `chrome-devtools-cli` skills describe a tool that has never heard of Studio: it cannot derive this checkout's port, cannot tell a restart from a crash, and reports both as "Could not connect to Chrome. Check if Chrome is running", which sends a run off to hunt for a browser that was never involved. Read them when you need the profiler's own syntax ([The CLI, for what it alone can do](#the-cli-for-what-it-alone-can-do)), not to decide how to reach the app.

The shape to reach for is a sequence, not a command:

```bash
node $DRIVE boot --purpose "skills dialog"    # once
node $DRIVE run sequence.mjs                  # everything you came to do
node $DRIVE stop                              # once
```

`boot` and `stop` bracket the work and [`run`](#a-sequence-run) is the work. One `studio-drive` invocation is one process and one connection, which is right for a single question and wrong for anything else: a primitive costs milliseconds over a held connection while deciding the next command costs seconds, so twelve steps measure at 1.2s as one `run` against roughly two minutes as twelve commands. Write the sequence first, and drop to single commands only when you have exactly one thing to ask. The per-command reference comes first below because `boot` lives in it, not because it is the default.

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
node $DRIVE rpc workspace.chats.tasks '{"id":"<chat-id>"}'
node $DRIVE stop
```

Also `press`, `type`, `wait`, `modal`, `eval` (also spelled `js`, for a harness that refuses command lines containing "eval"), `run`, and `port` (the bare number, for pointing another tool at this instance). `click <name> --right` opens a context menu and `--double` double-clicks; put either last, since every flag takes the word after it. `click` fails when something else in the page is on top of its target. When the page stops drawing or closes after the click (a native dialog the click opened, a window in front, onboarding finishing), the click still happened, and its result says so in `afterInput` instead of hanging. To open Files at a folder, `goto "/files?path=&root=<encoded host path>&select=<name>"` (`folderHref` in `apps/studio/src/shared/computer-href.ts`); a toast's text is `[data-sonner-toast]`'s `innerText`. `run --args @args.json` and `bash --file cmd.txt` read their input from a file, for text a shell would mangle (Windows backslashes, quotes inside a prompt). It speaks CDP directly, so there is no daemon to go stale and no reconnect to invalidate page ids, and it handles the things that otherwise fail quietly: real input, visible-only element matching, browser-side screenshot cropping, and a check that something is mounted before capturing.

One command is one process and one connection. That is the right shape for a single question and the wrong one for a sequence, so as soon as you know two things you want to do, reach for [`run`](#a-sequence-run) instead.

`snapshot` is the read to reach for before deciding how to address anything. It prints the accessibility tree as indented `role "name"` lines, in the same terms `click --text` matches on and at a fraction of the size of the DOM, so one call answers what is on screen and what each thing is called. Scope it with `--selector` and go deeper with `--depth` (12 by default); an unscoped app page is a few hundred lines.

A control that comes back as a bare `button`, with no name after it, cannot be reached by text at all. That is a labeling bug rather than a fact about the tool, and a screen reader gets the same nothing, so it is worth reporting. To get past one in the meantime, mark it in an `eval` and click the mark, which keeps the real input path rather than falling back to `element.click()`:

```bash
node $DRIVE eval 'document.querySelectorAll("button[aria-haspopup=menu]")[3].setAttribute("data-probe", "kebab")'
node $DRIVE click --selector '[data-probe=kebab]'
```

`boot` requires `--purpose` with a terse description of what this instance is testing, such as `"hotkeys"` or `"document viewer"`. Keep it to one or two short words; the launcher rejects anything over 24 characters. The purpose labels the instance for its lifetime so a person can distinguish agent-driven windows at a glance: on macOS the app is named `Instrument <purpose>` in Cmd-Tab, the Dock, and the menu bar, and `boot` hands it a `color` (in its output) worn as a dot on the Dock icon and the dev pill. A purpose keeps its color across boots unless another live instance already wears it, so tell the person which color to look for. Reusing the instance with the same purpose works normally; asking to reuse it with a different purpose fails and tells you to stop it first so the window never carries a stale label.

A booted instance never comes on screen by itself, because a window put up, even without focus, can land on a Space its display is not showing, and macOS then scrolls the display there and takes the person's focus with it. Its windows render, take input and answer screenshots off screen, and keep drawing once covered, minimized, or on another Space, in-app browser pages included. `shot`, `click`, `press` and `agent-browser` all work with nothing in view, so never raise the window (`osascript ... set frontmost` takes the person's focus). The person takes an instance over by clicking its Dock icon, which is what the color is for. `--visible` puts the window up without focus, for a run that needs its real pixels on screen (`screencapture -l`). It also marks the instance as a person's: Checkout and the billing portal open in the system browser for real, where an instance booted without it holds them back for the run to finish headless. In-app browser typing still needs the page to hold keyboard focus, which a page in an inactive window only gets from a click: when `fill` or `type` is refused, click the field and send it again.

The port is derived from the checkout you are standing in. `boot` will not fall back to 48160 because that is the conventional port and almost always a window a person is using, so driving it means their clicks fight yours and their quit ends your run. Pass `--port` to target one deliberately.

It also clears `ELECTRON_RUN_AS_NODE` from the app's environment, so there is no need to unset it first. Some editor integrations set it, and with it set Electron runs as plain Node and exits without ever opening a window.

`modal` takes its names from the running app (`modal` with none prints them), so the list cannot drift from the openers the renderer has.

Route and modal commands go through `window.__studioDrive`, a handle the renderer attaches (`client/lib/studio-drive.ts`) in a development run and in a preview build. A release build, and any checkout without that file, will not have it.

`boot` returns as soon as that handle exists, which is when the app can be driven — not when the restored route has finished loading. A `shot` fired straight after `boot` can therefore catch a chat still filling in. When a command depends on route content rather than on the chrome, wait for the thing itself:

```bash
node $DRIVE wait 'document.querySelectorAll("[data-slot]").length > 40'
```

An instance this boots holds its main process and preload scripts at the bytes it started with, so another agent's edit under `electron-main/` or `packages/` no longer relaunches the app underneath a run. The cost is that a change you make there does not reach it: stop and boot again, or add `--hot` to the boot for a run that is iterating on main or testing reload behavior. A hand-started instance (`pnpm studio`, the VS Code launch configs, port 48160) is unaffected and hot reloads everything.

Renderer HMR stays on, so any write under `src/client` — another agent's edit, a commit, a formatter — still rebuilds component state, and a change HMR cannot apply reloads the page and takes the state a run navigated to with it. When that has happened since the previous command, the next one says so on stderr:

```plaintext
studio-drive: the app reloaded since the last command. Whatever was navigated to, opened, or typed is gone; ...
```

Believe it. A result that disagrees with the one before it, after that line, is describing the reload and not the code. Re-establish the state and take the reading again rather than explaining the difference.

A command that arrives while the app is still restarting waits for it to come back, so a rebuild landing mid-run costs a pause rather than a failure. "Nothing is running for this checkout" means the instance is gone, not that it is busy.

A plain `boot` uses the shared dev application-data directory, so what a run can reach depends on what that machine did last. `--workspace <fixture>` boots against a disposable one built from a committed description:

```bash
node $DRIVE boot --purpose "document viewer" --workspace documents
node $DRIVE goto /chats/red-and-blue-squares --workspace documents
```

It seeds when the fixture or the seeder is absent or has changed (`--fresh` forces a rebuild), and a boot that would reuse a running instance refuses when its seed is out of date, or when what answers on its port is not this checkout's app. It starts each boot with no tabs restored from earlier runs (`--keep-tabs` keeps them), points the fixture's output folder at `<fixture>-output` beside it (`INSTRUMENT_OUTPUT_FOLDER`) and its chats' work folders and granted folders at `<fixture>-home` (`INSTRUMENT_DATA_HOME`), so its agents never write into the developer's real `~/Instrument Dev` or `~/.instrument-dev/work`, and reports what it seeded: each chat by its id, which is its fixture key, and each task by its session in its chat's store (a task's page is `/tasks/<session>?chat=<chat-id>`), so a script addresses a chat by name instead of grepping for one. `--workspace` belongs on every command of the run: it picks the port and the instance record, so a fixture run and a plain dev run can both be up. `pnpm workspace:seed --list` shows what exists; `fixtures/workspaces/README.md` covers adding one.

`--clean-room <name>` is the other kind of isolation: a blank workspace with no chats, opened by a second process on the developer's own application data and pinned to it with `INSTRUMENT_WORKSPACE`, so the developer's instance keeps its own workspace. It shares the machine's toolchain and caches, so it boots as fast as a plain run, and `--with-sign-ins` copies the developer's Instrument account and API keys into it (not a ChatGPT account, whose rotating refresh token would sign the developer's own instance out), so it can run a real agent turn, which a fixture cannot. Like `--workspace`, it goes on every command, and its chats' work folders go in `<name>-home` beside it (`INSTRUMENT_DATA_HOME`). Clean rooms live beside the fixture caches, are reaped after 3 days unbooted, and `--fresh` empties one first. A checkout's caches go with it: the next boot from any checkout drops those of a checkout that no longer exists.

```bash
node $DRIVE boot --purpose "first chat" --clean-room first-chat --with-sign-ins
node $DRIVE rpc workspaces.current '{}' --clean-room first-chat
```

`--account <file>` on `boot` signs a fixture, a clean room or a scenario in as a given Instrument account and points that instance at the account's API, so a run can start as an account in a particular state instead of signing in and working up to it. The file is JSON with the API's address (`api`) and a session token on it (`token`); the platform's own tooling writes them, and how is documented there. It replaces whatever session the workspace held, and an instance already running signed in as someone else is refused rather than reused, since the API it talks to is fixed when it boots.

```bash
node $DRIVE boot --purpose "near limit" --workspace documents --account ~/.instrument/accounts/scenario-near-limit-4fa6.json
```

Fixtures and clean rooms set `SKIP_ONBOARDING`, so they open on the app window whatever setup would say, and pin their workspace with `INSTRUMENT_WORKSPACE`, which a run that skips setup has to name. `--scenario <name>` is for the states setup reads: it builds application data of its own from `fixtures/scenarios/<name>.yaml` (a workspace, where the folder is, sentinel sign-ins, setup's record, and the notification and network status a development build takes from the environment), rebuilds it on every boot, and leaves setup to decide. Like `--workspace`, it goes on every command. Read where setup landed from its state rather than the screen: `setup.live.state` is a live route, so take its first value in an `eval`, as below. `setup.answer`, `setup.finish` and `setup.dev.reset` go through `rpc`. `fixtures/scenarios/README.md` lists the scenarios and the file's keys; the dev panel's "Run setup again" forgets the record in any instance.

```bash
node $DRIVE boot --purpose "setup" --scenario beta-tester
node $DRIVE eval '(async () => { const it = await window.__studioDebug.rpc("setup.live.state"); const { value } = await it.next(); await it.return?.(); return value; })()' --scenario beta-tester
```

An instance started from a terminal answers to the terminal's macOS privacy grants, so it usually has Full Disk Access and never sees a protected folder refuse it or ask. `boot --own-privacy` (macOS) starts Electron through a launcher that makes it responsible for its own grants, so Documents asks on first read and a Full Disk Access folder (`~/Library/Mail`) comes back refused, the way an installed app's would. Electron stays in the instance's process group, so `stop` ends it like any other. The grants belong to the instance's dev Electron clone, not a signed build: each clone has its own bundle identifier, `com.github.Electron.<checkout folder>.<instance name>` (`devBundleId` in `apps/studio/scripts/dev-supervisor.ts`), and they outlive the instance: an answer given to a prompt holds for every later `--own-privacy` run of that checkout and purpose until `tccutil reset All <that identifier>` clears it. Reading a protected folder from one opens a system prompt on the developer's screen, so say so before a run that will.

Reach for a fixture when the run needs known content, a clean room when it needs an empty workspace that can talk to a model, and `ELECTRON_USER_DATA_DIR=<empty dir>` when it needs a first launch on a fresh machine. Never switch the developer's instance (`workspaces.switch`) to get isolation: that restarts the window they are using.

## A sequence: `run`

`run` hands a script the app from `scripts/studio-app.mjs` over one held connection. The script default-exports `(app, args)` and returns whatever is worth reporting:

```bash
node $DRIVE run sequence.mjs --args '{"chat":"…"}'
cat sequence.mjs | node $DRIVE run -          # or on stdin, no quoting to get wrong
```

```javascript
export default async (app, args) => {
  await app.openModal("settings");
  await app.waitFor('document.querySelector("[role=dialog]")');
  await app.expect(
    'window.__studioDrive.state().dialog === "Settings"',
    "the dialog to open",
  );

  // branch on what you found, which a shell chain cannot do
  const tasks = await app.rpc("workspace.chats.tasks", { id: args.chat });
  if (tasks.length > 0)
    await app.goto(`/tasks/${tasks[0].id}?chat=${args.chat}`);

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
node $DRIVE rpc workspace.chats.tasks '{"id":"<chat-id>"}'
node $DRIVE rpc workspace.chats.byId '{"id":"red-and-blue-squares"}'
node $DRIVE rpc gateway.models.list
```

The input is one JSON argument, and the routes are the ones in `packages/workspace/src/rpc/routes/` under `workspace.`, plus Studio's own (`apps/studio/src/electron-main/rpc/routes/`) at the top level.

A chat is the only record: `<chat-id>` is its folder name under the workspace's `.instrument/chats/` (the id in a `/chats/<id>` address), and its per-chat reads (`info`, `state`, `files`, `backgroundProcesses`) are under `workspace.chats.*`. A task is a session in its chat's store, so tasks are listed one chat at a time (`chats.tasks`, each row with its `standing` and whether it is `stoppable`), and no route lists every chat's tasks. `workspace.chats.session '{"id":"<chat-id>"}'` gives a chat's session, for the routes that read its transcript; `workspace.chats.ofSession '{"sessionId":"ses_..."}'` turns a session back into its chat.

Reach for this before the DOM whenever the question is about state rather than about pixels. Scraping `document.body.innerText` for a status answers what the UI painted; the route answers what the UI painted _from_, which is the thing under test, and it does not move when a component does.

## Running a command in the app's own sandbox

`bash` runs one command in a chat's real sandbox and returns `stdout`, `stderr`, `exitCode`, and `durationMs`, through `workspace.debug.runBash`:

```bash
node $DRIVE bash 'curl -sS -o /dev/null -w "%{http_code}" https://example.com' --chat <chat-id>
node $DRIVE bash 'ffprobe /nope.mp4 2>/dev/null; echo exit=$?' --chat <chat-id> --task <session-id>
```

It runs as the chat's own session unless `--task` names one of its tasks by session. Without `--chat` it takes the chat or task the active tab is showing, which a packaged build cannot read, so there it needs an explicit `--chat`.

This is not `run-bash`, and the difference decides which one answers a question. `run-bash` builds its own sandbox from a checkout's dependencies, with no task and no app, which makes it fast and makes it blind to anything about a package: a command missing from a bundle resolves fine from `node_modules` and reports success. `bash` runs the mounts, shims, network policy, and bundled binaries of the build that is actually running. Verifying a shipped release wants this one; iterating on a shell fix wants the other.

- It is gated on the **Developer Mode** preference, checked per call. Fixture workspaces pin it on; the shared dev workspace depends on what was last set in Settings > General, and the bridge cannot turn it on for you.
- `live.*` routes are event iterators and cannot come back through a single evaluation. Call the plain sibling in a loop instead (`chats.tasks`, not `chats.live.tasks`).
- Errors come back as data, so a Zod failure prints its issues rather than a stack.

## Running a chat without touching the UI

Two routes start a chat and send its first prompt, the way the window's composer does, and no part of this has to go through the composer (whose ProseMirror editor is its own trap, see [references/repro-recipes.md](references/repro-recipes.md)). The chat's session id is the caller's to choose: `ses_` and a ULID.

```bash
node $DRIVE rpc gateway.models.list                  # pick one; build <author>/<canonicalId>?provider=…&providerConfigId=…
SES="ses_0$(LC_ALL=C tr -dc '0-9A-HJKMNP-TV-Z' </dev/urandom | head -c 25)"
node $DRIVE rpc workspace.chats.ensure "{\"sessionId\":\"$SES\",\"firstWords\":\"smoke\"}"   # -> {id}
node $DRIVE rpc workspace.message.create "{\"id\":\"<chat-id>\",\"newSessionId\":\"$SES\",\"modelURI\":\"<uri>\",\"prompt\":\"…\"}"
node $DRIVE wait --idle --chat <chat-id>
node $DRIVE rpc workspace.message.list "{\"id\":\"<chat-id>\",\"sessionId\":\"$SES\"}"
```

`scripts/chat-turn.mjs` does all of that in one `run`, and returns the turn as one short line per step (text, tool call, refusal) rather than the full `message.list`, stopping early when one of the chat's own cards is waiting (`waitingOn` lists them): `node $DRIVE run .agents/skills/studio-chrome-devtools/scripts/chat-turn.mjs --quiet --args '{"prompt":"…"}'`, then `{"chat":"<id>","prompt":"…"}` to follow up, `{"chat":"<id>","answer":"allowed"}` (or `always`, `declined`) to answer its cards and read on, or just `{"chat":"<id>"}` to read the latest turn. `"wait": false` returns once the prompt is sent, for a turn that starts a long task. Cards and turns are read per chat over RPC, so several chats can be driven at once.

`message.create` with `sessionId` instead of `newSessionId` sends a follow-up into the same session. Tasks the chat starts show up in `chats.tasks`; read one's transcript with `message.list` and its session. A seeded fixture workspace holds no credentials, so a live turn needs a plain `boot` against the dev workspace.

### Waiting for a turn

`wait --idle` polls the chat's routes until nothing in it is at work, which is the signal the app itself uses. Without `--chat` it takes the chat or task the active tab is showing.

```bash
node $DRIVE wait --idle --chat <chat-id>                       # blocks for the turn, default timeout 10m
node $DRIVE wait --idle --chat <chat-id> --task <session-id>   # one task in it
```

Two things about that status are worth knowing before trusting a wait built on it by hand:

- A chat is busy while `chats.byId` reports its `state` as `working`: its own agent is alive, a task it started is moving, or a message it was just sent waits for its agent. A task is busy while its `chats.tasks` row is `stoppable`, meaning its session carries the `agent.alive` tag, which every non-final state of the session machine does. A turn that is over reports not working rather than `agent.done`, because the workspace machine drops the ref when the session finishes.
- Which makes "not working" also what a chat or task reports _before_ its turn starts. `wait --idle` covers that by requiring idle to hold for `--settle` (2s) until it has seen it busy, and reports `sawBusy` so you can tell which happened. `sawBusy: false` on a wait that was meant to follow a prompt means the prompt never started an agent.

## Page model

The app window is one web contents: its chrome and every open tab mount in the same page, each tab a router of its own across the bar. Agent-browser tabs are renderer `<webview>` guests inside it, not separate DevTools targets. The onboarding window, on a first run, is a second page under `/renderer/`; commands drive the app window's unless given `--page onboarding`. A first launch of a packaged build opens there, so that is how its sign-in and welcome steps are driven. A launch that refuses its workspace (one made by a newer build, or a folder it cannot read) opens only a window of its own, a `data:` page with no `__studioDrive` behind it: `boot` returns once it is up, with `refusal: true`, and `--page refusal` drives it (`shot`, `snapshot`, `click --text`).

The renderer keeps the current route out of the window URL, and the window restores its persisted tabs on load. So `location.hash` is not the route, and navigating the web contents to a route URL does not open it. Use `state` to read where you are and `goto` to move: `goto` sends the tab up to the route, or a new tab with `--new-tab`, and `state` reports the tab up's `path`, the `tabs`, and `dialog`. A chat's own tabs (its browsers and files down its rail) are not routes; read them with `snapshot` or `eval`.

In `state`, `path` is authoritative; `tabs[].pathname` mirrors it a moment later.

### Sweeping its screens for errors

`scripts/sweep-screens.mjs` walks every screen of the app window and reports the console errors, warnings and uncaught exceptions each one produced, named by screen:

```bash
node $DRIVE run $(dirname $DRIVE)/sweep-screens.mjs
node $DRIVE run $(dirname $DRIVE)/sweep-screens.mjs --args '{"reload":true}'
```

It reads an app slug, a chat and one of its tasks off the running app, so the parameterized screens are covered without an id written down here going stale and turning an unvisited screen into a clean result. `reload` restarts the renderer first, which is the only way to see what a screen logs while it _mounts_; it costs the wait, so it is off by default.

Enabling the `Runtime` domain replays the console buffer, so a run would otherwise open by reporting whatever the window logged earlier — an older run's errors, or a person's — as its own findings. Nothing is recorded until the walk starts, and the reload happens before the enable so the buffer it clears is not the one that replays.

The event subscription behind it (`app.cdp.on`) is available to any sequence; the domain that emits them still has to be enabled (`app.cdp.send("Runtime.enable")`).

## Measuring the renderer

Count before timing. This machine is usually busy, so a frame time from one run says little about the next, while a count of what happened does not move with load: how many commits, which components rendered and why, how many RPC messages and bytes each procedure sent. `perf-probe-page.js` records those from ahead of the renderer's first script, and two sequences install it and report per scenario:

```bash
node $DRIVE run $(dirname $DRIVE)/perf-screens.mjs --allow-reload --workspace documents
node $DRIVE run $(dirname $DRIVE)/perf-chat-turns.mjs --allow-reload --clean-room perf \
  --args '{"prompts":["Without using any tools, write 600 words on lighthouses."],"watch":["MessageScrollerItem"]}'
```

`perf-screens` covers boot, an idle window, a walk of the screens, and opening chats. `perf-chat-turns` streams turns into one new chat on Workers AI and reports each turn's `kbPerUpdate` and `fibersPerCommit` beside the session's size: a cost that grows with the session rather than with the update is the thing to look for. `watch` names components whose renders it explains (`prop:children`, `state`, `context-or-forced`), which is what tells a missing memo from a parent that rebuilds its children. Both need `--allow-reload`, since installing the probe reloads the window.

Long animation frames come back too, and those do depend on load: compare them only between runs taken side by side, ideally alternating, and say which machine they came from. The counts are the same in a dev run and a production build, so a dev run answers render and wire questions. Load time (parse, code cache, bundle size) needs a production build, made in a worktree of your own: a build replaces the `out/` that every dev instance of its checkout runs from.

## Measuring the main thread

Typing and pasting wait on the main process's thread twice: once for the key to reach the page and once for the paste's clipboard read. So input lag is a main-thread question, and the renderer's own timestamps cannot see it (`KeyboardEvent.timeStamp` is when the renderer got the event). Boot with the main process's inspector open and sample it:

```bash
node $DRIVE boot --purpose "main stalls" --inspect 9339
node $(dirname $DRIVE)/main-stalls.mjs --port 9339 --seconds 15
node $(dirname $DRIVE)/main-stalls.mjs --port 9339 --seconds 15 --profile main.cpuprofile
```

It drives nothing, so it is safe while someone is at the machine. Read `stallsOver.60` first: a paste-based dictation tool that restores the clipboard after 60 ms loses text on any stall past about 40 ms. A quiet main thread has none over 30 ms. `--profile` writes a CPU profile of the same window for DevTools' Performance panel, which names what held the thread.

To measure at a real workspace's scale, boot against a copy of it. `cp -cR` makes an instant copy-on-write clone of an Application Support `workspace` folder into a directory of your own, and `boot` hands its environment to the app, so `ELECTRON_USER_DATA_DIR=<that directory> INSTRUMENT_WORKSPACE=<that directory>/workspace SKIP_ONBOARDING=true node $DRIVE boot …` opens the copy (a run that skips setup names its workspace, or the app refuses to start). A copy has no provider credentials, so it measures the app, not a model turn.

## States a dev build otherwise cannot reach

Both have a dev panel entry under the `dev` badge:

- **Simulate > Just updated** — the toast only fires when the app launches on a newer version than the last launch. The item queues the bump and reloads, the path a real update takes. It auto-dismisses in a few seconds, so capture promptly.
- **Simulate > Quit prompt** — dev builds skip the running-agent quit prompt so hot reload is never blocked on a dialog nobody sees. In memory only, so a relaunch clears it; while on, a main-process rebuild waits on the dialog.

The quit prompt is a native `showMessageBox`, outside the web contents. CDP cannot capture it.

Dictation needs a microphone, and a real one raises the system's permission prompt in front of whoever is at the machine. Boot with `FAKE_MICROPHONE=true node $DRIVE boot …` and the app records Chromium's test tone instead, with access reported as granted. To dictate real words, set it to the path of a WAV file instead (`FAKE_MICROPHONE=/path/speech.wav`), which the fake device plays on a loop; `say -o speech.wav --data-format=LEI16@16000 "…"` makes one. Main reads it at launch, so it takes a fresh boot.

## Traps

- `element.click()` from an evaluated script dispatches a bare `click`, so it misses a handler mounted on an ancestor (how file cards and list rows are built) and every menu, popover and select, whose Radix triggers open on `pointerdown` and carry no click handler at all. It returns normally either way, so the run carries on against an unchanged UI. Use real input.
- A control scrolled out of a long list is brought into view and then clicked, and the step reports `scrolledIntoView` so a capture taken afterward is not read as the same viewport. One still clipped after that (inside a collapsed pane, behind an overlay) fails saying so, with the coordinate, rather than dispatching at a point the window does not cover.
- `press` takes combinations: `press 'Meta+a'`, `press Escape`, `press ArrowDown`. A modifier changes what gets sent, so `Meta+a` does not also type an `a`.
- A chord the main process binds (Cmd+T, Cmd+W, Cmd+R, Cmd+,, the Developer chords) does nothing over CDP: injected keys never pass through `before-input-event` or the native menu. Drive what the chord does instead (`goto`, `modal`, `rpc`), and check the chord itself by hand.
- `use-stick-to-bottom` releases auto-follow on `wheel`, so assigning `scrollTop` is overridden immediately, and UI that only appears when scrolled off the live edge stays unreachable.
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

[references/repro-recipes.md](references/repro-recipes.md): the `/debug/*` pages, the composer's raw-DOM-write gotcha where `fill` leaves the send button disabled, reading a `<webview>` guest's internal state, and why screenshot pixel math should never be hand-converted.
