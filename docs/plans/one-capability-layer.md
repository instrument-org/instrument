# One capability layer

Status: done. Landed in full (phase 3 in `5d7ff3d5b`), phases 0 to 3: the baseline, the registry with `apps.*` and both runtimes, the Mac apps as bundled MCP apps, and every model tool and `instrument` word on the registry with the role split as its data (evals below), then a final eval pass on Haiku and Sonnet; the owner's answers are in Decisions.

## Problem

What the agent can do is defined once per surface rather than once per capability, so every surface reaches a different subset, and each new way of reaching them (a script runtime, a model tool, a future command line) is written again.

- **Scripts reach almost nothing.** A `node` script's `tools` global (`node-tools-preload.ts`, wired in [`shell-commands/node.ts`](../../packages/workspace/src/lib/shell-commands/node.ts)) answers through `appToolHook` → `invokeAppTool` (`app-tool-hook.ts`, [`shell-commands/app.ts`](../../packages/workspace/src/lib/shell-commands/app.ts)), which is `instrument app call` and nothing else: MCP app tools only. API apps (every Google app, since they moved to Google's REST APIs) go through `instrument app request`, which the channel cannot reach. `invokeAppTool` takes no chat or session, and `request` needs the session to know whether the app's guide is in the context window (`guideInWindow`), which is why it was never wired.
- **Python reaches nothing.** [`shell-commands/python.ts`](../../packages/workspace/src/lib/shell-commands/python.ts) runs the interpreter with the managed base packages ([`python-base.ts`](../../packages/workspace/src/lib/python-base.ts), by a `.pth` in a virtualenv or `PYTHONPATH` on the bare managed Python) and opens no channel.
- **Scripts reach for the shell and fail.** In a real transcript a Python script ran `subprocess.run(["instrument", ...])`. `instrument` is a just-bash command ([`shell-commands/instrument.ts`](../../packages/workspace/src/lib/shell-commands/instrument.ts)), not a program, so a process the shell starts finds nothing by that name.
- **Every `instrument` subcommand renders its own way.** Most parse argv through the shared `subcommands.ts` (flag names only, no types); `calendar` and `contacts` pass argv straight to the Swift helper, which parses it itself. Output is per command: `calendar` always prints JSON, `mail` and `notes` print JSON lines for lists and text otherwise, `x` prints text with `--json` for data, `app request` puts the body on stdout and the status on stderr, `app call` prints the tool's text.
- **Model tools are a third definition style.** `tools/create-tool.ts` (`setupTool`, Zod in and out, `toModelOutput`) has the schemas a script module would want, and none of it is reachable from a script: `web_fetch` and `web_search` inside a fan-out are a turn each.

The owner's direction: define each capability once, in a structured way, and generate every mechanism the agent reaches it by, rather than keeping unique behaviors per environment. Breaking changes are allowed.

## Inventory: what the agent reached before phase 1

"Both" means the chat's session and its tasks. The model tool list is the same in both (the fork reuses the chat's cached prefix, [`agents/instrument.ts`](../../packages/workspace/src/agents/instrument.ts)); a chat-only tool refuses at execute time. A task's `instrument` refuses the chat-only words per capability, each naming what to do instead (`where.roles` and `roleRefusal`, [`capabilities/define.ts`](../../packages/workspace/src/lib/capabilities/define.ts)), and leaves `task`, which has nothing for a task, out of its listing.

| Capability | Shell (`instrument …` unless noted) | Model tool | Node `tools` | Python | Chat / task | Gate |
| --- | --- | --- | --- | --- | --- | --- |
| MCP app tools | `app tools`, `app tool`, `app call [--out]` | no | `tools.<slug>.<tool>()` | no | both | app connected on its tested manifest, credential present; workspace-wide, no per-chat gate |
| API app requests | `app request <slug> <METHOD> <path> [--param]` | no | **no** | no | both | as above, plus the guide handed back instead of the first request in a session |
| App setup | `app catalog`, `new`, `test`, `list`, `guide`, `icon`, `account`, `disconnect` | `connect_app` | no | no | `catalog`, `list`, and reading a `guide` or an `account`, both; `new`, `test`, `icon`, `disconnect`, writing a guide or naming an account, and `connect_app`, chat only (a task is told to end with a needs fence naming the app and what it needs) | sign-in or key on the connect card |
| Web apps | refused by `app call`/`request`; worked in a tab | no | no | no | both | sign-in in the window's browser |
| Calendar, Reminders, Contacts, Mail, Notes, Messages | MCP apps on the server the app ships: `app tools apple-calendar`, `app call apple-calendar add_event '<json>'` (macOS; Calendar, Reminders and Contacts in helper builds) | no | `instrument.apps["apple-calendar"].add_event()` | no | both | connected in Apps for every chat (Disconnect is the off switch), then macOS's own answer (the gate's `card`: exit 2, `CardShown`) |
| Shortcuts | `/usr/bin/shortcuts` as a real program | no | no | no | both | `path-program.ts` asks by the app's grant; Seatbelt closes its services until granted |
| Memory | `memory list`, `save`, `show`, `forget` | no | `instrument.memory.list()`, `.show(name)` | the same | `list` and `show` both; `save` and `forget` chat only | none |
| Window | `window list`, `show`, `read`, `close`, `request` | no | `instrument.window.list()`, `.read(tab)` | the same | `list` and `read` both; `show`, `close` and `request` chat only | `window request` raises a card |
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
- **The turn-ending interactions are model tools on purpose** (`ask_permission`, `connect_app`, `choose`): they end the turn mechanically, which a command can only do through the raised-asks path ([`raised-asks.ts`](../../packages/workspace/src/lib/shell-commands/raised-asks.ts)). They stay model tools.

## Decisions

The owner settled these; the design below follows them.

- **One name: `instrument`.** The CLI, the Node global and the Python module are all `instrument`. The `tools` global is deleted, and no compatibility name keeps it.
- **One generated CLI form for every app, and no hand-written subcommands.** Every capability flows through the registry and its one gate, so there is never a second way to do the same powerful thing that skips the permission path. The Mac apps' tools are `instrument app call apple-calendar add_event '{...}'` like any app's; nothing keeps `instrument calendar` as an alias. The rest of `instrument` (`memory`, `task`, `window`, `x`) is generated from the registry too.
- **Sends are script-callable.** Once the person granted Mail or Messages, a script sending is no worse than a bash loop sending, which the shell already allows. If sends need more protection later, it is a review of each call or each script in the shape of [auto mode](auto-mode.md), and it attaches at the registry's single gate, which every surface passes through.
- **Scripts keep the guide check.** A script's first request to an API app throws `ReadGuideFirst` with the guide, as the CLI hands it back today, and the `app` and `node`/`python` descriptions say to read an app's guide before scripting it.
- **A preflight ask is built only if an eval shows it helps** (phase 1).
- **Python is synchronous first**, with calls safe from threads for fan-out.
- **The Mac apps move into the Apps area like every other app, as plain local MCP apps.** The EventKit helper and the AppleScript behind Mail, Notes and Messages are served by an MCP server bundled inside Instrument, and each Mac app is an ordinary local MCP app (`instrument app call apple-calendar add_event`), the same as Notion or Linear, presented in Apps as a Mac app. There is no `mac` app kind and no registry capability per tool. MCP is the boundary, so the server can later be swapped or reused (iOS, the cloud). macOS's permission prompts stay attributed to Instrument, and a denial is the gate's `card` outcome (exit 2, `CardShown`) with today's macOS card. Longer term, computer use on every OS goes through Apps too (see [Computer use](#computer-use)).
- **`instrument tab` is `instrument window`**, renamed on its own branch; phase 3's capabilities are `window.*`.
- **Connecting a Mac app covers every chat**, as connecting any other app does. Calendar, Mail, Messages and the rest stop asking in each chat once the person connects them in Apps; Disconnect in Apps is the off switch, as for every other app, and macOS keeps its own prompt. Per-chat access may come later as an opt-in setting, and it would apply to apps in general rather than to Mac apps alone.

## Proposed shape

### The registry

One definition per capability, in `packages/workspace/src/lib/capabilities/` (built in phase 1; the code is the reference, and the sketch below is the shape it took):

