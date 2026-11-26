---
name: studio-chrome-devtools
description: Use when working with Chrome DevTools against the Studio Electron app in this repo. Load this for Studio-specific connection details and page selection. Especially relevant when the user mentions Electron, `chrome-devtools`, `chrome-devtools-cli`, browser views, smoke tests, or debug routes.
---

# Studio Chrome DevTools

How to drive and inspect the Studio Electron app.

`studio-drive.mjs` is the way in, and a script in the product's words is the way to use it: tabs, groups, sides, the composer, the omnibar, menus by item name, dialogs. Every word finds its target by role and accessible name, acts with real input, and returns once the app has settled, so a script never sleeps; a miss fails with what is on screen, the nearest names and a picture.

```bash
DRIVE=$(git rev-parse --show-toplevel)/.agents/skills/studio-chrome-devtools/scripts/studio-drive.mjs
F="--workspace documents --as mine"

node $DRIVE boot --purpose "split" $F                 # once; off screen
node $DRIVE run $F -e 'await menu("New Tab in Split"); await composer.type("hi"); return state()'
node $DRIVE run $F sequence.js --args '{"chat":"red-and-blue-squares"}'
node $DRIVE run $F split                              # a scene: scripts/drive/scenes/split.js
node $DRIVE stop $F                                   # once
```

