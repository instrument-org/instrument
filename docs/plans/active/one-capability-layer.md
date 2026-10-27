# One capability layer

Status: **proposed, nothing built.** Phase 0 (baseline evals) is the first step and needs no code beyond new eval cases.

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

## Proposed shape

### The registry

One definition per capability, in a new `packages/workspace/src/lib/capabilities/`:

```ts
export interface Capability<In extends z.ZodType, Out extends z.ZodType> {
  /** Dotted, snake_case: `apps.request`, `calendar.add_event`. */
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

Dynamic capabilities (an MCP app's tools, whose schemas come from the server) are one registry entry with an open input, `apps.call { app, tool, args }`, plus per-app sugar the surfaces generate from `apps.tools`.

### Generated surfaces

| Surface | Generated from | Shape |
| --- | --- | --- |
| `instrument` CLI | `input` → flags (snake_case field → `--kebab-case`; arrays repeat; objects and free JSON as a trailing JSON argument or stdin) | Human text from `text` by default; JSON of `output` with `--json`, or when stdout is the next pipeline stage (just-bash sets `offerPipeHandoff` then). `--help` from `summary` and the schema's `.meta({ description })`. Exit 0, 1 failure, 2 a card is up. |
| Script module, Node | registry list for this process | `instrument` global (non-enumerable, like `tools` today): `await instrument.calendar.addEvent({ title, start })`, `instrument.apps.request("google-drive", "POST", "/files", { body })`, `instrument.apps["google-drive"].post("/files", { body })`. Returns the parsed `output`; throws `InstrumentError` subclasses. |
| Script module, Python | the same list | `import instrument`: `instrument.calendar.add_event(title=..., start=...)`, keyword-only arguments, dicts and lists back, exceptions `instrument.Error`, `instrument.NeedsPermission`, `instrument.CardShown`, `instrument.ReadGuideFirst`. Synchronous; calls are safe from threads, so `ThreadPoolExecutor` fans out. |
| Model tool | `surfaces.tool` only | `setupTool` built from the same schemas and `text` as `toModelOutput`. Used only where a capability has to be a tool: the turn-enders, and the existing file, web and image tools as they migrate. Nothing per-platform becomes a tool, since the tool list is the cached prefix and is the same on every computer. |

Names stay one spelling per capability: snake_case in the registry and Python, kebab-case words and flags on the CLI, camelCase in JS. JS converts the keys the registry declares, never keys inside a pass-through payload (an API body, an MCP result), which reach the script as the service sent them.

Discovery is generated too: `instrument help` lists namespaces for this shell, `instrument calendar add-event --help` prints the schema, `help(instrument.calendar.add_event)` shows a real signature (built with `inspect.Signature` from the JSON Schema the channel sends at connect), and `instrument.describe("calendar.add_event")` works in both runtimes.

### The channel

The loopback channel in `node-tools-preload.ts` stays: `127.0.0.1`, a 32-byte token in an environment variable, one listener per native process, opened by the command that starts it ([`pipe-stage.ts`](../../../packages/workspace/src/lib/shell-commands/pipe-stage.ts) already takes a `toolsChannel` option, so `python` gets it the same way). What changes:

- The line protocol carries `{ id, capability, args }` rather than a dotted tool path, plus one `describe` request at connect that answers the capabilities and JSON Schemas this process may call.
- The answer function is the registry's dispatcher, given the `CapabilityContext` of the bash call when the channel opens. The asker and the raised-asks collector are passed explicitly rather than read from `AsyncLocalStorage`, since a socket callback and the bash worker's main-thread hop ([`bash-worker/client.ts`](../../../packages/workspace/src/lib/bash-worker/client.ts)) do not reliably carry it.
- A reply carries `{ error: { kind, message, ask? } }` so each runtime raises the right exception class.

### Example: `apps.request` and `calendar.add_event`, defined once

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

export const calendarAddEvent = defineCapability({
  name: "calendar.add_event",
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
  surfaces: { cli: { words: ["calendar", "add-event"] }, script: true },
  where: { available: () => getWorkspaceConfig().macHelperBinPath !== undefined, platforms: ["darwin"] },
  gate: macAppGate(CALENDAR_APP), // appRefusal, then macosAppCard
  run: (input, ctx) => runMacHelper(["add-event", ...helperArgs(input)], CalendarEventSchema, ctx),
  text: (event) => `Added "${event.title}" to ${event.calendar} at ${event.start}.`,
});
```

