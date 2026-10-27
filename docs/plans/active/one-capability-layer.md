# One capability layer

Status: **phase 0 done** (baseline evals on one model, below); the owner's answers are in Decisions; phases 1 to 3 not started.

## Problem

What the agent can do is defined once per surface rather than once per capability, so every surface reaches a different subset, and each new way of reaching them (a script runtime, a model tool, a future command line) is written again.

- **Scripts reach almost nothing.** A `node` script's `tools` global ([`node-tools-preload.ts`](../../../packages/workspace/src/lib/node-tools-preload.ts), wired in [`shell-commands/node.ts`](../../../packages/workspace/src/lib/shell-commands/node.ts)) answers through `appToolHook` → `invokeAppTool` ([`app-tool-hook.ts`](../../../packages/workspace/src/lib/app-tool-hook.ts), [`shell-commands/app.ts`](../../../packages/workspace/src/lib/shell-commands/app.ts)), which is `instrument app call` and nothing else: MCP app tools only. API apps (every Google app, since they moved to Google's REST APIs) go through `instrument app request`, which the channel cannot reach. `invokeAppTool` takes no chat or session, and `request` needs the session to know whether the app's guide is in the context window (`guideInWindow`), which is why it was never wired.
- **Python reaches nothing.** [`shell-commands/python.ts`](../../../packages/workspace/src/lib/shell-commands/python.ts) runs the interpreter with the managed base packages ([`python-base.ts`](../../../packages/workspace/src/lib/python-base.ts), by a `.pth` in a virtualenv or `PYTHONPATH` on the bare managed Python) and opens no channel.
- **Scripts reach for the shell and fail.** In a real transcript a Python script ran `subprocess.run(["instrument", ...])`. `instrument` is a just-bash command ([`shell-commands/instrument.ts`](../../../packages/workspace/src/lib/shell-commands/instrument.ts)), not a program, so a process the shell starts finds nothing by that name.
- **Every `instrument` subcommand renders its own way.** Most parse argv through the shared [`subcommands.ts`](../../../packages/workspace/src/lib/shell-commands/subcommands.ts) (flag names only, no types); `calendar` and `contacts` pass argv straight to the Swift helper, which parses it itself. Output is per command: `calendar` always prints JSON, `mail` and `notes` print JSON lines for lists and text otherwise, `x` prints text with `--json` for data, `app request` puts the body on stdout and the status on stderr, `app call` prints the tool's text.
- **Model tools are a third definition style.** [`tools/create-tool.ts`](../../../packages/workspace/src/tools/create-tool.ts) (`setupTool`, Zod in and out, `toModelOutput`) has the schemas a script module would want, and none of it is reachable from a script: `web_fetch` and `web_search` inside a fan-out are a turn each.

The owner's direction: define each capability once, in a structured way, and generate every mechanism the agent reaches it by, rather than keeping unique behaviors per environment. Breaking changes are allowed.

## Inventory: what the agent reaches today

"Both" means the chat's session and its tasks. The model tool list is the same in both (the fork reuses the chat's cached prefix, [`agents/instrument.ts`](../../../packages/workspace/src/agents/instrument.ts)); a chat-only tool refuses at execute time. A task's `instrument` lists the chat-only words and refuses them with a note (`CHAT_ONLY_SUBCOMMANDS` in [`create-bash-env.ts`](../../../packages/workspace/src/lib/create-bash-env.ts)).