```ts
export interface Capability<In extends z.ZodType, Out extends z.ZodType> {
  /** Dotted, snake_case: `apps.request`, `memory.save`. */
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

Apps are one shape in the registry, two open capabilities whose schemas come from the service: `apps.call { app, tool, args }` for an MCP app's tools (schemas from `apps.tools`) and `apps.request { app, method, path, params, body }` for an API app. The surfaces generate per-app sugar over them. The Mac apps are MCP apps too (Decisions), so their tools reach every surface through `apps.call` with the schemas their bundled server sends; phase 1 dropped the planned `defineAppTool` for built-in tools, which nothing would use.

### Generated surfaces

| Surface | Generated from | Shape |
| --- | --- | --- |
| `instrument` CLI | `input` → flags (snake_case field → `--kebab-case`; arrays repeat; a string record is a repeated `--flag key=value`; objects and free JSON as a trailing JSON argument or stdin) | `instrument app call <slug> <tool> '<json>'` for every app's tools, the JSON the service's schema describes; `instrument app request <slug> …`; `instrument <namespace> <verb>` for the rest. Human text from `text` (or `render`, for a request's status line on stderr) by default; JSON of `output` with `--json`; `--out <file>` writes it and prints one line. The command's usage lists each from `summary` and the schema. Exit 0, 1 failure, 2 a card is up, 3 nothing sent until the app's guide is read (the guide on stderr, stdout empty). |
| Script module, Node | registry list for this process | The `instrument` global (non-enumerable, writable, configurable): `await instrument.apps["apple-calendar"].add_event({ title, start })`, `instrument.apps.request("google-drive", "POST", "/files", { body })` (the whole response), `instrument.apps["google-drive"].post("/files", { body })` (the parsed body), `instrument.apps.beacon.list_issues({ state: "open" })`. An MCP tool keeps the service's own name. Returns the parsed `output`; throws `instrument.Error` and its subclasses. |
| Script module, Python | the same list | `import instrument`: `instrument.app("apple-calendar").add_event(title=..., start=...)`, `instrument.app("google-drive").post("/files", body={...})` (the parsed body), `instrument.apps.request("google-drive", "POST", "/files", body={...})` (the whole response), keyword-only arguments, dicts and lists back, exceptions `instrument.Error`, `instrument.NeedsPermission`, `instrument.CardShown`, `instrument.ReadGuideFirst`. Synchronous; calls are safe from threads, so `ThreadPoolExecutor` fans out. |
| Model tool | `surfaces.tool` | `modelTool()` builds the AI SDK tool from the capability's input (after the `activity` and `explanation` every call carries) and the tool surface's description, recorded output shape, `execute` and `toModelOutput`. A tool keeps its own output shape, since sessions on disk keep every one it had; a capability with a script surface too runs the same work for both. Used only where a capability has to be a tool: the turn-enders, the shell, and the file, skill, web and image tools. Nothing per-platform becomes a tool, since the tool list is the cached prefix and is the same on every computer. |

Names stay one spelling per capability: snake_case in the registry, in Python and for tool words on the CLI (as MCP tools are already named), kebab-case flags, camelCase in JS. JS converts the keys the registry declares, never keys inside a pass-through payload (an API body, an MCP result), which reach the script as the service sent them.

Discovery is generated too: `instrument help` lists namespaces for this shell, `instrument app tools apple-calendar` lists an app's tools and `instrument app tool apple-calendar add_event` prints one tool's schema, `help(instrument.apps.request)` shows a real signature (built with `inspect.Signature` from the JSON Schema the describe answer carries), and `instrument.describe("apps.request")` works in both runtimes.

### The channel

The loopback channel `tools` used stays, in [`capabilities/channel.ts`](../../packages/workspace/src/lib/capabilities/channel.ts): `127.0.0.1`, the port in `INSTRUMENT_CHANNEL` and a 32-byte token on descriptor 3 (in the variable on Windows, where no descriptor reaches a program MXC holds), one listener per native process, opened by the command that starts it and passed to [`pipe-stage.ts`](../../packages/workspace/src/lib/shell-commands/pipe-stage.ts) as `scriptChannel`, for `python` the same way as `node`. What changed:

- The line protocol carries `{ id, capability, args }` rather than a dotted tool path, plus one `describe` request at connect that answers the capabilities and JSON Schemas this process may call.
- The answer function is the registry's dispatcher, given the bash call's chat, session, model and role (`CapabilityScope`) when the shell is built, on the main thread where credentials are. The bash worker's hop ([`bash-worker/client.ts`](../../packages/workspace/src/lib/bash-worker/client.ts)) answers in the exec's captured async context, and a channel on the shell's own thread snapshots the context it was opened in, so a guide handed over and a card raised reach the bash call's result. Phase 1 has no asker or raised-asks collector in the context, since no `apps.*` gate asks; one goes in with the first gate that does.
- A reply carries `{ error: { kind, message, ask? } }` so each runtime raises the right exception class.

### Example: `apps.request`, defined once

The sketch as planned, before phase 1. What landed is [`capabilities/apps.ts`](../../packages/workspace/src/lib/capabilities/apps.ts). Calendar's `add_event` is an MCP tool of the bundled server (Decisions), so it needs no definition here.

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
```

`apps.request` and Calendar's `add_event` (an MCP tool, through `apps.call`) on each surface:

```bash
instrument app request google-drive POST /files <<'EOF'
{"name": "Q4 plan", "mimeType": "application/vnd.google-apps.document"}
EOF
instrument app call apple-calendar add_event '{"title": "Q4 review", "start": "2026-10-29T14:00", "end": "2026-10-29T15:00"}'
instrument app call apple-calendar add_event '{"title": "Q4 review", "start": "2026-10-29T14:00"}' --json | jq -r .id
```

```js
const doc = await instrument.apps["google-drive"].post("/files", {
  body: { name: "Q4 plan", mimeType: "application/vnd.google-apps.document" },
});
await instrument.apps["google-docs"].post(`/documents/${doc.id}:batchUpdate`, { body: { requests } });
await instrument.apps["apple-calendar"].add_event({ title: "Q4 review", start: "2026-10-29T14:00" });
```

```python
import instrument

drive = instrument.app("google-drive")
doc = drive.post("/files", body={"name": "Q4 plan", "mimeType": "application/vnd.google-apps.document"})
instrument.app("google-docs").post(f"/documents/{doc['id']}:batchUpdate", body={"requests": requests})
try:
    instrument.app("apple-calendar").add_event(title="Q4 review", start="2026-10-29T14:00")
except instrument.CardShown as shown:
    print(shown)  # macOS is asking the person about Calendar; the card is up, and the turn ends after this command
```

## Cards and the security boundary

### A call that needs the person

A script call never blocks waiting on a card. Blocking would hold a process, and with it the bash call, open for as long as the person takes, past `yieldMs` into a background job whose result nobody reads, and the agent could not say what it is waiting for. So each gate outcome throws:

| Gate | CLI | Script | Turn |
| --- | --- | --- | --- |
| `refused` | exit 1 with the message | `instrument.Error` (`kind: "refused"`) | continues; the agent reports what it skipped |
| `ask` | exit 1, "ask for X with `ask_permission`" | `NeedsPermission`, carrying `ask` | continues until the agent calls `ask_permission`, which ends it. Matches [explicit-permission-asks.md](explicit-permission-asks.md): running into a gate raises no card |
| `card` (macOS's own answer) | exit 2 | `CardShown` | ends after the bash call returns, through the raised asks, as a command's card does today, whatever the script did after catching it |
| `read-first` | nothing sent, stdout empty, the guide on stderr, exit 3 | `ReadGuideFirst`, whose message is the guide | continues; the agent reruns with the guide in context. Either way the hand-off counts only once the bash call's output shows the printed guide whole (`appGuidesShown`), so a guide sent to `/dev/null`, filtered by a pipe or caught and dropped by a script is handed over again |

A script that catches one exception keeps the rest of its work, so a fan-out that reaches one closed app still writes everything else. A second call to the same gated app in one script joins the open card (`recordAsk` already keeps one per thing) and throws again without raising another.

### What a token opens

- **Exactly what the shell's own `instrument` opens in that bash call.** The context is the bash call's (chat, session, role, part); the script never names a chat or a session. A task's script reaches the reads alone (`memory.list`, `memory.show`, `window.list`, `window.read`), because the dispatcher checks `where.roles` against the captured role; nothing that changes the window or the memories, and no `task.*`, is on the script surface for either role.
- **Only capabilities marked `script`.** App setup (`apps.new`, `apps.guide`, `apps.disconnect` and the rest) and the turn-enders stay off the script surface: a turn-ender is a tool-only capability, which has no script surface to mark. Sends (`apps.apple-mail.send`, `apps.apple-messages.send`) are on it, behind the same gate the CLI passes.
- **One process, one lifetime.** The listener closes when the process exits; the token is per process.
- **Children get nothing.** Node's preload deletes `INSTRUMENT_CHANNEL` and reads and closes descriptor 3 before the script runs. Python does the same before user code: from the `.pth` line in a virtualenv (an `import` line in a `.pth` runs at startup) and from a `sitecustomize.py` in its own folder ahead of the base on the bare managed Python's `PYTHONPATH` (a `PYTHONPATH` folder runs no `.pth`). Skill environments ([`skill-environments.ts`](../../packages/workspace/src/lib/skill-environments.ts)) get the same line. The token stays out of the environment on macOS and Linux, since another process of the same user reads the environment a process started with whatever it deletes later; on Windows, where the token is in the variable, a program that reads it before it is deleted could call what the script can. A Python run with `-S` runs no `site`, so the variable and descriptor 3 stay until `import instrument`, as the variable alone did before.

### The `instrument` stub

A small `instrument` program (a `#!/bin/sh` script, `instrument.cmd` on Windows) in the runtime folder's `bin/`, which the app already puts first on the PATH of every program it starts, never on the shell's own PATH, where the builtin is found first anyway. `node` and `python` write it when it differs ([`capabilities/stub.ts`](../../packages/workspace/src/lib/capabilities/stub.ts)). It prints to stderr and exits 127:

```
instrument: Instrument's commands run in its shell, not from a program. From Python, `import instrument` (instrument.app("google-drive").post(...)); from Node, the `instrument` global. `instrument help` in the shell lists them.
```

That answers the transcript's `subprocess.run(["instrument", ...])` in the words that fix it, and keeps a script's children from reaching anything. A script that captures stderr and ignores the exit code still hides the message, so the evals below score recovery, not only the first attempt.

## The Mac apps move into Apps

**Landed in phase 2, as bundled MCP apps.** All six Mac data apps (Calendar, Reminders, Contacts, Mail, Notes, Messages) are local MCP apps on one server the app ships, in the Apps area like every other app. What the code said when this was weighed:

- **They were already apps everywhere except where they work.** The directory listed `apple-calendar`, `apple-mail` and the rest as entries with a `mac-app` interface ([`catalog-seed.json`](../../packages/workspace/src/lib/apps/catalog-seed.json), `catalogWayIn` in [`way-in.ts`](../../packages/workspace/src/lib/apps/way-in.ts)), Connect on one dead-ended in `setUpFromDirectory`, and `app catalog` sent the agent to `instrument calendar` instead.
- **One namespace for scripts.** As apps, they are `instrument.apps["apple-calendar"]` (Node) and `instrument.app("apple-calendar")` (Python) beside `google-calendar`, discovered by the same `instrument app tools <slug>`.
- **The description moved out of every prompt.** `computerCommandsText` put six paragraphs of Mac app usage into every session on a Mac. As apps, each has a guide, written from its tools' descriptions when it is set up, which a chat reads once the app is connected.

What landed:

- **The server.** [`lib/mac-apps`](../../packages/workspace/src/lib/mac-apps): TypeScript tools with Zod schemas wrapping the Swift helper's JSON commands (Calendar, Reminders, Contacts) and the app's own AppleScript (Mail, Notes, Messages), over stdio. The manifest names it: `type: mcp-local`, `runtime: bundled`, `package: apple-calendar`. Studio builds it as `out/main/mac-apps-server.js` and the workspace's `macAppsServer` starts it with the app's own executable as Node. Rejected: the Swift helper speaking MCP, since half the apps are AppleScript and the schemas would leave the TypeScript that checks file arguments against the chat's folders.
- **Who macOS asks about.** The server is a plain child of the app and the helper and `osascript` plain children of the server, so nothing disclaims responsibility and the prompts and grants stay Instrument's ([mac-native-bridge.md](../architecture/mac-native-bridge.md)).
- **The gate**, in the `apps.call` capability ([`capabilities/apps.ts`](../../packages/workspace/src/lib/capabilities/apps.ts), with the Mac app pieces in [`lib/apps/mac-app.ts`](../../packages/workspace/src/lib/apps/mac-app.ts)), keyed by the server the manifest names rather than the app's slug. Its `gate` asks macOS before the call: refused, or not asked yet, is the `card` outcome with `macosAppCard`'s ask id, so the call is not made. Its `run` holds a file argument (Mail's attachments) to the chat's folder rules through the context's `readableFile` and hands it over absolute, then reads the server's refusal after the call and throws a `card` failure carrying the ask id. Either way the dispatcher records the raised ask, the CLI exits 2, a script gets `CardShown` (Node and Python), and the turn ends on the card. Connecting in Apps covers every chat; Disconnect is the off switch, and the per-chat grants these six took are gone. Shortcuts keeps its own.
- **macOS's refusal in an MCP result.** The server returns `isError` with `_meta["tryinstrument.com/macos-refusal"]: { bundleId, reason }`, read only from the bundled server. The same mapping could later help a third-party MCP server that drives a Mac app and meets macOS's prompts: a local app's manifest already names its Mac app (`macApp`), so the app-call path could ask macOS about that app before the call and read an Automation refusal (-1743 in an error's text, or a server that adopts the key) after it, raising the same card. Not built, since a third party's server may disclaim responsibility and its prompts then name it rather than Instrument.
- **Setup.** Connect on a Mac app in the directory writes its folder under the Mac app's own name and leaves it waiting on the go-ahead, the usual card; the agent's set-up line is `instrument app new apple-calendar --name 'Calendar' --local apple-calendar --runtime bundled`, then `connect_app`.
- **Deleted:** `createMacHelperCommand`, `instrument calendar`, `contacts`, `mail`, `notes` and `messages` with their `USAGE` strings, `MAC_APP_SUBCOMMANDS`, `nativeCommandFor` and its tables, `app-scripts.ts`, and the Mac paragraphs in `computerCommandsText`. [mac-reminders-and-calendar-app.md](mac-reminders-and-calendar-app.md) moved to `completed/`; its remaining items (update and delete, write-only access on macOS 14+, recurrence) are follow-up tools on these servers.

What it costs: the short `instrument calendar` words, and a person who removes the app's folder loses it until they connect it again. Connecting one covers every chat, as for any app (Decisions).

## Computer use

The spike lives on the `spike/computer-use` branch: a `computer` shell command (`packages/workspace/src/lib/shell-commands/computer.ts` there) over an embedded Cua Driver that Studio main runs (`apps/studio/src/electron-main/lib/computer-driver.ts`), behind a feature flag, with its own plan (`docs/plans/computer-use.md` on that branch). An earlier `spike/cua-driver` branch is the macOS proof of concept it grew from.

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

Each phase deletes what it replaces. Every eval run names its models ([workspace-evals](../../.agents/skills/workspace-evals/SKILL.md)). Each case records bash calls, script calls, model steps, tokens, and correctness assertions.

### Phase 0: baseline, no product code

The cases are [`app-scripting.ts`](../../packages/workspace/evals/cases/app-scripting.ts) (Beacon, an MCP app a `node` script can call through `tools`) and [`app-scripting-api.ts`](../../packages/workspace/evals/cases/app-scripting-api.ts): Lantern, the same tracker as an API app; two Python variants that ask for a script; and the errand, Google-like Drive, Docs, Calendar and Gmail stand-ins where three docs are made, edited and read back, an event is added and a draft saved. Run each group on its own, since one run lists every app its cases declare.

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

Built:

- [`lib/capabilities/`](../../packages/workspace/src/lib/capabilities/): `defineCapability`, the dispatcher (`dispatch.ts`: the capability, where it exists, its surface, the input, the gate, the work), the CLI generator (`cli.ts`), the channel and its protocol (`channel.ts`: `{ id, capability, args }`, a `describe` request, error replies by kind), and the two runtimes (`node-runtime.ts`, `python-runtime.ts`).
- `apps.call`, `apps.tools`, `apps.request`, `apps.list` as capabilities (`apps.ts`), with `instrument app call`, `tools`, `tool`, `request` and `list` generated from them, each with `--json` and `--out`. Exit codes: 0, 1 a failure, 2 a card is up, 3 not sent until the guide is read (stdout empty, the guide on stderr). The setup words stay hand-written.
- The `instrument` global in Node and `import instrument` in Python. Python finds it by a `.pth` in whichever virtualenv runs, the chat's or a skill's environment, and, run bare, by a `sitecustomize` ahead of it on `PYTHONPATH`; each takes `INSTRUMENT_CHANNEL` out of the environment, and reads and closes the token's descriptor, before the script's code runs. An app's request methods (`.get`, `.post`, ...) return the parsed body, and `instrument.apps.request(...)` the whole response. The stub on the runtime `bin/`, and the prompt line to read an app's guide before scripting it.
- **Deleted:** `invokeAppTool`, `AppToolInvoker`, `appToolHook`, the `tools` global and the path-based channel protocol. The [decision record](../decisions/2026-10-27-scripts-reach-instrument.md) supersedes the `tools` part of the 2026-10-12 one.
- **Not built:** `defineAppTool`, which the Mac apps as MCP apps (Decisions) leave without a user, and `instrument.require` (below).
- The evals' bash-only arm is `pnpm eval run ... --bash-only`, which sets `INSTRUMENT_SCRIPT_CHANNEL=0`: no channel opens and the prompt names no script surface. The cases count scripts calling `instrument` by runtime (`scriptedCalls` in `app-scripting.ts`), `ReadGuideFirst` thrown, and the stub's answers.

**Evals, Claude Haiku 5.5 through OpenRouter, three trials per case** (six for the errand in phase 1, below), measured as phase 0 was: model steps and the trial's total tokens as medians, steps with their range, cost summed over the trials. The phase 1 cost figures are about twice phase 0's for the same tokens (the bash-only single lookups cost $0.014 at 86K, phase 0's $0.006), so the harness's price for the model changed between the runs: compare tokens across phases, and cost only within phase 1.

| Case | Phase 0 (`tools` in Node only) | Phase 1 | Bash-only arm | How phase 1 made the calls |
| --- | --- | --- | --- | --- |
| Beacon fan-out (MCP) | 3/3, 6 (4-7), 185K | 3/3, 6 (4-6), 186K, $0.019 | 3/3, 7 (5-8), 215K, $0.021 | a Python script with `import instrument` in 3/3 |
| Beacon join (MCP) | 3/3, 5 (5-6), 145K | 3/3, 5 (4-5), 147K, $0.017 | 3/3, 5 (4-6), 151K, $0.018 | a `node` script in 3/3 |
| Beacon single lookup (MCP) | 3/3, 4 (4-4), 113K | 3/3, 4 (4-4), 115K, $0.014 | 3/3, 4 (4-4), 113K, $0.014 | two `app call`s, no script, 3/3 |
| Lantern fan-out (API) | 3/3, 7 (5-10), 214K | 3/3, 4 (3-4), 117K, $0.016 | 3/3, 7 (6-8), 223K, $0.022 | a script in 3/3, after one or two `app request`s |
| Lantern join (API) | 3/3, 5 (4-5), 149K | 3/3, 4 (3-4), 119K, $0.016 | 3/3, 4 (4-5), 122K, $0.018 | a script in 3/3 |
| Lantern single lookup (API) | 3/3, 3 (3-3), 86K | 3/3, 3 (3-3), 87K, $0.014 | 3/3, 3 (3-3), 86K, $0.014 | two or three `app request`s, no script, 3/3 |
| Python fan-out over Lantern | 3/3, 11 (10-16), 361K | 3/3, 4 (3-4), 121K, $0.017 | 3/3, 11 (10-14), 356K, $0.032 | `import instrument` in 3/3, no `subprocess` |
| Python fan-out over Beacon | 3/3, 10 (9-11), 320K | 3/3, 5 (5-6), 153K, $0.019 | 3/3, 13 (13-13), 451K, $0.037 | `import instrument` in 2/3, a `node` script in 1/3 |
| Google errand (4 API apps) | 3/3, 12 (10-14), 420K | 5/6, 6.5 (3-17), 217K, $0.048 | 3/3, 9 (8-11), 306K, $0.029 | scripts in 6/6; 0 to 3 calls a trial stopped by `ReadGuideFirst`, one app each |
| Google errand, after the fixes below | | 6/6, 6.5 (5-8), 216K, $0.038 | | scripts in 6/6; at most 1 call a trial stopped by `ReadGuideFirst` (3 of 6), each stop carrying every unread guide; no extra docs |
| Python fan-out over Lantern, after the fixes below | | 3/3, 5 (4-6), 151K, $0.017 | | `import instrument` in 3/3; no stop |

What it says:

- **The pass bar holds; on the first runs, all but the errand's correctness.** Fewer steps and tokens on the API fan-out (7 to 4 steps, 214K to 117K), the API join (5 to 4, 149K to 119K), both Python fan-outs (11 to 4 and 10 to 5, about a third of the tokens) and the errand (12 to 6.5, 420K to 217K); both single lookups still answered with plain commands and no script. The MCP fan-out and join are unchanged from phase 0, which already had a script surface for MCP apps (`tools`), and both are cheaper than with none (the bash-only arm). The errand passed 5 of 6: the miss made a stray second Pricing doc and linked the other copy, which the assertion, taking the first doc it finds for a title, scores as unlinked. The first three errand trials alone were 2/3, 9 (5-17), 317K; three more were run because one trial took 17 steps.
- **Python reaches the module and stops failing first.** No phase 1 Python trial ran `instrument` as a program in the Lantern or Beacon cases; the errand's 17-step trial did twice from `subprocess`, heard the stub, and moved to the module. In the bash-only arm, every Python trial reproduced phase 0's failure (`subprocess` and "not found" in 6 of 6), and 3 of 3 over Lantern also curled the stand-in.
- **Guides are read into `/dev/null`.** In 5 of the 6 first phase 1 errand trials the model ran `instrument app guide <slug> >/dev/null` (or `| head`) to get past the check. The guide never reaches the output, so it does not count as handed over and the next request throws `ReadGuideFirst` again, as designed; but it costs a rerun each time, and a script stopped at one app's guide, then the next on the rerun (three in a row in two trials). The fixes below answer this.

**After the first runs, three fixes, then the errand (6 trials) and the Python fan-out over Lantern (3, as a regression check) again**, the rows marked "after the fixes" above:

- **The errand's checks take any doc with the title.** A check passes when any doc whose title names the topic satisfies it, so a stray duplicate no longer fails a correct link; an always-passing line counts the docs past one per title. The first runs cannot be re-scored, since the stand-ins' records live only in the run that made them; read from its transcript, the one failed trial linked a copy of each doc and would pass now.
- **A guide counts only where it is shown, and the message says so.** `ReadGuideFirst` and the command line's exit-3 message add that a guide sent to `/dev/null` or cut with `head` does not count, and to run `instrument app guide <slug>` with its output shown.
- **A script's first stop carries every unread guide.** When a script's request stops on one app's guide, the same `ReadGuideFirst` carries every other connected API app's guide not yet in the window, so one stop covers a multi-app script; the command line still hands over only the app it names. In a workspace with many connected API apps that first stop prints all their guides, which no case here measures.

The errand went to 6/6 with its steps' range down from 3-17 to 5-8, and no trial stopped on a guide more than once (before, two trials stopped three times in a row). The model still sent guides to `/dev/null` or `head` in 4 of 6 errand trials and all 3 Python ones; the wording did not stop that, and the one-stop guide check is what kept it to a single rerun. The Python fan-out took a step more at the median (5 against 4, 151K against 121K) with no stop and no failure, within what three trials vary by.

**`instrument.require`: built, measured, and taken out.** Phase 1 has no gate that asks the person (an app is connected or refused, workspace-wide), so the only multi-app gate to try it on was the guide check: `instrument.require(["google-docs", "gmail", ...])` ran every app's gate before the script did any work and threw one `ReadGuideFirst` carrying every guide still to read, with a prompt line in the `node`, `python` and `app` descriptions saying to start a multi-app script with it. Six errand trials with it: 6/6, 6.5 steps (4-11), 238K. The model called it in 1 of 6 trials (that one was the intended shape: one throw with all four guides, then done in 4 steps); the other five reran one app at a time as before. Against the six without it (5/6, 6.5 (3-17), 217K) it saved nothing, so it is not in the build. The reruns it was for were real, and the one-stop guide check above reaches them without the agent calling anything.

What the plan had wrong, now corrected above: `app request`'s read-first hands the guide over on stderr and exits 3 with nothing sent (the plan had the guide on stdout, exit 0), and a hand-off counts only once the output shows the printed guide whole; the Node example's `doc.body.id` (an app's request methods return the body); camelCase tool names in Node (`listIssues`; an MCP tool keeps the service's name); `defineAppTool` (no user once the Mac apps are MCP apps); the stub's PATH (the runtime `bin/` is already first on every native command's PATH); and JSON output when stdout is piped (not built: `| jq .field` written against today's output would break).

### Phase 2: the Mac apps

**Done**, as bundled MCP apps on top of phase 1's registry rather than `defineAppTool` capabilities, by the owner's choice; what landed is in [The Mac apps move into Apps](#the-mac-apps-move-into-apps).

**Evals, Claude Haiku 5.5 through OpenRouter, three trials per case.** The Mac apps ran on the stand-in server (`macApps` on a case), so no run touched the real apps or met a macOS prompt, and every case ran in a process of its own, so one case's apps never showed in another's. The asks ran with no Mac app connected, the way a person starts; the follow-through and the tasks with all six connected. Tool calls and tokens are medians (tokens are the run's total, mostly cache reads); cost is summed over the three trials.

| Case | Mac apps | Passed | Tool calls | Tokens | Cost (3 trials) |
| --- | --- | --- | --- | --- | --- |
| reach-script-calendar-card: the agent writes the script | Calendar connected, refused | 3/3 | 1 | 27K | $0.003 |
| reach-script-calendar-card-given: the user's Node script on `instrument.apps` | Calendar connected, refused | 3/3 | 1 | 28K | $0.011 |
| reach-script-calendar-card-python: the user's Python script catching `CardShown` | Calendar connected, refused | 3/3 | 1 | 28K | $0.003 |
| reach-follow-through-reminder | all connected | 3/3 | 3 (2-3) | 90K | $0.008 |
| reach-task-reminders | all connected | 3/3 | 2 | 90K | $0.006 |
| reach-task-notes | all connected | 3/3 | 1 | 59K | $0.005 |
| reach-reminder | none connected | 3/3 | 2 (1-2) | 81K | $0.005 |
| reach-calendar | none connected | 3/3 | 2 | 82K | $0.006 |
| reach-todo | none connected | 3/3 | 2 | 81K | $0.005 |
| reach-send-text | none connected | 3/3 | 1 | 54K | $0.004 |
| reach-control-draft-text | none connected | 2/3 | 1 | 54K | $0.004 |
| reach-control-file | none connected | 3/3 | 1 | 56K | $0.006 |
| reach-task-unconnected-service | none connected | 0/3 | 4 (3-4) | 111K | $0.007 |

What the evals say:

- **The card ends the turn once, on every surface.** In all nine card trials the first call that reached Calendar raised the macOS card: a `list_calendars` look from the shell when the agent wrote the script itself, the Node script's first `add_event` through `instrument.apps`, or the Python script's first `add_event`, which caught `CardShown` and printed its message. The bash call carried the raised ask, the turn ended in that step, and the stand-in saw exactly one call. No trial retried or reached for `osascript`, an `.ics` file or another way in. A script that catches the error and calls again joins the card already up without reaching the server, since macOS is asked before every call and its last answer stands where it can't say now (a unit test).
- **A picked or told Mac app lands through its tool**: `apple-reminders add_reminder` and `apple-notes create_note` in 9 of 9.
- **A connected Mac app answers "where".** With Reminders or Calendar connected, Haiku used it without asking (an earlier run with all six connected: reach-reminder 0/3, reach-calendar 0/3 on the ask-first check), as the prompt's rule says to and as the owner decided to keep. With none connected it asks, 9 of 9.
- **Failures not about the Mac apps' path.** reach-task-unconnected-service puts up Google Calendar's sign-in card in 3 of 3 rather than naming the gap, a behavior the case scores as a failure whatever the wording. reach-control-draft-text puts a `choose` to the user in 1 of 3.
- **Not run:** a baseline on the old `instrument calendar` commands, which reach the real apps and would raise macOS's prompts on the developer's machine; a second model.

### Phase 3: the rest of `instrument`, and the model tools

- `memory.*`, `window.*`, `task.*`, `x.*` and the app setup words as capabilities with generated CLI surfaces, roles from the registry instead of `CHAT_ONLY_SUBCOMMANDS`.
- `web.fetch`, `web.search` and `images.generate` get a script surface beside their model tool, from one definition; `read_file`, `write_file`, `edit_file` and the turn-enders move onto `defineCapability` with `surfaces.tool` only, so a model tool is no longer a separate style.
- **Deleted:** `defineSubcommands` and `subcommand()`; `setupTool` folds into `defineCapability`.
- **Evals:** the memory, task-sessions, task-tabs and web-search suites rerun; a scripted fan-out over `web.fetch` against loopback pages. `--bash-only` and `scriptedCalls` from phase 1 carry over.

Built in the first part:

- **Every model tool is a capability.** `bash`, `read_file`, `write_file`, `edit_file`, `load_skill`, `ask_permission`, `connect_app`, `choose`, `web_fetch`, `web_search`, `generate_image` and the `unavailable` stand-in are each a `defineCapability` with `surfaces.tool`, built into the AI SDK tool by `modelTool()` ([`capabilities/tool.ts`](../../packages/workspace/src/lib/capabilities/tool.ts)). `setupTool` and `tools/create-tool.ts` are deleted. A tool's name, description and input JSON Schema are what they were byte for byte: [`tool-definitions.test.ts`](../../packages/workspace/src/tools/tool-definitions.test.ts) snapshots the serialized list for a text model and a vision model, was written before anything moved, and passed unchanged through every step. A chat and its tasks are sessions of one agent whose tools are built from the model and the chat alone, so a task's list is its chat's.
- **Roles refuse at the call, on every surface.** `where.roles` with `where.roleRefusal` (the words a left-out role hears, naming what to do instead) is checked by one function (`unavailableReason`, [`capabilities/admit.ts`](../../packages/workspace/src/lib/capabilities/admit.ts)) for the command line, a script and a model tool. `choose` and `connect_app` are `roles: ["chat"]` with the refusals they wrote themselves before; a task's `connect_app` is a failed call carrying that message, where it was a card result with a failure row per app. The window command's split (a task may run `window list|read` and `memory list|show`) is a `roles` per capability with its `roleRefusal`, and the dispatcher already refuses per capability rather than per command.
- **`web.fetch`, `web.search`, `images.generate` reach scripts.** One definition each, with the tool's own `execute` beside a `run` for the script: `instrument.web.fetch(url)` (or an object of fields), `instrument.web.search(query)`, `instrument.images.generate(prompt, file_path=...)`, in Node and Python. A script's call runs the tool's work (the redirect checks and Markdown conversion, the search backends, the image's folder rules) and gets data back or `instrument.Error` with the tool's sentence; it records no part, so a fetch past its size is cut and says so, with no spill file. Python reaches any namespace the shell describes and spells every parameter in snake_case; the dispatcher takes either spelling of a field. No CLI surface: `curl` is the shell's fetch.
- **`instrument app` and `instrument x` are generated whole.** `x.search`, `x.thread` and `apps.catalog`, `new`, `test`, `guide`, `icon`, `account`, `disconnect` are capabilities ([`capabilities/apps-setup.ts`](../../packages/workspace/src/lib/capabilities/apps-setup.ts), [`capabilities/x.ts`](../../packages/workspace/src/lib/capabilities/x.ts)); each word's synopsis, flags and a line per flag come from its schema, and every word takes `--json` and `--out`. `x.*` is on the script surface (`instrument.x.search("rust", by=["sam"])`; `by` is `--from`, since `from` is a Python keyword). App setup is not, `guide` included: a guide reaches the model only through the printed output of a bash call, which `instrument app guide` gives and a script's first request already throws as `ReadGuideFirst`, and the same capability writes a guide, which is setup.
- **The prompt names the script calls in its scripts section**, since the `node` and `python` lines of the bash description are part of the cached tool list.

Built in the second part, on top of the window command:

- **`instrument memory`, `window` and `task` are generated whole.** `memory.list|show|save|forget` ([`capabilities/memory.ts`](../../packages/workspace/src/lib/capabilities/memory.ts)), `window.list|show|read|close|request` ([`capabilities/window.ts`](../../packages/workspace/src/lib/capabilities/window.ts)) and `task.new|send|stop|list|log` (one module each in [`capabilities/task/`](../../packages/workspace/src/lib/capabilities/task/), moved from `shell-commands/task/` with the work they did) are capabilities, so every `instrument` word but the top-level listing comes from the registry, each with `--json` and `--out`. Text output is what it was; `--json` gives new shapes (`memory list` as `[{name, day, learned_in, headline}]`, `window list` with each tab's task, `task list` as `{tasks, omitted, total}`).
- **The role split is registry data.** Each capability's `where.roles` and `roleRefusal` say what a task may run and what it hears otherwise, the decision record's words: `memory save|forget` "only the chat saves and forgets memories. Say in your report what the chat should remember or forget."; `window show|close|request` "only the chat changes the window. To open a page to work in, use `agent-browser tab new <url>`; say in your report what the chat should show."; every `task.*` "only the chat starts and steers tasks. Do the work here, and say in your report what is left." A command with nothing for the role (a task's `task`) is left out of `instrument`'s listing and answers every form, its usage too, with that refusal (`commandRefusal` in [`capabilities/cli.ts`](../../packages/workspace/src/lib/capabilities/cli.ts)). `CHAT_ONLY_SUBCOMMANDS`, `instrument`'s `missing`, the role branches that built a task's shell without `task`, and `MemoryCommandContext`'s and `createWindowCommand`'s own role checks are gone.
- **The generator learned what these needed:** a last positional list that takes every word left (`window show a b`, `task stop t1 bg_1`), a bare subcommand (`instrument memory` lists), the heredoc in the synopsis of every field read from stdin, and a refusal of words beside a field given on stdin, which `task new` had alone and every such field now has. The context carries the shell's layout (a tab on a file outside it is not read), what is at a path the command line names (`window show <path>`), and the bash call's remaining yield (`task stop` waits inside it).
- **Deleted:** `defineSubcommands`, `subcommand()`, `runSubcommand` and `shell-commands/subcommands.ts`. The argv reader moved as it was into [`capabilities/argv.ts`](../../packages/workspace/src/lib/capabilities/argv.ts), the one piece the generator needs, and a refused flag or word shows the one form its subcommand takes rather than the command's whole usage. Nothing else used it: the `agent-browser` wrappers parse their own arguments for the real program, so they stay as they are.
- **The tool definitions did not move a byte**: `tool-definitions.test.ts` passed unchanged at every step, since `MEMORY_COMMAND`, `WINDOW_COMMAND` and `TASK_COMMAND`, which the bash description is written from, stay as they were.

**The script surface, per capability**, argued from the code:

| Capability | Script | Why |
| --- | --- | --- |
| `memory.list`, `memory.show` | yes, both roles | reads with nothing to ask; a script that writes for the person (a draft in their voice, a schedule in their time zone) reads what is remembered as data rather than parsing `memory list` |
| `memory.save`, `memory.forget` | no | a memory is one deliberate fact written to the user in a sentence, with no fan-out a script would serve, and each records a setup change the bash call reports; the secret check would hold in a script too, so this is about intent rather than safety |
| `window.list`, `window.read` | yes, both roles | reads; `read` is held to the chat's folders on both sides of the read wherever it is called, so a script reaches no page the shell would not |
| `window.show`, `window.close` | no | each puts something in front of the person or takes it away, which a loop in a script would do unseen and many times |
| `window.request` | no | it raises a card and ends the turn; a script that caught the error would keep running past a turn that is over |
| `task.new`, `task.send`, `task.stop`, `task.list`, `task.log` | no | turn and session management: a fork carries on from the bash call that started it (`forkPoint` reads the call's part), `stop` waits inside the call's yield, and the wake that reports a finish is the chat's, none of which a script's call has |

The script runtimes needed no change: they reach any namespace the describe answer lists, so `instrument.memory.list()` and `instrument.window.read("tab_…")` work in Node and Python for the role that has them, and the Python module's docstring names them.

**Evals of the second part, Claude Haiku 5.5 through OpenRouter, three trials per case**: the memory, task-sessions, task-tabs and window-tabs suites on main, on the window command just before this part (the stack's tip), and on this part. Each cell is trials passed, the chat's model steps as a median with their range, and the run's total tokens (the chat and its tasks) as a median. main's window-tabs cases are its own, written for `instrument tab`; the stack rewrote them for `instrument window`, and two task-session cases are new there. Five trials of this part's run died on a timeout fetching OpenRouter's model list before they started and were run again on their own.

| Case | main | Window command (before) | Phase 3 |
| --- | --- | --- | --- |
| memory-keeps-a-fact-inside-an-ask | 3/3, 2 (2-4), 73K | 3/3, 2 (2-3), 59K | 3/3, 3 (2-6), 103K |
| memory-keeps-a-standing-fact | 3/3, 2 (2-2), 56K | 3/3, 2 (2-2), 55K | 3/3, 2 (2-2), 55K |
| memory-keeps-an-unflagged-preference | 1/3, 1 (1-2), 28K | 2/3, 2 (1-2), 55K | 2/3, 2 (1-2), 55K |
| memory-keeps-what-a-task-reported | 0/3, 4 (2-12), 159K | 0/3, 6 (3-9), 239K | 0/3, 5 (3-5), 189K |
| memory-saves-before-the-work | 3/3, 5 (4-5), 218K | 3/3, 4 (3-4), 163K | 3/3, 4 (3-5), 166K |
| task-session-folder-card | 0/3, 1 (1-1), 116K | 0/3, 1 (1-2), 114K | 1/3, 1 (1-1), 114K |
| task-session-folder-card-answered | not on main | 3/3, 1 (1-1), 353K | 3/3, 1 (1-2), 352K |
| task-session-needs-a-pick | not on main | 2/3, 1 (1-2), 314K | 3/3, 1 (1-1), 257K |
| task-session-start | 3/3, 1 (1-1), 147K | 3/3, 1 (1-2), 174K | 3/3, 1 (1-2), 144K |
| task-session-steer | 0/3, 2 (2-3), 184K | 0/3, 2 (2-2), 216K | 0/3, 2 (2-3), 182K |
| task-session-stopped-then-asked | 3/3, 4 (4-4), 140K | 3/3, 3 (3-4), 111K | 3/3, 3 (3-3), 111K |
| task-session-tab | 0/3, 5 (3-7), 145K | 0/3, 6 (4-6), 174K | 0/3, 4 (4-5), 143K |
| task-session-timed-out | 3/3, 1 (1-2), 317K | 3/3, 1 (1-1), 245K | 3/3, 1 (1-2), 186K |
| task-tabs-compare | 0/3, 3 (3-3), 86K | 3/3, 3 (3-3), 94K | 3/3, 4 (3-5), 131K |
| task-tabs-single-page | 3/3, 3 (2-4), 84K | 3/3, 2 (2-2), 54K | 3/3, 4 (3-4), 110K |
| window-tabs-close-named | 3/3, 2 (2-2), 56K | 3/3, 2 (2-2), 55K | 3/3, 2 (2-2), 55K |
| window-tabs-hands-open-page | 0/3, 9 (6-12), 301K | 0/3, 7 (5-9), 274K | 0/3, 9 (9-10), 372K |
| window-tabs-new-page | 3/3, 6 (4-8), 242K | 3/3, 9 (5-15), 418K | 3/3, 7 (7-10), 334K |
| window-tabs-result-on-a-page | 0/3, 12 (6-12), 739K | 0/3, 11 (6-13), 603K | 0/3, 8 (7-13), 434K |
| window-tabs-show-open | 3/3, 2 (2-2), 56K | 3/3, 2 (2-2), 55K | 3/3, 2 (2-2), 55K |
| window-tabs-show-result | 0/3, 4 (4-4), 119K | 3/3, 4 (4-4), 116K | 3/3, 4 (4-4), 116K |
| window-tabs-their-page | 3/3, 5 (2-6), 153K | 3/3, 2 (2-2), 66K | 3/3, 2 (2-3), 66K |
| window-tabs-their-tab-as-it-stands | 3/3, 1 (1-1), 28K | 3/3, 1 (1-1), 28K | 3/3, 1 (1-1), 28K |

The three runs cost $0.30, $0.32 and $0.31, and passed 37 of 63, 49 of 69 and 51 of 69 trials.

What it says:

- **Moving `memory`, `window` and `task` onto the registry changed nothing the suites see.** Every case passes as often as on the window command or once more (folder-card 0/3 to 1/3, needs-a-pick 2/3 to 3/3, both within what three trials vary by), and none fewer. The five cases that fail every trial on both fail the same assertions on both (task-session-tab also missed its file once here): they are about what the model does (whether a follow-up lands while the work runs, which tab it hands a task, whether it links its result), not about the command.
- **The task refusal is the same, and still recovered from.** The only role refusals in either run are in task-tabs-compare, three trials each: the task ran `instrument window show`, heard "only the chat changes the window. To open a page to work in, use `agent-browser tab new <url>` …", and opened its pages itself, 3/3 both times (main, with "only the chat has this", 0/3). No task ran `instrument task` or `memory save` in either.
- **Steps and tokens move within run-to-run variance**: task-tabs-single-page took 4 steps where it took 2 because the task read the page with `web_fetch` twice rather than once, a choice of the model's with no refusal in it; window-tabs-result-on-a-page and timed-out came down by about as much the other way.
- **No case exercises the script surface for memory or the window**: none asks for a script, and no trial wrote one. That `instrument.memory.list()` and `instrument.window.read()` work in a task's script, and that the chat-only capabilities are not on it, is a unit test (`role-split.test.ts`).

What the plan had wrong in the second part: deleting `defineSubcommands` leaves an argv reader, since a generated command still reads flags off the command line; it is the generator's own now (`capabilities/argv.ts`) rather than a framework a command could be hand-written on. And the role split needed nothing in the dispatcher: the first part's `where.roles` already refused per capability, so the second part is data and deletions.


**Evals, Claude Haiku 5.5 through OpenRouter, three trials per case**, measured as phase 1 was (model steps and the trial's total tokens as medians, steps with their range, cost summed over the trials). The web-scripting cases ([`web-scripting.ts`](../../packages/workspace/evals/cases/web-scripting.ts)) serve a store's catalog of 15 product pages and four release-note pages on loopback: the fan-out asks for the three cheapest products and the ones that ship free, the Python case asks for a script that works that out, and the two-ways case gives four release-note URLs, where a fetch per page and one script both make sense, and passes only when no page was fetched both ways and no script call misfired.

| Case | With scripts (prompt line in the scripts section) | With scripts (line in the tools section) | Bash-only arm | How the pages were read |
| --- | --- | --- | --- | --- |
| Fan-out over 15 pages | 2/3, 5 (5-6), 183K, $0.023 | 3/3, 6 (4-6), 252K, $0.026 | 3/3, 5 (3-7), 195K, $0.018 | `curl` in a bash loop in 8 of the 9 trials, `web_fetch` 16 times in parallel in one; the miss left one free-shipping product out |
| Python script over the pages | 3/3, 11 (10-12), 452K, $0.038 | 3/3, 9 (9-10), 371K, $0.034 | 3/3, 10 (7-12), 384K, $0.027 | `curl` to save the pages and Python's own `urllib` or regex over them in 9 of 9; no `instrument.web` |
| Two ways (4 pages) | 3/3, 4 (2-5), 122K, $0.016 | 3/3, 5 (2-5), 151K, $0.017 | 3/3, 4 (2-5), 120K, $0.009 | one path every trial: four parallel `web_fetch` calls (3 of 9) or `curl` (6 of 9); no page fetched both ways, no misfire |

An earlier run of the fan-out and two-ways cases, with the first wording and the same pages, went the other way in both arms: `web_fetch` 16 times in one step in 6 of 6 fan-outs (script arm 4 (4-4), 145K; bash-only 5 (4-5), 172K) and four `web_fetch` calls in 6 of 6 two-ways trials (3 (2-3), 92K and 91K). With pages a fraction of a store page's size, every trial curled and grepped them in two bash calls (87K).

The web-search suite, rerun: 24/24, every one of the 15 searches through the `web_search` tool and none from a script; the three questions that need no search made none.

What it says:

- **Haiku never reached for `instrument.web.*`**: 0 of 18 script-arm trials, under either wording, and the Python case wrote its own fetching each time. It reads loopback pages with `curl` or `web_fetch`, and which one varies run to run more than between arms, so the script surface for the web makes no difference to it here. The bash description's line that `curl` reaches localhost likely pulls these loopback pages to `curl`; pages on a public host, and a stronger model, are the open measurements.
- **Two ways did not confuse it.** Every trial kept to one path, with no page fetched twice and no misfired script, in all 18 trials across both arms; the worry this case was written for did not show on Haiku, where the second way is simply not taken.
- **The generated `instrument app` holds up.** The phase 1 Lantern cases, rerun against it: the fan-out 3/3, 4 (4-8), 120K, a script in 2 of 3 (phase 1: 3/3, 4 (3-4), 117K, a script in 3 of 3; the third trial looped `app request` in bash, 252K); the Python fan-out 1/1, 4 steps, 121K, through `instrument` (phase 1: 4 (3-4), 121K); the single lookup 1/1, 3 steps, 87K, two plain requests (phase 1: 3, 87K).

What the plan had wrong, now corrected above: "turn-enders stay off the script surface" needed no rule, since a tool-only capability has no script surface to give it; a model tool keeps its own recorded output shape rather than taking the capability's `output` and `text`, because sessions on disk keep every shape a tool has had; a capability with a gate cannot have a tool surface (`modelTool` refuses to build one), since a gate's answers are exit codes and exceptions; the dispatcher's registry cannot list the tool-only capabilities, since `bash`'s imports the shell, which imports the dispatcher, so `tools/all.ts` lists what the model calls and the registry what a command or a script calls; and `defineSubcommands` stayed until `memory`, `window` and `task` moved (below).

## Final eval pass

One pass over the whole stack, on its last commit, to see how each surface holds up on a second model and whether more than one way to do a thing confuses either. Claude Sonnet 5.5 and Claude Haiku 5.5, both through OpenRouter, three trials per case, every case in an invocation of its own and every trial in a process and home of its own. Each cell is trials passed, model steps as a median with their range, the trial's total tokens as a median (the chat and its tasks for chat cases), and the billed cost summed over the three trials. Haiku was rerun on the scripting and reach cases, whose numbers predate phase 3's generated `instrument app`, its scripts section in the prompt and the task's refused `connect_app`; its memory, window, task and web numbers were measured on this commit's code in phase 3 and are not repeated. The Sonnet cost of a case is ten to fifteen times Haiku's for the same tokens; compare tokens across models and cost within a model. Sonnet's Beacon single lookup ran its three trials at once, each writing the prompt cache cold, so its $0.197 is about twice what it would cost run in turn.

The surface counts come from the transcripts: a script is a `node` or Python run (inline, a heredoc or a file from `write_file`) that calls `instrument`; CLI calls are `instrument app call` and `request` commands; "redone" counts trials that fetched again through the CLI something a script had already fetched.

**The scripting cases, with the script channel and with `--bash-only`:**

| Case | Model | Script arm | Bash-only arm | How the script arm made the calls |
| --- | --- | --- | --- | --- |
| Beacon fan-out (MCP) | Haiku | 3/3, 4 (4-5), 119K, $0.011 | 3/3, 8 (7-10), 251K, $0.017 | a Python script in 3/3, after at most one `app call` to see the shape |
| | Sonnet | 3/3, 4 (4-6), 114K, $0.134 | 3/3, 5 (5-7), 146K, $0.221 | a Python script in 3/3; one trial then rechecked its counts with `app call` in a loop (redone) |
| Beacon join (MCP) | Haiku | 3/3, 5 (5-6), 144K, $0.010 | 3/3, 5 (5-8), 145K, $0.012 | a script in 3/3 (Node 1, Python 2) |
| | Sonnet | 3/3, 4 (4-4), 114K, $0.110 | 3/3, 7 (4-10), 212K, $0.193 | a Python script in 3/3 |
| Beacon single lookup (MCP) | Haiku | 3/3, 4 (4-4), 112K, $0.006 | 3/3, 4 (4-4), 109K, $0.006 | two `app call`s, no script, 3/3 |
| | Sonnet | 3/3, 4 (4-4), 111K, $0.197 | 3/3, 4 (4-4), 109K, $0.087 | two `app call`s, no script, 3/3 |
| Lantern fan-out (API) | Haiku | 3/3, 4 (3-4), 116K, $0.008 | 3/3, 10 (7-14), 307K, $0.020 | a Python script in 3/3, after one or two `app request`s |
| | Sonnet | 3/3, 3 (3-4), 85K, $0.101 | 3/3, 5 (5-6), 145K, $0.156 | a script in 3/3 (Node 2, Python 1), no `app request` |
| Lantern join (API) | Haiku | 3/3, 3 (3-3), 87K, $0.007 | 3/3, 4 (4-5), 122K, $0.010 | a Python script in 3/3, after one to three `app request`s |
| | Sonnet | 3/3, 3 (3-3), 84K, $0.089 | 3/3, 6 (5-8), 177K, $0.187 | a Python script in 3/3; one stopped once by `ReadGuideFirst` |
| Lantern single lookup (API) | Haiku | 3/3, 3 (3-3), 85K, $0.006 | 3/3, 3 (3-3), 84K, $0.006 | two `app request`s, no script, 3/3 |
| | Sonnet | 3/3, 3 (3-3), 85K, $0.081 | 3/3, 3 (3-3), 83K, $0.080 | two `app request`s, no script, 3/3 |
| Python fan-out over Lantern | Haiku | 3/3, 4 (3-4), 116K, $0.009 | 3/3, 9 (9-10), 280K, $0.019 | `import instrument` in 3/3 |
| | Sonnet | 3/3, 4 (4-4), 114K, $0.119 | 3/3, 9 (8-9), 281K, $0.261 | `import instrument` in 3/3; one then rechecked two issues with `app request` (redone) |
| Python fan-out over Beacon | Haiku | 3/3, 6 (6-6), 180K, $0.012 | 3/3, 11 (9-13), 351K, $0.023 | `import instrument` in 3/3; each then fetched one issue with `app call` to debug the script and reran it (redone) |
| | Sonnet | 3/3, 5 (4-9), 144K, $0.168 | 3/3, 8 (7-9), 243K, $0.249 | `import instrument` in 3/3 |
| Google errand (4 API apps) | Haiku | 3/3, 5 (3-13), 155K, $0.018 | 3/3, 9 (8-10), 301K, $0.020 | a Node script in 2/3; the 13-step trial made all 21 requests with `app request` and wrote no script |
| | Sonnet | 3/3, 5 (5-5), 152K, $0.174 | 3/3, 10 (10-11), 329K, $0.313 | a script in 3/3 (Node 1, Python 2), each stopped once by `ReadGuideFirst`, no `app request` |

How the bash-only arm made the calls, both models: `app call` or `app request` only, in bash loops, with pages saved to files. A Python script that ran `instrument` as a program and heard "not found" in 10 of Haiku's 27 trials and 14 of Sonnet's 27, all 12 Python-case trials among them; `curl` to the key-less stand-in in 5 Haiku and 3 Sonnet trials. In the script arm neither model ran `instrument` as a program or curled a stand-in in any trial.

**The phase 2 reach cases** (model steps, where phase 2's table counted tool calls). `reach-task-unconnected-service` is rescored with the fix below; it read 1/3 on Sonnet and 0/3 on Haiku as run.

| Case | Haiku | Sonnet |
| --- | --- | --- |
| reach-script-calendar-card | 3/3, 1 (1-1), 28K, $0.003 | 3/3, 1 (1-1), 28K, $0.047 |
| reach-script-calendar-card-given | 3/3, 1 (1-1), 28K, $0.003 | 3/3, 1 (1-1), 28K, $0.053 |
| reach-script-calendar-card-python | 3/3, 1 (1-1), 28K, $0.003 | 3/3, 1 (1-1), 28K, $0.053 |
| reach-follow-through-reminder | 3/3, 3 (2-3), 92K, $0.007 | 3/3, 3 (2-3), 91K, $0.090 |
| reach-task-reminders | 3/3, 3 (3-3), 91K, $0.006 | 3/3, 3 (2-3), 91K, $0.089 |
| reach-task-notes | 3/3, 2 (2-2), 60K, $0.005 | 3/3, 2 (2-2), 60K, $0.077 |
| reach-reminder | 3/3, 3 (2-3), 82K, $0.005 | 3/3, 3 (3-3), 82K, $0.070 |
| reach-calendar | 3/3, 3 (2-3), 83K, $0.005 | 3/3, 3 (3-3), 82K, $0.075 |
| reach-todo | 3/3, 3 (3-3), 83K, $0.005 | 3/3, 3 (3-3), 82K, $0.070 |
| reach-send-text | 3/3, 2 (1-3), 55K, $0.004 | 3/3, 3 (3-3), 82K, $0.077 |
| reach-control-draft-text | 2/3, 2 (1-2), 55K, $0.004 | 3/3, 1 (1-1), 27K, $0.041 |
| reach-control-file | 3/3, 2 (2-2), 57K, $0.006 | 3/3, 3 (2-3), 84K, $0.096 |
| reach-task-unconnected-service | 1/3, 3 (3-3), 84K, $0.006 | 3/3, 4 (4-4), 111K, $0.090 |

**The phase 3 memory, task and window cases**, Haiku from the phase 3 run above:

| Case | Haiku | Sonnet |
| --- | --- | --- |
| memory-keeps-a-fact-inside-an-ask | 3/3, 3 (2-6), 103K | 3/3, 4 (3-5), 151K, $0.145 |
| memory-keeps-a-standing-fact | 3/3, 2 (2-2), 55K | 3/3, 2 (2-2), 55K, $0.059 |
| memory-keeps-an-unflagged-preference | 2/3, 2 (1-2), 55K | 3/3, 2 (2-2), 55K, $0.062 |
| memory-keeps-what-a-task-reported | 0/3, 5 (3-5), 189K | 0/3, 7 (6-10), 280K, $0.293 |
| memory-saves-before-the-work | 3/3, 4 (3-5), 166K | 3/3, 4 (3-5), 168K, $0.246 |
| task-session-folder-card | 1/3, 1 (1-1), 114K | 0/3, 1 (1-2), 112K, $0.100 |
| task-session-folder-card-answered | 3/3, 1 (1-2), 352K | 3/3, 1 (1-1), 287K, $0.221 |
| task-session-needs-a-pick | 3/3, 1 (1-1), 257K | 0/3, 1 (1-1), 281K, $0.191 |
| task-session-start | 3/3, 1 (1-2), 144K | 2/3, 1 (1-1), 113K, $0.132 |
| task-session-steer | 0/3, 2 (2-3), 182K | 0/3, 2 (2-2), 175K, $0.256 |
| task-session-stopped-then-asked | 3/3, 3 (3-3), 111K | 3/3, 3 (3-3), 110K, $0.090 |
| task-session-tab | 0/3, 4 (4-5), 143K | 0/3, 4 (2-4), 285K, $0.253 |
| task-session-timed-out | 3/3, 1 (1-2), 186K | 3/3, 1 (1-1), 572K, $0.679 |
| task-tabs-compare | 3/3, 4 (3-5), 131K | 3/3, 4 (4-5), 121K, $0.175 |
| task-tabs-single-page | 3/3, 4 (3-4), 110K | 3/3, 4 (4-4), 111K, $0.116 |
| window-tabs-close-named | 3/3, 2 (2-2), 55K | 3/3, 2 (2-2), 55K, $0.058 |
| window-tabs-hands-open-page | 0/3, 9 (9-10), 372K | 0/3, 11 (3-13), 509K, $0.519 |
| window-tabs-new-page | 3/3, 7 (7-10), 334K | 3/3, 6 (4-7), 234K, $0.324 |
| window-tabs-result-on-a-page | 0/3, 8 (7-13), 434K | 0/3, 19 (8-23), 1009K, $1.015 |
| window-tabs-show-open | 3/3, 2 (2-2), 55K | 3/3, 2 (2-2), 55K, $0.056 |
| window-tabs-show-result | 3/3, 4 (4-4), 116K | 3/3, 4 (4-5), 115K, $0.133 |
| window-tabs-their-page | 3/3, 2 (2-3), 66K | 3/3, 3 (2-5), 103K, $0.170 |
| window-tabs-their-tab-as-it-stands | 3/3, 1 (1-1), 28K | 3/3, 1 (1-1), 28K, $0.048 |

Sonnet passed 47 of 69 trials there, Haiku 51 of 69. **The web-scripting cases on Sonnet**: the fan-out over 15 pages 3/3, 6 (4-8), 183K, $0.204; the Python script over the pages 3/3, 10 (9-13), 367K, $0.407; two ways 3/3, 2 (2-2), 58K, $0.086. Sonnet read the pages with `curl` in 9 of 9 trials, after one `web_fetch` of the catalog in 2; one fan-out trial called `instrument.web.fetch` for all 15 pages, treated the answer as a string, failed on a `KeyError`, and fetched the 15 pages again with `curl`. No two-ways trial fetched a page twice.

Two eval-case fixes came out of the pass. `reach-task-unconnected-service` scored a reply naming the gap by a list of phrasings that predates the task's refused `connect_app`, which tells a task to end with a needs fence naming the app; a reply ending in that fence now counts, the service still named. And the scripting cases' evidence line told a script's runtime from its JSON-escaped input, so a heredoc Python script was counted as Node; the counts above are from the transcripts.

What it says:

- **Haiku reaches for scripts.** With the channel, it wrote a script in 20 of 21 multi-call trials and none of the 6 single lookups, mostly in Python even where nobody asked for Python. The one exception was an errand trial that made all 21 requests one `app request` at a time and still passed. Sonnet wrote a script in 21 of 21 and none of the 6, so the two models split the work the same way.
- **Scripts save tokens on both models, and more on Sonnet's bill.** Against the bash-only arm, the script arm took about half the tokens on every multi-call case but the Beacon join on Haiku (equal): Haiku's Lantern fan-out 116K against 307K, the errand 155K against 301K; Sonnet's Lantern join 84K against 177K, the errand 152K against 329K. The single lookups cost the same either way. At Sonnet's price that is $0.17 against $0.31 for the errand. Haiku's script arm has improved on the Beacon fan-out since phase 1 (6 steps and 186K then, 4 and 119K now); its bash-only arm moved both ways within its usual spread (the Lantern fan-out 307K against 223K, the Python fan-out over Beacon 351K against 451K).
- **Without the channel, both models still try a script first.** In the bash-only arm a Python script that runs `instrument` as a program and fails was the first move in 10 of Haiku's and 14 of Sonnet's 27 trials, and some curled the stand-in. Sonnet tries it more often than Haiku, on non-Python cases too. The channel is what turns that instinct into a working path.
- **More than one way caused little confusion, but some redone work.** No trial in either arm mixed surfaces for the same items as its main path. The doubling that did happen came after a script had already answered: Haiku fetched one issue through the CLI to debug its Python script in 3 of 3 Beacon Python trials, and Sonnet rechecked a script's counts through the CLI in 2 trials. The one real misfire was Sonnet guessing the return shape of `instrument.web.fetch` and then fetching every page again with `curl`, which suggests the web call's answer shape is the least obvious surface.
- **Sonnet follows the task's needs fence where Haiku does not.** On `reach-task-unconnected-service` both models ran `instrument app new google-calendar --web ...` from the task, which writes the app's setup, then met the refused `connect_app`. Sonnet ended with a needs fence naming Google Calendar in 3 of 3. Haiku did in 1 of 3; in the other 2 it told the user a sign-in card was up when none was.
- **Sonnet's other differences are about where it puts files and how long it works.** It failed `task-session-needs-a-pick` 3 of 3 (Haiku 3 of 3 passed) and `task-session-start` once because its task saved the file outside the two folders the case reads (the chat's folder and the person's): in the chat's work folder, in the two trials whose reply names the path. That is how it read "the workspace folder"; Haiku saved where the case reads. It spent the most on the window cases that already fail on Haiku: `window-tabs-result-on-a-page` took 19 steps and 1M tokens at the median.

Not run: the bash-only arm of the web-scripting cases, and Sonnet on the bash-only arm of anything but the scripting cases. The pass cost $10.17 billed: Sonnet $9.89 (scripting $2.92 across both arms, reach $0.93, web $0.70, phase 3 $5.34), Haiku $0.28.

## Open questions for the owner

None open. The owner's answers are in [Decisions](#decisions).