`run --purpose <p>` boots first when nothing is up. One `run` is one held connection, so twelve steps take about a second where twelve commands take minutes: write the sequence, and reach for a single command only for one question. The generic `chrome-devtools` skills know nothing of Studio (the port, a restart from a crash); read them only for the profiler ([The CLI](#the-cli-for-what-it-alone-can-do)).

## Words

A script is statements with every word in scope, `args` for `--args`, and a `return` for what to print; each step prints one line with its time. The same body runs from `-e`, a file, stdin (`run -`) or a scene name, so an inline script that earned its keep becomes a scene by saving it to `scripts/drive/scenes/<name>.js`. A file that default-exports `(app, args)` gets the lower-level `app` ([A module](#a-module-run-with-app)) with the words at `app.words`. `node $DRIVE words` prints this list from the code:

<!-- words:start -->
- `thing.nth(i)`: the i-th of several things with one name (0 first, -1 last)
- `thing.button(name) / .field / .toggle / .tab / .row / .item / .link / .find(role, name)`: one inside this one
- `thing.text()`: the words it shows; thing.see(text) waits for text inside it
- `thing.click({ button, count, modifiers, at })`: a real click at its middle (or at [fx, fy] of its box)
- `thing.dblclick() / thing.rightClick()`
- `thing.menu(...items)`: right-clicks it and picks the item (a path for a submenu); with no items, returns what the menu offers
- `thing.hover()`: the pointer rests on it until the app settles
- `thing.focus()`: puts the keyboard on it
- `thing.type(text)`: clicks into it and types, as keys would
- `thing.fill(text)`: replaces what it has with text
- `thing.value()`: what a field holds; thing.isOn(): a toggle's state
- `thing.exists()`: whether it is on screen now, without waiting
- `thing.wait({ timeout }) / thing.gone({ timeout })`: until it shows, or until it is no longer on screen
- `thing.box()`: its place and size in the window, in CSS px
- `thing.shot(file?)`: a picture of just it
- `thing.measure(...properties)`: its box and computed styles
- `thing.outline()`: the tree under it, as state() shows the screen
- `thing.drag()`: the start of a drag from it; see drag()
- `tab(name).close()`: its close button, shown on hover; tab().close() is File › Close Tab when the side has no strip
- `tab(name).page()`: the web page it shows
- `find(role, name)`: anything by its role and accessible name
- `button(name), link(name), field(name), toggle(name), row(name), item(name), heading(name), control(name)`
- `click(name)`: clicks whatever control has that name
- `see(text, { timeout })`: waits until the text shows, and fails with the screen when it does not
- `tab(name)`: a tab in the group up, by its title; tab() is the one up; tabs() lists every tab of the window's groups
- `group(name)`: a tab group's row in the sidebar; .open(), .close(), .menu(...)
- `side("left" | "right")`: one side of a split group, to look inside: side("right").button("Send")
- `groups()`: the window's groups, each with its sides and tabs
- `press(chord)`: a key or chord as a person presses it: "Escape", "Meta+t", "Shift+Meta+]". The window's own shortcuts hear it, then the page, then the menu bar's
- `type(text)`: types into what has the keyboard; fails when nothing has it
- `paste(text)`: pastes text into what has the keyboard, leaving the clipboard alone
- `menu(...items)`: picks an item in the menu that is open (the app's or a system one held for the run); with none open, in the menu bar: menu("File", "Print…") or menu("Print…")
- `menu.items()`: what the open menu offers, as lines
- `menu.close()`: closes the open menu
- `menu.bar()`: the menu bar's menus and items, as lines
- `dialog`: the dialog in front, the app's or a system one held for the run. dialog.text(), dialog.button(name).click(), dialog.answer(button), dialog.cancel(), dialog.choose(paths) for a file picker
- `composer`: the reply box of the side with the keyboard. composer.type(text), composer.send(text), composer.text(), composer.clear(), composer.button(name)
- `omnibar`: the address field of the page up. omnibar.go(address) opens it (in a new tab's box when no page is up), omnibar.type(text), omnibar.rows(), omnibar.pick(row), omnibar.text()
- `commandMenu`: ⌘K. commandMenu.open(), commandMenu.search(text), commandMenu.rows(), commandMenu.pick(name), commandMenu.close()
- `sidebar`: sidebar.toggle(), sidebar.isOpen(), sidebar.width(px) drags its edge, sidebar.button(name), sidebar.new() makes a group
- `settings`: settings.open(section?) opens Settings at a section, settings.toggle(name) a switch on it
- `toast()`: the toasts showing, as text; toast.button(name) inside the front one ("Undo")
- `chat(name?)`: a chat, opened from the command menu by name; chat() is the one up. .open(), .state() (title, working, model), .idle() waits for its agent to stop
- `files`: the Files screen. files.open(folder?) opens it, files.item(name) a file or folder in it (.click(), .dblclick(), .menu(...))
- `page()`: the web page up in the side with the keyboard (tab(name).page() for another). page.url(), .title(), .text(), .eval(js), .see(text), .click(name?), .menu(name?, ...items), .type(text), .shot(file)
- `drag(thing)`: drags it with the mouse. drag(tab("A")).to(target) drops it where it lands on arrival (between rows, beside a tab); .into(group("B")) rests on it until it goes in; .over(target) holds it there and returns the app's drag; .drop() / .cancel() end it
- `dropFiles(paths).on(thing)`: drops files from the Finder onto it; .over(thing) holds them there
- `shot(file?)`: a picture of the window; returns its path
- `burst(action, { every, max, dir })`: pictures of the window every `every` ms (50) while action runs; returns their paths
- `keyboard()`: what has the keyboard, as `role "name": "value"`, or null
- `state()`: what is on screen, as text: groups, tabs, the dialog or menu in front, toasts, and the screen's outline
- `theme("dark" | "light" | "system")`
- `size(width, height)`: sizes the window's content, which keeps its place off screen
- `goto(address, { newTab })`: opens an app address (/chats, instrument://settings) in the tab up
- `errors()`: console errors and uncaught exceptions since the run began
- `until(check, { timeout, every })`: waits until a function (or page expression) returns something truthy, and returns it
- `expect(value, message)`: fails the run with the screen when value is falsy
- `windows()`: the app's windows, newest first; window(n) is the n-th's own words
- `seed.file(relativePath, content)`: writes a file into the workspace folder; seed.chat(prompt) makes a chat with model.replies' next answer
- `model.replies([...])`: a stand-in model for the run that answers each agent turn with the next reply (text, or { tool, input }), set as the default model; returns what it was asked
- `js(expression)`: evaluates in the app window's page and returns its JSON value
<!-- words:end -->

## Single commands and booting

`goto`, `state`, `snapshot`, `click`, `press`, `type`, `wait`, `modal`, `eval` (also `js`), `shot`, `rpc`, `bash`, `port` and `status` each run one thing over a connection of their own; `help` lists them with their flags. `snapshot` prints the accessibility tree as `role "name"` lines, the names the words match on. A control that shows as a bare `button` with no name is a labeling bug a screen reader meets too: give it an `aria-label` in the app rather than marking it from a script.

`boot --purpose <one or two words>` (24 characters at most) labels the instance for its life: on macOS the app is `Instrument <purpose>` in Cmd-Tab, the Dock and the menu bar, with a `color` (in boot's output) as a dot on its Dock icon, kept across boots unless another live instance wears it; tell the person which color to look for. Reusing an instance with a different purpose is refused until it is stopped.

A booted instance never comes on screen, since a window put up can land on another Space and take the person's focus. It renders, takes input and answers pictures off screen, in-app browser pages included, so never raise it (`osascript … frontmost`); the person takes one over from its Dock icon. `--visible` puts it up without focus, for a run that needs real pixels (`screencapture -l`), and marks it as a person's: Checkout and the billing portal open in the system browser and replies post notifications, both held back off screen.

Every command after `boot` takes the same `--workspace`, `--clean-room`, `--scenario` or `--as`, which pick the port and the instance record; a flag it does not know is refused. When another session in the checkout already runs the instance you want, boot your own with `--as <name>` (the refusal names one). The port comes from the checkout, never 48160, which is almost always a person's window; `--port` targets one on purpose. `stop` returns once the port is free. `status` lists the checkout's instances.

Several checkouts can run Studio at once: dev skips the single-instance lock, and the servers an instance binds fall back past the ports another one holds. Boot through `studio-drive.mjs` rather than `pnpm dev`, so a checkout that already has an instance reuses it and the CDP port comes from the checkout path instead of a guess. Plain boots all share one dev userData dir, so two of them are two writers of one set of preferences and one workspace; `--workspace <fixture>` (below) gets a disposable one.

`boot` returns once `window.__studioDrive` (`client/lib/studio-drive.ts`, in a development run and a preview build) is up and the restored window has settled. It holds main and preload at the bytes it started with, so another agent's edit under `electron-main/` or `packages/` does not relaunch it, and neither does yours: stop and boot again, or boot with `--hot`. Renderer HMR stays on, and a write HMR cannot apply reloads the page and takes the run's state with it; the next command says so on stderr (`the app reloaded since the last command`). Believe it, and take the reading again. A command that arrives mid-restart waits for the app; "Nothing is running for this checkout" means the instance is gone. `boot` clears `ELECTRON_RUN_AS_NODE`, which some editors set and which makes Electron exit as plain Node, and `modal` with no name lists the openers the running app has.

A plain `boot` uses the shared dev application-data directory, so what a run can reach depends on what that machine did last. `--workspace <fixture>` boots against a disposable one built from a committed description:

```bash
node $DRIVE boot --purpose "document viewer" --workspace documents
node $DRIVE goto /chats/red-and-blue-squares --workspace documents
```

It seeds when the fixture or the seeder is absent or has changed (`--fresh` forces a rebuild), and a boot that would reuse a running instance refuses when its seed is out of date, or when what answers on its port is not this checkout's app. It starts each boot with no tabs or tab groups restored from earlier runs (`--keep-tabs` keeps them), points the fixture's output folder at `<fixture>-output` beside it (`INSTRUMENT_OUTPUT_FOLDER`) and its chats' work folders and granted folders at `<fixture>-home` (`INSTRUMENT_DATA_HOME`), so its agents never write into the developer's real `~/Instrument Dev` or `~/.instrument-dev/work`, and reports what it seeded: each chat by its id, which is its fixture key, and each task by its session in its chat's store (a task's page is `/tasks/<session>?chat=<chat-id>`), so a script addresses a chat by name instead of grepping for one. `--workspace` belongs on every command of the run: it picks the port and the instance record, so a fixture run and a plain dev run can both be up. `pnpm workspace:seed --list` shows what exists; `fixtures/workspaces/README.md` covers adding one.

`--clean-room <name>` is the other kind of isolation: a blank workspace with no chats, opened by a second process on the developer's own application data and pinned to it with `INSTRUMENT_WORKSPACE`, so the developer's instance keeps its own workspace. It shares the machine's toolchain and caches, so it boots as fast as a plain run, and `--with-sign-ins` copies the developer's Instrument account and API keys into it (not a ChatGPT account, whose rotating refresh token would sign the developer's own instance out), so it can run a real agent turn, which a fixture cannot. `--with-sign-ins` works on a fixture too (`--workspace documents --with-sign-ins`), for seeded chats and a real turn in one instance, and it copies the sign-ins again on every boot. Either way the launch chooses a model the way signing in does, and since the session is the developer's own, Sign out there forgets the copy without ending it. A fixture or scenario talks to the API server the developer's own instance is set to (Settings › Developer), unless `--account` names one. An instance on the developer's application data (a clean room, or a plain boot) keeps its crash and hang diagnostics in a folder of its own, so the bell shows only its own crashes. Like `--workspace`, it goes on every command and starts each boot with no tabs or tab groups from earlier runs (`--keep-tabs` keeps them), and its chats' work folders go in `<name>-home` beside it (`INSTRUMENT_DATA_HOME`). Clean rooms live beside the fixture caches, are reaped after 3 days unbooted, and `--fresh` empties one first. A checkout's caches go with it: the next boot from any checkout drops those of a checkout that no longer exists.

```bash
node $DRIVE boot --purpose "first chat" --clean-room first-chat --with-sign-ins
node $DRIVE rpc workspaces.current '{}' --clean-room first-chat
```

To show a real chat in a clean room, copy its records into the clean room's `.instrument/chats/<chat id>/` before booting: an eval run's `record/` folder from `eval-results.local`, or the `chat/` folder `reports files <id>` downloads. The id is the `chat` field on the session log's first line. A report's records show redacted inputs as `<N chars>`.

`--account <file>` on `boot` signs a fixture, a clean room or a scenario in as a given Instrument account and points that instance at the account's API, so a run can start as an account in a particular state instead of signing in and working up to it. The file is JSON with the API's address (`api`) and a session token on it (`token`); the platform's own tooling writes them, and how is documented there. It replaces whatever session the workspace held, and an instance already running signed in as someone else is refused rather than reused, since the API it talks to is fixed when it boots.

```bash
node $DRIVE boot --purpose "near limit" --workspace documents --account ~/.instrument/accounts/scenario-near-limit-4fa6.json
```

Fixtures and clean rooms set `SKIP_ONBOARDING`, so they open on the app window whatever setup would say, and pin their workspace with `INSTRUMENT_WORKSPACE`, which a run that skips setup has to name. `--scenario <name>` is for the states setup reads: it builds application data of its own from `fixtures/scenarios/<name>.yaml` (a workspace, where the folder is, sentinel sign-ins, setup's record, and the notification and network status a development build takes from the environment), rebuilds it on every boot, and leaves setup to decide. Like `--workspace`, it goes on every command. Read where setup landed from its state rather than the screen: `setup.live.state` is a live route, so take its first value in an `eval`, as below. `setup.answer`, `setup.finish` and `setup.dev.reset` go through `rpc`. `fixtures/scenarios/README.md` lists the scenarios and the file's keys; the App states debug page's "Run setup again" forgets the record in any instance.

```bash
node $DRIVE boot --purpose "setup" --scenario beta-tester
node $DRIVE eval '(async () => { const it = await window.__studioDebug.rpc("setup.live.state"); const { value } = await it.next(); await it.return?.(); return value; })()' --scenario beta-tester
```

An instance started from a terminal answers to the terminal's macOS privacy grants, so it usually has Full Disk Access and never sees a protected folder refuse it or ask. `boot --own-privacy` (macOS) starts Electron through a launcher that makes it responsible for its own grants, so Documents asks on first read and a Full Disk Access folder (`~/Library/Mail`) comes back refused, the way an installed app's would. Electron stays in the instance's process group, so `stop` ends it like any other. The grants belong to the instance's dev Electron clone, not a signed build: each clone has its own bundle identifier, `com.github.Electron.<checkout folder>.<instance name>` (`devBundleId` in `apps/studio/scripts/dev-supervisor.ts`), and they outlive the instance: an answer given to a prompt holds for every later `--own-privacy` run of that checkout and purpose until `tccutil reset All <that identifier>` clears it. Reading a protected folder from one opens a system prompt on the developer's screen, so say so before a run that will.

Launching an installed or locally packaged build's window from a shell asks for the login keychain password for the installed app's `Instrument Safe Storage` item, on the person's screen, and its CDP port accepts connections but never answers until someone does. Say so before such a launch. `ELECTRON_RUN_AS_NODE=1` runs do not touch the keychain, and `gh workflow run smoke-test.yml --ref <branch>` checks a packaged launch on all three systems.

Reach for a fixture when the run needs known content, a clean room when it needs an empty workspace that can talk to a model, and `ELECTRON_USER_DATA_DIR=<empty dir>` when it needs a first launch on a fresh machine. Never switch the developer's instance (`workspaces.switch`) to get isolation: that restarts the window they are using.

## A module: `run` with `app`

A file that default-exports `async (app, args) => …` gets `scripts/studio-app.mjs`'s app over the same held connection: `rpc`, `eval`, `waitFor`, `waitForIdle`, `snapshot`, `shot`, `cdp` (anything CDP can do, with `cdp.on` for events) and the words at `app.words`. The helper scripts below are written that way. The result carries every step's trace, and a failure keeps the steps before it. A write under `src/client` that HMR cannot apply reloads the window, which stops the run at that step; `--allow-reload` lets a run that expects one carry on.

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

- It is gated on the **Developer Mode** preference, checked per call. Fixture workspaces pin it on, and every boot writes it back, so a run that turned it off gets it again by booting; the shared dev workspace depends on what was last set in Settings > General, and the bridge cannot turn it on for you. Turning it off from a run shuts the bridge for the rest of that run: typing `!dev` in the command menu turns it back on.
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

`message.create` with `sessionId` instead of `newSessionId` sends a follow-up into the same session. Tasks the chat starts show up in `chats.tasks`; read one's transcript with `message.list` and its session. A seeded fixture workspace holds no credentials unless booted with `--with-sign-ins`.

### Waiting for a turn

`wait --idle` polls the chat's routes until nothing in it is at work, which is the signal the app itself uses. Without `--chat` it takes the chat or task the active tab is showing.

```bash
node $DRIVE wait --idle --chat <chat-id>                       # blocks for the turn, default timeout 10m
node $DRIVE wait --idle --chat <chat-id> --task <session-id>   # one task in it
```

Two things about that status are worth knowing before trusting a wait built on it by hand:

- A chat is busy while `chats.byId` reports `working: true`: its own turn is under way, a task it started is moving, or a wake is on its way to start a turn. Read `working`, not `status`, which says `waiting` over work while a card waits on the person. A task is busy while its `chats.tasks` row is `stoppable`, meaning its session carries the `agent.alive` tag, which every non-final state of the session machine does. A turn that is over reports not working rather than `agent.done`, because the workspace machine drops the ref when the session finishes.
- Which makes "not working" also what a chat or task reports _before_ its turn starts. `wait --idle` covers that by requiring idle to hold for `--settle` (2s) until it has seen it busy, and reports `sawBusy` so you can tell which happened. `sawBusy: false` on a wait that was meant to follow a prompt means the prompt never started an agent.

## Page model

An app window is one web contents: its chrome and every open tab mount in the same page, each tab a router of its own across the bar. There can be several, each a page of its own (`docs/architecture/windows.md`): `rpc window.openNew '{}'` opens one, and `--page window:<n>` drives the nth, counted as the debug endpoint lists them, newest first; with no `--page` a command drives the first listed. Agent-browser tabs are renderer `<webview>` guests inside it, not separate DevTools targets. The onboarding window, on a first run, is a second page under `/renderer/`; commands drive the app window's unless given `--page onboarding`. A first launch of a packaged build opens there, so that is how its sign-in and welcome steps are driven. A launch that refuses its workspace (one made by a newer build, or a folder it cannot read) opens only a window of its own, a `data:` page with no `__studioDrive` behind it: `boot` returns once it is up, with `refusal: true`, and `--page refusal` drives it (`shot`, `snapshot`, `click --text`).

The renderer keeps the current route out of the window URL, and the window restores its persisted tabs on load. So `location.hash` is not the route, and navigating the web contents to a route URL does not open it. Use `state` to read where you are and `goto` to move: `goto` sends the tab up to the route, or a new tab in the group up with `--new-tab`, and `state` reports the tab up's `path`, the `tabs`, and `dialog`. A path no route matches fails with the routes there are, rather than opening a "Page not found" screen. A script that names addresses imports them from `apps/studio/scripts/drive-routes.ts` (`chatHref(id)`, `filesHref({ path: "", root: "~" })`), whose paths are typed against the route tree: a renamed route is a type error there (studio's `check:types`), and a name it no longer exports fails as the script loads. Add an address there rather than writing a path into a script. A chat's own tabs (its browsers and files down its rail) are not routes; read them with `snapshot` or `eval`.

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

`perf-tab-groups` builds a window of five groups and eighteen tabs (Files, a chat and its task, the browser and a page, the app's own screens, an empty group up front), then counts commits, fibers, the components behind them and RPC per procedure over an idle, every group switch and every tab switch, with median, low and high per kind. It opens screens by plain `goto`, which files each into the group up, so the window has one window tab as a person's does. `skip` leaves screens out for an A/B.

```bash
node $DRIVE run $(dirname $DRIVE)/perf-tab-groups.mjs --allow-reload --quiet --workspace documents
```

`hidden-tabs-quiet` checks that tabs behind the one up go quiet, since a tab stays mounted while another is up and whatever it polls keeps going unseen. It opens one tab per kind of screen in the group up (Files at a folder, with a file open, Recents and This Computer; the browser's start and a page; Apps and an app's page; the chat list, a chat and a task; Extensions, release notes, a new tab), puts a fresh new tab in front, and counts every RPC frame per procedure over an idle (`idleSeconds`, 30). A `requests` entry is a hidden screen polling or re-reading: it fails the run (`quiet: false`, exit 1), and `alsoInBaseline` marks one that also went out from the shell before those screens were opened. `inbound` lists live streams that pushed, which should be only for a real change (a hidden page's guest put to sleep pushes `browser.live.targets` once). Tabs restored by its reload pile up across runs in one instance, so boot again for a count of only its own.

```bash
node $DRIVE run $(dirname $DRIVE)/hidden-tabs-quiet.mjs --allow-reload --quiet --workspace documents
```

## Measuring the main thread

Typing and pasting wait on the main process's thread twice: once for the key to reach the page and once for the paste's clipboard read. So input lag is a main-thread question, and the renderer's own timestamps cannot see it (`KeyboardEvent.timeStamp` is when the renderer got the event). Boot with the main process's inspector open and sample it:

```bash
node $DRIVE boot --purpose "main stalls" --inspect 9339
node $(dirname $DRIVE)/main-stalls.mjs --port 9339 --seconds 15
node $(dirname $DRIVE)/main-stalls.mjs --port 9339 --seconds 15 --profile main.cpuprofile
```

It drives nothing, so it is safe while someone is at the machine. Read `stallsOver.60` first: a paste-based dictation tool that restores the clipboard after 60 ms loses text on any stall past about 40 ms. A quiet main thread has none over 30 ms. `--profile` writes a CPU profile of the same window for DevTools' Performance panel, which names what held the thread.

A packaged build refuses `--inspect` (a fuse), and `NODE_OPTIONS=--cpu-prof` writes nothing. Profile its launch with Chromium's own tracing instead: `--trace-startup=devtools.timeline,v8,v8.execute,disabled-by-default-v8.cpu_profiler,toplevel --trace-startup-file=<file> --trace-startup-duration=10`, whose CPU samples cover main's JS too, named but without script URLs. The file is Perfetto protobuf unless `--trace-startup-format=json`; read it with `uv run --with perfetto python` and `TraceProcessor`.

To measure at a real workspace's scale, boot against a copy of it. `cp -cR` makes an instant copy-on-write clone of an Application Support `workspace` folder into a directory of your own, and `boot` hands its environment to the app, so `ELECTRON_USER_DATA_DIR=<that directory> INSTRUMENT_WORKSPACE=<that directory>/workspace SKIP_ONBOARDING=true node $DRIVE boot …` opens the copy (a run that skips setup names its workspace, or the app refuses to start). A copy has no provider credentials, so it measures the app, not a model turn.

## States a dev build otherwise cannot reach

Both have a control on the App states debug page (`/debug/app-states`):

- **Just updated** — the toast only fires when the app launches on a newer version than the last launch. The item queues the bump and reloads, the path a real update takes. It auto-dismisses in a few seconds, so capture promptly.
- **Quit prompt** — dev builds skip the running-agent quit prompt so hot reload is never blocked on a dialog nobody sees. In memory only, so a relaunch clears it; while on, a main-process rebuild waits on the dialog.

The quit prompt is a native `showMessageBox`, outside the web contents. CDP cannot capture it.

Dictation needs a microphone, and a real one raises the system's permission prompt in front of whoever is at the machine. Boot with `FAKE_MICROPHONE=true node $DRIVE boot …` and the app records Chromium's test tone instead, with access reported as granted. To dictate real words, set it to the path of a WAV file instead (`FAKE_MICROPHONE=/path/speech.wav`), which the fake device plays on a loop; `say -o speech.wav --data-format=LEI16@16000 "…"` makes one. Main reads it at launch, so it takes a fresh boot.

Offline is two states. A scenario's `network` (`INSTRUMENT_NETWORK_STATUS`) moves only main's status; to take the page offline too, send `Network.emulateNetworkConditions` with `offline: true` from a `run` script, which fires the page's `offline` event and pauses remote queries while main's own requests still go through. A dead API is `INSTRUMENT_PLATFORM_API=http://localhost:<unused port>` on `boot`, which wins over the API server set in Settings (a plain boot otherwise talks to whatever the developer picked there).

## Traps

The words handle these, so they matter for a module or a single command:

- `element.click()` from an evaluated script misses handlers on an ancestor and every Radix menu, popover and select (they open on `pointerdown`), and returns normally either way. Use real input.
- Keys sent over CDP never reach `before-input-event` or the menu bar, so Cmd+T, Cmd+W and the other main-process chords do nothing that way. `press` sends them through the window (`webContents.sendInputEvent`) and falls back to the menu item the chord belongs to.
- Mouse events sent to the app's page do not reach a `<webview>` guest; `page()` drives the guest on its own CDP target.
- A native menu or dialog (a context menu, the folder picker, a message box) is held in main for a driven instance, and `menu(…)` and `dialog` answer it.
- A side with one tab draws no tab strip, so `tab(name)` finds nothing there; `tab()` still means the tab up.
- `use-stick-to-bottom` releases auto-follow on `wheel`, so assigning `scrollTop` is overridden immediately.
- After a main-process edit, stop and boot again: a booted instance keeps main at the bytes it started with (`--hot` for one that should reload).

## Checking the words

`node scripts/drive/suite.mjs` boots an instance of its own off screen on the documents fixture, runs one check per word family against it with a minute's cap each, prints a line per check and stops it (`--only <name>`, `--keep`). Run it after changing `words.mjs` or a name the app gives a control. `node --test scripts/drive/*.test.mjs` covers the pure parts and checks the list above against the code.

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