| Capability | Shell (`instrument …` unless noted) | Model tool | Node `tools` | Python | Chat / task | Gate |
| --- | --- | --- | --- | --- | --- | --- |
| MCP app tools | `app tools`, `app tool`, `app call [--out]` | no | `tools.<slug>.<tool>()` | no | both | app connected on its tested manifest, credential present; workspace-wide, no per-chat gate |
| API app requests | `app request <slug> <METHOD> <path> [--param]` | no | **no** | no | both | as above, plus the guide handed back instead of the first request in a session |
| App setup | `app catalog`, `new`, `test`, `list`, `guide`, `icon`, `account`, `disconnect` | `connect_app` | no | no | both; `connect_app` chat only (a task is told to end with a needs fence) | sign-in or key on the connect card |
| Web apps | refused by `app call`/`request`; worked in a tab | no | no | no | both | sign-in in the window's browser |
| Calendar, Reminders | `calendar events`, `reminders`, `calendars`, `lists`, `add-event`, `add-reminder` (macOS, helper builds) | no | no | no | both | per-chat app grant (`appRefusal` → `ask_permission`), then macOS privacy (`macosAppCard`, exit 2 and a card) |
| Contacts | `contacts [--search] [--limit]` | no | no | no | both | same |
| Mail | `mail accounts`, `mailboxes`, `list`, `search`, `read`, `draft`, `send`, `move` (macOS, AppleScript) | no | no | no | both | per-chat app grant, then macOS Automation |
| Notes | `notes folders`, `list`, `search`, `read`, `create`, `append` | no | no | no | both | same |
| Messages | `messages send` | no | no | no | both | same |
| Shortcuts | `/usr/bin/shortcuts` as a real program | no | no | no | both | `path-program.ts` asks by the app's grant; Seatbelt closes its services until granted |
| Memory | `memory list`, `save`, `show`, `forget` | no | no | no | chat only | none |
| Tabs | `tab list`, `open`, `replace`, `close`, `show`, `read`, `request` | no | no | no | chat only | `tab request` raises a card |
| Tasks | `task new`, `send`, `stop`, `list`, `log` | no | no | no | chat only | none |
| X posts | `x search`, `x thread [--json]` | no | no | no | both | Grok account |
| Browser | `agent-browser` (wraps a real program) | no | no | no | both, own tabs | browser allowlist |
| Background jobs | `jobs`, `fg`, `kill` | no | no | no | both | own jobs only |
| Web | `curl` | `web_fetch`, `web_search` | no | no | both | none |
| Files | builtins and native programs | `read_file`, `write_file`, `edit_file` | (the script's own fs) | (same) | both | Permissions rules; `ask_permission` for a folder |
| Images | | `generate_image` | no | no | both | account |
| Skills | | `load_skill` | no | no | both | none |
| Questions, asks | | `choose` (chat only), `ask_permission` (both) | no | no | | ends the turn |

Two facts from the inventory shape the design:

- **Every gate already lives in code our handler runs before the work** (`appRefusal`, `macosAppCard`, `requireApp`, `guideInWindow`, the chat-role check). None of it depends on the surface, so it can move under one definition.
- **The turn-ending interactions are model tools on purpose** (`ask_permission`, `connect_app`, `choose`): they end the turn mechanically, which a command can only do through the raised-asks path ([`raised-asks.ts`](../../../packages/workspace/src/lib/shell-commands/raised-asks.ts)). They stay model tools.

## Decisions

The owner settled these; the design below follows them.

- **One name: `instrument`.** The CLI, the Node global and the Python module are all `instrument`. The `tools` global is deleted, and no compatibility name keeps it.
- **One generated CLI form for every app, and no hand-written subcommands.** Every capability flows through the registry and its one gate, so there is never a second way to do the same powerful thing that skips the permission path. The Mac apps' tools are `instrument app call apple-calendar add_event --title …` like any app's; nothing keeps `instrument calendar` as an alias. The rest of `instrument` (`memory`, `task`, `tab`, `x`) is generated from the registry too.
- **Sends are script-callable.** Once the person granted Mail or Messages, a script sending is no worse than a bash loop sending, which the shell already allows. If sends need more protection later, it is a review of each call or each script in the shape of [auto mode](auto-mode.md), and it attaches at the registry's single gate, which every surface passes through.
- **Scripts keep the guide check.** A script's first request to an API app throws `ReadGuideFirst` with the guide, as the CLI hands it back today, and the `app` and `node`/`python` descriptions say to read an app's guide before scripting it.
- **A preflight ask is built only if an eval shows it helps** (phase 1).
- **Python is synchronous first**, with calls safe from threads for fan-out.
- **The Mac apps move into the Apps area like every other app.** Longer term, computer use on every OS goes through Apps too (see [Computer use](#computer-use)).
- **Connecting a Mac app covers every chat**, as connecting any other app does. Calendar, Mail, Messages and the rest stop asking in each chat once the person connects them in Apps; Settings › Permissions can still mark one Not allowed, and macOS keeps its own prompt. Per-chat access may come later as an opt-in setting, and it would apply to apps in general rather than to Mac apps alone.

## Proposed shape

### The registry

One definition per capability, in a new `packages/workspace/src/lib/capabilities/`:

```ts
export interface Capability<In extends z.ZodType, Out extends z.ZodType> {
  /** Dotted, snake_case: `apps.request`, `apps.apple-calendar.add_event`, `memory.save`. */
  name: string;
  /** One line, for `instrument help`, `help(instrument)` and a tool description. */
  summary: string;
  input: In;
  output: Out;
  /** Which generated surfaces carry it. */
  surfaces: { cli?: CliSpec; script?: true; tool?: ToolSpec };
  /** Where it exists: the platforms, the shells, and a build check. */
  where?: {
    available?: () => boolean;
    platforms?: NodeJS.Platform[];
    roles?: ("chat" | "task")[];
  };
  /** Decides before the work runs; the same answer on every surface. */
  gate?: (input: z.output<In>, ctx: CapabilityContext) => Promise<Gate>;
  run: (input: z.output<In>, ctx: CapabilityContext) => Promise<z.output<Out>>;
  /** How a result reads as text where a person or the model reads it. */
  text: (output: z.output<Out>) => string;
}

/** What a call runs under, captured when the shell or channel opens, never sent by the caller. */
interface CapabilityContext {
  asker: Asker; // chat, session, the bash call's part
  model?: string;
  raised: (askId: string) => void; // the bash call's raised asks
  role: "chat" | "task";
  signal: AbortSignal;
  surface: "cli" | "script" | "tool";
}

type Gate =
  | { kind: "allowed" }
  | { kind: "refused"; message: string } // final for this chat: Not allowed, "not now"
  | { kind: "ask"; ask: { kind: "app" | "folder"; target: string }; message: string } // the agent asks with ask_permission
  | { kind: "card"; askId: string; message: string } // a card is already up (macOS); the turn ends
  | { kind: "read-first"; text: string }; // the app's guide, before the first request
```

Every gate in use today is one of those five outcomes: `appRefusal` is `refused` or `ask`, `macosAppCard` is `card`, `guideInWindow` is `read-first`, a missing connection or credential is `refused` with what to do. Errors from `run` are failures (`InstrumentError`), apart from gates.

The dispatcher runs the gate for every call on every surface, so it is the one place a later check attaches: an auto-mode review of a send, a rate limit, an audit line. It sees the capability, its parsed input and the surface, and for a script call the script's path, so a review can read what the script is about to do.

Apps come in two shapes in the registry:

- **Built-in apps** (the Mac apps) register their tools as capabilities with Zod schemas: `apps.apple-calendar.add_event`. The CLI gets real flags for them.
- **Workspace apps** whose schemas come from the service are two open capabilities: `apps.call { app, tool, args }` for an MCP app's tools (schemas from `apps.tools`) and `apps.request { app, method, path, params, body }` for an API app. The surfaces generate per-app sugar over them.

### Generated surfaces

| Surface | Generated from | Shape |
| --- | --- | --- |
| `instrument` CLI | `input` → flags (snake_case field → `--kebab-case`; arrays repeat; objects and free JSON as a trailing JSON argument or stdin) | `instrument app call <slug> <tool>` for every app's tools, flags where the registry has the schema and JSON where the service does; `instrument app request <slug> …`; `instrument <namespace> <verb>` for the rest. Human text from `text` by default; JSON of `output` with `--json`, or when stdout is the next pipeline stage (just-bash sets `offerPipeHandoff` then). `--help` from `summary` and the schema's `.meta({ description })`. Exit 0, 1 failure, 2 a card is up. |
| Script module, Node | registry list for this process | The `instrument` global (non-enumerable, writable, configurable, as the preload defines `tools` today): `await instrument.apps["apple-calendar"].addEvent({ title, start })`, `instrument.apps.request("google-drive", "POST", "/files", { body })`, `instrument.apps["google-drive"].post("/files", { body })`, `instrument.apps.beacon.listIssues({ state: "open" })`. Returns the parsed `output`; throws `InstrumentError` subclasses. |
| Script module, Python | the same list | `import instrument`: `instrument.app("apple-calendar").add_event(title=..., start=...)`, `instrument.app("google-drive").post("/files", body={...})`, keyword-only arguments, dicts and lists back, exceptions `instrument.Error`, `instrument.NeedsPermission`, `instrument.CardShown`, `instrument.ReadGuideFirst`. Synchronous; calls are safe from threads, so `ThreadPoolExecutor` fans out. |
| Model tool | `surfaces.tool` only | `setupTool` built from the same schemas and `text` as `toModelOutput`. Used only where a capability has to be a tool: the turn-enders, and the existing file, web and image tools as they migrate. Nothing per-platform becomes a tool, since the tool list is the cached prefix and is the same on every computer. |

Names stay one spelling per capability: snake_case in the registry, in Python and for tool words on the CLI (as MCP tools are already named), kebab-case flags, camelCase in JS. JS converts the keys the registry declares, never keys inside a pass-through payload (an API body, an MCP result), which reach the script as the service sent them.

Discovery is generated too: `instrument help` lists namespaces for this shell, `instrument app tools apple-calendar` and `instrument app call apple-calendar add_event --help` print the schema, `help(instrument.app("apple-calendar").add_event)` shows a real signature (built with `inspect.Signature` from the JSON Schema the channel sends at connect), and `instrument.describe("apps.apple-calendar.add_event")` works in both runtimes.

### The channel

The loopback channel in `node-tools-preload.ts` stays: `127.0.0.1`, a 32-byte token in an environment variable, one listener per native process, opened by the command that starts it ([`pipe-stage.ts`](../../../packages/workspace/src/lib/shell-commands/pipe-stage.ts) already takes a `toolsChannel` option, so `python` gets it the same way). What changes:

- The line protocol carries `{ id, capability, args }` rather than a dotted tool path, plus one `describe` request at connect that answers the capabilities and JSON Schemas this process may call.
- The answer function is the registry's dispatcher, given the `CapabilityContext` of the bash call when the channel opens. The asker and the raised-asks collector are passed explicitly rather than read from `AsyncLocalStorage`, since a socket callback and the bash worker's main-thread hop ([`bash-worker/client.ts`](../../../packages/workspace/src/lib/bash-worker/client.ts)) do not reliably carry it.
- A reply carries `{ error: { kind, message, ask? } }` so each runtime raises the right exception class.

### Example: `apps.request` and Calendar's `add_event`, defined once

```ts
export const appsRequest = defineCapability({
  name: "apps.request",
  summary: "One request through a connected API app, the path relative to its base.",
  input: z.object({
    app: AppSlugSchema,
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    path: z.string().min(1),
    params: z.record(z.string(), z.string()).default({}),
    body: z.json().optional(),
  }),
  output: z.object({
    status: z.number(),
    url: z.string(),
    content_type: z.string().optional(),
    body: z.json(), // parsed JSON where the service sent JSON, else the text
    truncated: z.boolean(),
  }),
  surfaces: {
    cli: { words: ["app", "request"], positional: ["app", "method", "path"], stdin: "body" },
    script: true,
  },
  gate: async ({ app }, ctx) => apiAppGate(app, ctx), // connected, API kind, guide in window
  run: async (input, ctx) => performApiRequest(input, ctx), // today's runRequest body, returning data
  text: (out) => renderBody(out), // status line to stderr, body to stdout, as today
});

export const calendarAddEvent = defineAppTool({
  app: "apple-calendar", // a built-in app: its folder, its Apps tile, its guide
  tool: "add_event",
  summary: "Add an event to Calendar on this Mac.",
  input: z.object({
    title: z.string().min(1),
    start: LocalDateTime, // today, tomorrow, 2026-10-06, 2026-10-06T14:30
    end: LocalDateTime.optional(),
    calendar: z.string().optional(),
    account: z.string().optional(),
    location: z.string().optional(),
    notes: z.string().optional(),
  }),
  output: CalendarEventSchema, // the helper's JSON, parsed before it is trusted
  surfaces: { cli: true, script: true },
  where: { available: () => getWorkspaceConfig().macHelperBinPath !== undefined, platforms: ["darwin"] },
  gate: macAppGate(CALENDAR_APP), // connected in Apps, not marked Not allowed in Settings, then macosAppCard
  run: (input, ctx) => runMacHelper(["add-event", ...helperArgs(input)], CalendarEventSchema, ctx),
  text: (event) => `Added "${event.title}" to ${event.calendar} at ${event.start}.`,
});
```

The same two capabilities on each surface:

```bash
instrument app request google-drive POST /files <<'EOF'
{"name": "Q4 plan", "mimeType": "application/vnd.google-apps.document"}
EOF
instrument app call apple-calendar add_event --title 'Q4 review' --start 2026-10-29T14:00 --end 2026-10-29T15:00
instrument app call apple-calendar add_event --title 'Q4 review' --start 2026-10-29T14:00 --json | jq -r .id
```

```js
const doc = await instrument.apps.request("google-drive", "POST", "/files", {
  body: { name: "Q4 plan", mimeType: "application/vnd.google-apps.document" },
});
await instrument.apps["google-docs"].post(`/documents/${doc.body.id}:batchUpdate`, { body: { requests } });
await instrument.apps["apple-calendar"].addEvent({ title: "Q4 review", start: "2026-10-29T14:00" });
```

```python
import instrument

drive = instrument.app("google-drive")
doc = drive.post("/files", body={"name": "Q4 plan", "mimeType": "application/vnd.google-apps.document"})
instrument.app("google-docs").post(f"/documents/{doc['body']['id']}:batchUpdate", body={"requests": requests})
try:
    instrument.app("apple-calendar").add_event(title="Q4 review", start="2026-10-29T14:00")
except instrument.NeedsPermission as asked:
    print(asked)  # "using Calendar needs the person's yes. Ask for Calendar with ask_permission."
```

## Cards and the security boundary

### A call that needs the person

A script call never blocks waiting on a card. Blocking would hold a process, and with it the bash call, open for as long as the person takes, past `yieldMs` into a background job whose result nobody reads, and the agent could not say what it is waiting for. So each gate outcome throws:

| Gate | CLI | Script | Turn |
| --- | --- | --- | --- |
| `refused` | exit 1 with the message | `instrument.Error` (`kind: "refused"`) | continues; the agent reports what it skipped |
| `ask` | exit 1, "ask for X with `ask_permission`" | `NeedsPermission`, carrying `ask` | continues until the agent calls `ask_permission`, which ends it. Matches [explicit-permission-asks.md](explicit-permission-asks.md): running into a gate raises no card |
| `card` (macOS's own answer) | exit 2 | `CardShown` | ends after the bash call returns, through the raised asks, as a command's card does today, whatever the script did after catching it |
| `read-first` | the guide on stdout, exit 0 (today's hand-off) | `ReadGuideFirst`, whose message is the guide, recorded as the hand-off so the next run passes | continues; the agent reruns with the guide in context |

A script that catches one exception keeps the rest of its work, so a fan-out that reaches one closed app still writes everything else. A second call to the same gated app in one script joins the open card (`recordAsk` already keeps one per thing) and throws again without raising another.

### What a token opens

- **Exactly what the shell's own `instrument` opens in that bash call.** The context is the bash call's (chat, session, role, part); the script never names a chat or a session. A task's script cannot call `task.*`, `tab.*` or `memory.*`, because the dispatcher checks `where.roles` against the captured role.
- **Only capabilities marked `script`.** App setup (`apps.new`, `apps.disconnect`) and the turn-enders stay off the script surface. Sends (`apps.apple-mail.send`, `apps.apple-messages.send`) are on it, behind the same gate the CLI passes.
- **One process, one lifetime.** The listener closes when the process exits; the token is per process.
- **Children get nothing.** Node's preload already deletes `INSTRUMENT_TOOLS` before the script runs. Python does the same before user code: from the `.pth` line in a virtualenv (an `import` line in a `.pth` runs at startup) and from a `sitecustomize.py` in the base folder on the bare managed Python's `PYTHONPATH` (a `PYTHONPATH` folder runs no `.pth`). Skill environments ([`skill-environments.ts`](../../../packages/workspace/src/lib/skill-environments.ts)) get the same line. A program that reads the variable before it is deleted could call what the script can, which is the boundary `node` has today and the decision record accepts.

### The `instrument` stub

A small `instrument` program (a `#!/bin/sh` script, `instrument.cmd` on Windows) in the runtime folder's `bin/`, prepended to the PATH that native commands get (`resolveCommandContext` and `uvSubprocessEnv`), never to the shell's own PATH, where the builtin is found first anyway. It prints to stderr and exits 127:

```
instrument: Instrument's commands run in its shell, not from a program. From Python, `import instrument` (instrument.app("google-drive").post(...)); from Node, the `instrument` global. `instrument help` in the shell lists them.
```

That answers the transcript's `subprocess.run(["instrument", ...])` in the words that fix it, and keeps a script's children from reaching anything. A script that captures stderr and ignores the exit code still hides the message, so the evals below score recovery, not only the first attempt.

## The Mac apps move into Apps

**Decided: built-in apps.** All six Mac data apps (Calendar, Reminders, Contacts, Mail, Notes, Messages) become one built-in app kind whose tools are registry capabilities, in the Apps area like every other app. What the code said when this was weighed:

- **They were already apps everywhere except where they work.** The directory lists `apple-calendar`, `apple-mail` and the rest as entries with a `mac-app` interface ([`catalog-seed.json`](../../../packages/workspace/src/lib/apps/catalog-seed.json), `catalogWayIn` in [`way-in.ts`](../../../packages/workspace/src/lib/apps/way-in.ts)), and `app catalog` tells the agent to use `instrument calendar` instead (`nativeCommandFor`, `HELPER_COMMANDS`, `SCRIPTED_COMMANDS` in `app.ts`). Pressing Connect on one in the Apps screen dead-ends: `setUpFromDirectory` ([`set-up.ts`](../../../packages/workspace/src/lib/apps/set-up.ts)) answers `agent` for "a Mac app a task drives", so the window sends a chat message, and no app folder or tile ever appears.
- **One namespace for scripts.** As apps, they are `instrument.apps["apple-calendar"]` beside `instrument.apps["google-calendar"]`, discovered by the same `instrument app tools <slug>`.
- **The description moves out of every prompt.** `computerCommandsText` puts six paragraphs of Mac app usage into every session on a Mac. As apps, each has a guide read when the app is used, like any app.
- **The open piece is small now.** The stale plan's "bundled-binary app kind" was the hard part when it was written; the helper, the entitlements and usage strings, and the gate it needed have since landed as `instrument calendar` and `contacts` ([`mac-helper.ts`](../../../packages/workspace/src/lib/shell-commands/mac-helper.ts), [mac-native-bridge.md](../../architecture/mac-native-bridge.md)). What is left is a manifest type (`type: "mac"`, naming the built-in by id), `setUpFromDirectory` writing its folder, and the Apps screen showing it.

What it costs: the short `instrument calendar` words, and a person who removes the app's folder loses it until they add it again (today it is always there on a Mac). Connecting one covers every chat, as for any app (Decisions).

The stale [mac-reminders-and-calendar-app.md](mac-reminders-and-calendar-app.md) moves to `completed/` when phase 2 lands, its status reading that the EventKit helper landed as commands and the built-in app kind is carried here. Its remaining items (update and delete, write-only access on macOS 14+, recurrence) become follow-up capabilities.

## Computer use

The spike lives on the `spike/computer-use` branch: a `computer` shell command (`packages/workspace/src/lib/shell-commands/computer.ts` there) over an embedded Cua Driver that Studio main runs (`apps/studio/src/electron-main/lib/computer-driver.ts`), behind a feature flag, with its own plan (`docs/plans/active/computer-use.md` on that branch). An earlier `spike/cua-driver` branch is the macOS proof of concept it grew from.

How it limits the agent today: an allowlist of **driver verbs** (`click`, `type_text`, `get_window_state`, `launch_app`, ...; `browser_*`, `kill_app`, the clipboard and driver administration left out), plus the two macOS grants checked in Settings. Nothing limits **which app** a verb acts on: every call names a target by `pid` (and `window_id`), found through `list_apps`, and no check maps that pid to an app the person allowed. It also predates the chat rework (it is keyed by `TaskId`) and runs no per-chat gate (`appRefusal` is not called).

What fits an Apps allowlist:

- Every acting verb already names one process, so a gate can resolve `pid` to the app's bundle id (or its executable on Windows and Linux) and check it against the apps the person connected, the way `appReach` matches a Mac app by name or bundle id today. `launch_app` names its app outright.
- `list_apps` and `list_windows` can be filtered to the allowed apps, so the agent enumerates only what Apps allows.
- As registry capabilities (`computer.click`, ...), every verb passes the one gate, and a review of each call attaches there as for sends.

What would have to change:

- **Desktop-wide verbs** have no single app: `get_desktop_state` and `zoom` capture the whole screen, `get_screen_size`, `move_cursor` and `drag` across windows reach past one app. They either go, or capture only the allowed apps' windows.
- **A pid is not stable consent.** The gate resolves it on every call, since an app can quit and its pid be reused, and a helper process (a browser's renderer, an app's XPC service) has to count as its app.
- **Apps needs an entry for a desktop app** that has no Mac app interface, no service and no folder today: a "desktop app" app kind on every OS, connected by the person in Apps, which is what the computer-use gate checks.

## Phasing

Each phase deletes what it replaces. Every eval run names its models ([workspace-evals](../../../.agents/skills/workspace-evals/SKILL.md)). Each case records bash calls, script calls, model steps, tokens, and correctness assertions.

### Phase 0: baseline, no product code

The cases are [`app-scripting.ts`](../../../packages/workspace/evals/cases/app-scripting.ts) (Beacon, an MCP app a `node` script can call through `tools`) and [`app-scripting-api.ts`](../../../packages/workspace/evals/cases/app-scripting-api.ts): Lantern, the same tracker as an API app; two Python variants that ask for a script; and the errand, Google-like Drive, Docs, Calendar and Gmail stand-ins where three docs are made, edited and read back, an event is added and a draft saved. Run each group on its own, since one run lists every app its cases declare.

**Baseline, Claude Haiku 5.5 through OpenRouter, three trials per case, before any of this plan is built.** Haiku because it is the cheap model most likely to take the shortest path, and the owner approved it for this run. Steps are model steps, tool calls are bash and other tool calls, tokens are the trial's total (mostly cache reads), and cost is the harness's approximate figure summed over the three trials. Steps and tokens are medians, with the steps' range.

| Case | Passed | Steps | Tool calls | Tokens | Cost (3 trials) | How the calls were made |
| --- | --- | --- | --- | --- | --- | --- |
| Beacon fan-out (MCP) | 3/3 | 6 (4-7) | 5 | 185K | $0.017 | a `node` script with `tools` in 3/3; one also ran a bash loop of `app call` |
| Beacon join (MCP) | 3/3 | 5 (5-6) | 4 | 145K | $0.018 | `tools` in 2/3; a bash loop of `app call` in 1/3 |
| Beacon single lookup (MCP) | 3/3 | 4 (4-4) | 3 | 113K | $0.012 | two plain `app call`s, no script, 3/3 |
| Lantern fan-out (API) | 3/3 | 7 (5-10) | 6 | 214K | $0.015 | `app request` only: 4 to 9 requests, 2 to 6 of them in bash loops, pages saved to files and read back; one trial also curled the stand-in directly |
| Lantern join (API) | 3/3 | 5 (4-5) | 4 | 149K | $0.010 | 2 to 4 `app request`s, Python as a JSON helper over saved files in 2/3 |
| Lantern single lookup (API) | 3/3 | 3 (3-3) | 2 | 86K | $0.006 | two or three `app request`s |
| Python fan-out over Lantern | 3/3 | 11 (10-16) | 11 | 361K | $0.028 | every trial wrote a Python script that runs `instrument` with `subprocess`, hit `FileNotFoundError: 'instrument'`, ran `which`/`type`, then fetched with bash `app request` into files for Python to read; one also curled the stand-in |
| Python fan-out over Beacon | 3/3 | 10 (9-11) | 9 | 320K | $0.021 | the same `subprocess` failure in 3/3, then `app call` into files for Python; one switched to a `node` script with `tools` |
| Google errand (4 API apps) | 3/3 | 12 (10-14) | 11 | 420K | $0.027 | `app request` only, 8 to 10 requests, 2 to 5 in bash loops, Python as a JSON helper; 2/3 also tried a Python script calling `instrument` and hit the same failure; one first tried `app call` on the Drive API app |

What the baseline says:

- **Models reach for scripts when a script can reach the app.** With an MCP app, Haiku wrote a `tools` script in 5 of 6 multi-call trials and none of the 3 single lookups, which is what the `node` global was for.
- **With an API app they cannot, so they loop in bash.** Every Lantern and errand trial used `app request` a call at a time, in bash loops, with pages saved to files. They answered correctly, at more steps and tokens than the same questions over MCP (fan-out 7 steps and 214K against 6 and 185K; the errand 12 steps and 420K).
- **Asked for Python, every trial ran `instrument` as a program and failed first**, the transcript's failure reproduced 6 out of 6 times, and cost the most steps of any case (median 10 and 11) while still landing the answer by falling back to bash. That is the stub's and the module's case.
- **The guide hand-off interrupts loops.** A loop of `app request`s over an app whose guide is not yet in the context gets the guide on its first iteration and has to run again, which an errand trial shows. The same holds for a script's first call, which is why the module's prompt line says to read the guide first.
- **A key-less stand-in can be reached with plain `curl`**, since the request's status line names its loopback address. Two trials did. A real app with a credential cannot be reached that way, so the cases score correctly, but the evidence line counts it.

Not yet run: a second model, and the bash-only arm (phase 1 adds the switch). `eval report` cannot re-score the errand, since its assertions read the stand-ins' records, which live only in the run that made them.

### Phase 1: the registry, `apps.*`, and both runtimes

- `lib/capabilities/` with `defineCapability`, `defineAppTool`, the dispatcher, the CLI generator and the channel protocol above.
- `apps.call`, `apps.tools`, `apps.request`, `apps.list` as capabilities; `instrument app call`, `tools`, `tool`, `request`, `list` generated from them. The setup words stay hand-written until phase 3.
- The `instrument` global in Node and `import instrument` in Python, the `describe` handshake, the Python boot line, the stub on the native PATH, and the prompt line to read an app's guide before scripting it.
- **Deleted:** `invokeAppTool`, `AppToolInvoker`, `appToolHook`, the `tools` global and the path-based channel protocol. The `node` and `app` descriptions name the module. A decision record supersedes the `tools` part of [2026-10-12-python-and-node-run-native.md](../../decisions/2026-10-12-python-and-node-run-native.md).
- **Evals:** phase 0 rerun (the `TOOLS_CALL` patterns also match `instrument.`); a bash-only arm per case (a harness switch that opens no channel) to compare steps, tokens and correctness; the Python cases, now scored on reaching the module. Pass bar: correctness at or above baseline, fewer steps and tokens on the fan-out, the join and the errand, the single lookup still answered without a script.
- **Eval-gated: a preflight ask.** `instrument.require(["apple-calendar", "google-drive"])` would check, before a script does any work, every app it is about to use, and throw once naming everything that still needs the person's yes. Without it, a long script can stop at the first app that needs asking, the agent asks, the person answers, and the script runs again until it meets the next one. With it, the agent asks for everything in one step and the script runs once. Build it only if a case with two or more gated apps shows more cards or more reruns without it than the extra call costs.

### Phase 2: the Mac apps

- The six Mac apps' tools as `defineAppTool` capabilities over the helper and the scripts, with `macAppGate` as their one gate: the app connected in Apps for the workspace, the Settings rule, then macOS's own answer. The per-chat app grants these six apps take today (`appRefusal` and `ask_permission` with `kind: "app"` for them) go; Shortcuts, which is not an app in Apps, keeps its own.
- The `mac` app kind, `setUpFromDirectory` writing its folder, the Apps screen tile, and each app's guide from its tools' summaries.
- **Deleted:** `createMacHelperCommand`, `instrument calendar`, `contacts`, `mail`, `notes` and `messages` with their `USAGE` strings, `MAC_APP_SUBCOMMANDS`, `nativeCommandFor` and its tables, the Mac paragraphs in `computerCommandsText`. The stale plan moves to `completed/`.
- **Evals:** the `reach-*` cases in [`reach.ts`](../../../packages/workspace/evals/cases/reach.ts) (reminder, calendar, send-text, task-reminders, task-notes) rerun; a script case that adds three events and meets the Calendar card: the turn ends once, with no retry loop and no AppleScript fallback.

### Phase 3: the rest of `instrument`, and the model tools

- `memory.*`, `tab.*`, `task.*`, `x.*` and the app setup words as capabilities with generated CLI surfaces, roles from the registry instead of `CHAT_ONLY_SUBCOMMANDS`.
- `web.fetch`, `web.search` and `images.generate` get a script surface beside their model tool, from one definition; `read_file`, `write_file`, `edit_file` and the turn-enders move onto `defineCapability` with `surfaces.tool` only, so a model tool is no longer a separate style.
- **Deleted:** `defineSubcommands` and `subcommand()`; `setupTool` folds into `defineCapability`.
- **Evals:** the memory, task-sessions, task-tabs and web-search suites rerun; a scripted fan-out over `web.fetch` against loopback pages.

## Open questions for the owner

None open. The owner's answers are in [Decisions](#decisions).