The same two capabilities on each surface (the CLI words for Calendar depend on recommendation 4 below):

```bash
instrument app request google-drive POST /files <<'EOF'
{"name": "Q4 plan", "mimeType": "application/vnd.google-apps.document"}
EOF
instrument calendar add-event --title 'Q4 review' --start 2026-10-29T14:00 --end 2026-10-29T15:00
instrument calendar add-event --title 'Q4 review' --start 2026-10-29T14:00 --json | jq -r .id
```

```js
const doc = await instrument.apps.request("google-drive", "POST", "/files", {
  body: { name: "Q4 plan", mimeType: "application/vnd.google-apps.document" },
});
await instrument.apps["google-docs"].post(`/documents/${doc.body.id}:batchUpdate`, { body: { requests } });
await instrument.calendar.addEvent({ title: "Q4 review", start: "2026-10-29T14:00" });
```

```python
import instrument

doc = instrument.apps.request("google-drive", "POST", "/files",
                              body={"name": "Q4 plan", "mimeType": "application/vnd.google-apps.document"})
docs = instrument.app("google-docs")
docs.post(f"/documents/{doc['body']['id']}:batchUpdate", body={"requests": requests})
try:
    instrument.calendar.add_event(title="Q4 review", start="2026-10-29T14:00")
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
- **Only capabilities marked `script`.** Setup (`apps.new`, `apps.disconnect`), the turn-enders and anything that sends on the person's behalf without a card stay off the script surface unless a capability says otherwise (see open question C for `mail.send`).
- **One process, one lifetime.** The listener closes when the process exits; the token is per process.
- **Children get nothing.** Node's preload already deletes `INSTRUMENT_TOOLS` before the script runs. Python does the same before user code: from the `.pth` line in a virtualenv (an `import` line in a `.pth` runs at startup) and from a `sitecustomize.py` in the base folder on the bare managed Python's `PYTHONPATH` (a `PYTHONPATH` folder runs no `.pth`). Skill environments ([`skill-environments.ts`](../../../packages/workspace/src/lib/skill-environments.ts)) get the same line. A program that reads the variable before it is deleted could call what the script can, which is the boundary `node` has today and the decision record accepts.

### The `instrument` stub

A small `instrument` program (a `#!/bin/sh` script, `instrument.cmd` on Windows) in the runtime folder's `bin/`, prepended to the PATH that native commands get (`resolveCommandContext` and `uvSubprocessEnv`), never to the shell's own PATH, where the builtin is found first anyway. It prints to stderr and exits 127:

```
instrument: Instrument's commands run in its shell, not from a program. From Python, `import instrument` (instrument.apps.request(...), instrument.calendar.add_event(...)); from Node, the `instrument` global. `instrument help` in the shell lists them.
```

That answers the transcript's `subprocess.run(["instrument", ...])` in the words that fix it, and keeps a script's children from reaching anything. A script that captures stderr and ignores the exit code still hides the message, so the evals below score recovery, not only the first attempt.

## Calendar, Reminders and Contacts: subcommands or apps

**Recommendation: built-in apps.** All six Mac data apps (Calendar, Reminders, Contacts, Mail, Notes, Messages) become one built-in app kind whose tools are registry capabilities, keeping their per-chat grant and macOS card as the connect step.

What the code says:

- **They are already apps everywhere except where they work.** The directory lists `apple-calendar`, `apple-mail` and the rest as entries with a `mac-app` interface ([`catalog-seed.json`](../../../packages/workspace/src/lib/apps/catalog-seed.json), `catalogWayIn` in [`way-in.ts`](../../../packages/workspace/src/lib/apps/way-in.ts)), and `app catalog` tells the agent to use `instrument calendar` instead (`nativeCommandFor`, `HELPER_COMMANDS`, `SCRIPTED_COMMANDS` in `app.ts`). Pressing Connect on one in the Apps screen dead-ends: `setUpFromDirectory` ([`set-up.ts`](../../../packages/workspace/src/lib/apps/set-up.ts)) answers `agent` for "a Mac app a task drives", so the window sends a chat message, and no app folder or tile ever appears.
- **One namespace for scripts.** As apps, they are `instrument.apps["apple-calendar"].add_event(...)` beside `instrument.apps["google-calendar"].request(...)`, discovered by the same `instrument app tools <slug>`. As subcommands, every script runtime needs a second namespace and the agent needs to know which kind of calendar it has.
- **The description moves out of every prompt.** `computerCommandsText` puts six paragraphs of Mac app usage into every session on a Mac. As apps, each has a guide read when the app is used, like any app.
- **The plan's open piece is small now.** The stale plan's "bundled-binary app kind" was the hard part when it was written; the helper, the entitlements and usage strings, and the gate it needed have since landed as `instrument calendar` and `contacts` ([`mac-helper.ts`](../../../packages/workspace/src/lib/shell-commands/mac-helper.ts), [mac-native-bridge.md](../../architecture/mac-native-bridge.md)). What is left is a manifest type (`type: "mac"`, naming the built-in by id), `setUpFromDirectory` writing its folder, and the Apps screen showing it.

What is lost either way:

- **As apps:** the short words (`instrument calendar events`); the per-chat consent model has to live inside an app kind whose others are connected workspace-wide, so the app's front shows "asks in each chat" rather than "connected"; a person who removes the folder loses the capability until they add it again (today it is always there on a Mac).
- **As subcommands:** no presence on the Apps screen, a Connect that hands off to the agent, two namespaces in every script runtime, and the six descriptions in every session's context.

The stale [mac-reminders-and-calendar-app.md](mac-reminders-and-calendar-app.md) moves to `completed/` when phase 2 lands, its status reading that the EventKit helper landed as commands and the built-in app kind is carried here. Its remaining items (update and delete, write-only access on macOS 14+, recurrence) become follow-up capabilities.

## Phasing

Each phase deletes what it replaces. Every eval run names its models; Workers AI first, then one paid model through the Claude or ChatGPT account ([workspace-evals](../../../.agents/skills/workspace-evals/SKILL.md)). Each case records bash calls, `tools`/`instrument` calls in scripts, model steps, `treeUsage` tokens, and correctness assertions.

### Phase 0: baseline, no product code

- Run [`app-scripting.ts`](../../../packages/workspace/evals/cases/app-scripting.ts) as it stands. It has never run on real models with the `node` global; this is the number the rest is compared against.
- Add API-app scripting cases over the existing `api` fixture with a `service` stand-in ([`connected-app.ts`](../../../packages/workspace/evals/lib/connected-app.ts)): the same three questions (fan-out, single lookup, join) through `app request`, which today is bash-only.
- Add the transcript case, `app-scripting-google-errand`: stand-in Drive, Docs, Calendar and Gmail API apps; "create three docs for X, Y and Z, add a summary paragraph to each, put a review on my calendar Thursday at 2, and draft an email to Aiko linking all three." Assertions: three files with the right titles, each edited, one event at the right local time, one draft naming the three links; mechanism recorded.
- Add Python variants of the fan-out cases ("in Python", or a pandas join) that today must fall back to bash.

### Phase 1: the registry, `apps.*`, and both runtimes

- `lib/capabilities/` with `defineCapability`, the dispatcher, the CLI generator and the channel protocol above.
- `apps.call`, `apps.tools`, `apps.request`, `apps.list` as capabilities; `instrument app call`, `tools`, `tool`, `request`, `list` generated from them. The setup words stay hand-written subcommands until phase 3.
- The `instrument` global in Node and `import instrument` in Python, the `describe` handshake, the Python boot line, the stub on the native PATH.
- **Deleted:** `invokeAppTool`, `AppToolInvoker`, `appToolHook`, the `tools` global and the path-based channel protocol. The `node` and `app` descriptions name the module. A decision record supersedes the `tools` part of [2026-10-12-python-and-node-run-native.md](../../decisions/2026-10-12-python-and-node-run-native.md).
- **Evals:** phase 0 rerun (the `TOOLS_CALL` pattern also matches `instrument.`); a bash-only arm per case (a harness switch that opens no channel) to compare steps, tokens and correctness; a stub case ("write a Python script that …" where reaching `instrument` by subprocess is the natural mistake), scored on recovering within one step. Pass bar: correctness at or above baseline, fewer steps and tokens on the fan-out, the join and the errand, the single lookup still answered without a script.

### Phase 2: the Mac apps

- `calendar.*`, `reminders.*`, `contacts.*`, `mail.*`, `notes.*`, `messages.*` as capabilities over the helper and the scripts, with `macAppGate` as their one gate.
- The `mac` app kind, `setUpFromDirectory` writing its folder, the Apps screen tile, and each app's guide from its capabilities' summaries.
- **Deleted:** `createMacHelperCommand`, the per-command `USAGE` strings, `MAC_APP_SUBCOMMANDS`, `nativeCommandFor` and its tables, the Mac paragraphs in `computerCommandsText`. The stale plan moves to `completed/`.
- **Evals:** the `reach-*` cases in [`reach.ts`](../../../packages/workspace/evals/cases/reach.ts) (reminder, calendar, send-text, task-reminders, task-notes) rerun; a script case that adds three events and meets the Calendar card: the turn ends once, with no retry loop and no AppleScript fallback.

### Phase 3: the rest of `instrument`, and the model tools

- `memory.*`, `tab.*`, `task.*`, `x.*` and the app setup words as capabilities with CLI surfaces, roles from the registry instead of `CHAT_ONLY_SUBCOMMANDS`.
- `web.fetch`, `web.search` and `images.generate` get a script surface beside their model tool, from one definition; `read_file`, `write_file`, `edit_file` and the turn-enders move onto `defineCapability` with `surfaces.tool` only, so a model tool is no longer a separate style.
- **Deleted:** `defineSubcommands` and `subcommand()` once nothing uses them; `setupTool` folds into `defineCapability`.
- **Evals:** the memory, task-sessions, task-tabs and web-search suites rerun; a scripted fan-out over `web.fetch` against loopback pages.

## Open questions for the owner

A. **The script name.** The plan renames the Node global from `tools` to `instrument` so all three surfaces share one word, which is breaking and teaches a new name. Keep `tools` in Node and call the Python module `tools` too, or take `instrument` everywhere?

B. **CLI words for the Mac apps once they are apps.** `instrument app call apple-calendar add-event --title …` (one path, longer) or keep `instrument calendar add-event` as a generated alias of the same capability (shorter, a second spelling)?

C. **What scripts may send.** `mail.send` and `messages.send` act on the person's behalf with no card beyond the app grant. Script-callable like the CLI, or CLI-only so each send is a visible command in the transcript?

D. **Guide before the first request from a script.** `ReadGuideFirst` costs a rerun of the whole script. Accept that, or have a script call skip the guide check when the session has already made a CLI request to the app (or never check it in scripts)?

E. **A preflight ask.** Should scripts get `instrument.require([...])`, which checks every gate the work needs up front and throws one `NeedsPermission` naming all of them, so the agent asks once before a long script rather than meeting cards one at a time?

F. **Async Python.** Synchronous calls with thread-safe fan-out, or an `instrument.aio` with `asyncio` from the start?

G. **Per-chat consent inside the Apps screen.** A built-in Mac app is the only kind connected per chat. Show it as "asks in each chat", or move it to a workspace-wide connection like other apps (simpler, but the person's yes then covers every chat)?
