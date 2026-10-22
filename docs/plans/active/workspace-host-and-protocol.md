# The workspace as a host every client attaches to

Status: **proposed, nothing built.** The research and the direction are below. The desktop process split this depends on, a utility child per workspace, is [moving the agent turn off the main thread](agent-turn-off-the-main-thread.md), which owns the transport, the handshake, crash handling and quit. This plan owns everything a client sees across that boundary: the protocol, the command line, several workspaces at once, and a host that runs somewhere other than this computer.

## Goals

One back end, the workspace host, serves every client the same way:

- **The window**, which today calls the workspace in process.
- **A command line**, first for testing and automation, then for people. It is also the proof of the protocol, since it reaches the workspace through nothing else.
- **A phone app**, later, over the internet.
- **A host in the cloud**, later still: a person's chats running on a server in a sandbox, driven from the phone or the desktop, either on our servers or in an environment the person runs.
- **Several workspaces open at once**, each its own host, each window or chat on the workspace it chose.

The protocol is the part to get right first, because the phone and the cloud speak it. The process split is a detail of the desktop host.

## Premises

- **Every launch opens a workspace.** Choosing a workspace folder is the app's first concern at launch, so no host runs without one. A cloud host likewise serves exactly one workspace.
- **One workspace per process.** 107 files under `packages/workspace/src` read the process-wide `getWorkspaceConfig()`. Making the package serve several workspaces from one process (OpenCode's per-directory service map) would mean threading a workspace through all of them; a process per workspace costs memory instead, and isolates a crash to its own workspace. It also maps one to one onto a container per workspace in the cloud.
- **Records are already per device.** A chat's logs, settings and state are one file per device, and synced stores are per-device `set`/`del` lines, newest winning per key. A cloud host is one more device writing its own files, which is why this plan needs no new merge rules for chats.

## What comparable agents do

| | Where the loop runs | How clients attach | A client leaves | A crash mid-turn | Who owns a session |
|---|---|---|---|---|---|
| Codex | one app-server engine | the TUI and `exec` are protocol clients even in process (an embedded transport over in-memory channels); a daemon over a socket; WebSocket for remote | nothing stops; a thread unloads only when idle with nobody subscribed | an open turn is read back as interrupted; the daemon continues it once | a lock file per thread, plus the daemon's socket |
| OpenCode 2.1 | one per-user background service; its Electron desktop attaches to the same service the terminal uses | HTTP with an SSE event feed and a client generated from the API | nothing stops | prompts and tool calls are saved before they act; the elected server continues interrupted sessions at boot | a fixed port plus a user-only registration file |
| Pi Durable | an embedded library, not a server | whatever the host builds on its watch API | not applicable | a checkpoint per step; a tool reruns only if marked safe, otherwise it gets an interrupted result with its partial output | one process per storage, no locking |
| Claude Code on the web, Cursor, Codex cloud | one VM or container per session or task | the vendor's own clients | the session keeps running | the conversation lives outside the VM | the vendor's service |

Two things every one of them does: a client disconnecting never cancels work, and a reconnecting client gets a snapshot then live changes rather than the whole history replayed. None moves a running session between machines; a session moves by forking.

## The protocol

### No open protocol fits whole

| Protocol | What it is | Why not ours whole | Use |
|---|---|---|---|
| ACP v1 (Zed's Agent Client Protocol) | an editor starts the agent over stdio, one client | conversation only, one client, local only | an adapter later |
| ACP v2 | a draft collection: remote HTTP and WebSocket transport, prompts that return once accepted, messages keyed by id sent whole or as chunks, resume with a replay cursor, subagent sessions | still a draft; no several clients per session; reconnecting does not resend what was missed | shape our conversation messages like it; an adapter once it ships |
| AG-UI 1.0 | an event protocol between agent and UI, with snapshots and JSON Patch deltas, interrupts, subagents; the widest adoption | events carry no id or position, so no resuming from a cursor; one run per thread; no capability exchange | match its event names; an adapter later |
| A2A 1.0 | agent to agent, with tasks, subscriptions and push | no vocabulary for a user interface | an adapter, if agents ever call Instrument |
| MCP | tools and resources; sessions were removed from the core | not a session protocol | irrelevant here |
| Codex app-server | JSON-RPC thread, turn and item model with requests from server to client | used only by tools that embed Codex; no neutral owner | copy its design |
| AI SDK UI message stream | the message parts the app already uses, with resumable streams | one active stream per chat, no several clients, no cursor | keep its message parts as our part schema |
| Durable Streams (Electric) | append-only logs read from an offset: snapshot, then tail; several clients; a keyed state layer on top; clients in many languages including Swift | HTTP only; no requests from server to client | take its semantics as our sync layer |

### Layering

1. **Envelope:** JSON-RPC 2.0 with a first `hello` (or `initialize`) that exchanges the protocol version, the build and capabilities. The same messages run over the window's MessagePort, a local socket and a WebSocket. The schema comes from Zod, so the command line and the phone get generated bindings.
2. **Sync:** every subscription is a log with a position. A client asks for a snapshot at a position, then follows from it, and reconnects from the last position it saw. A chat session's log is its records, which are already append-only, so this costs a position, not a redesign. Collections (the chat list, drafts, waiting cards, usage) are keyed records updated by insert, update and delete, as Durable Streams' state layer does. Chat updates already send kilobytes rather than the whole thread's megabytes; positions are what make a dropped connection cheap too.
3. **Approvals are records, not calls.** A waiting card is a saved record. Any attached client can answer, the first answer wins, the others see it settled, and a card nobody has answered is there for whoever attaches next. That is Anthropic Managed Agents' model, and it covers zero clients and several clients without special cases. The cards are already saved in the state file. Server-to-client calls are kept for what only one window can do, such as the browser view it draws.
4. **Conversation:** the AI SDK message parts, with event names matched to AG-UI's (text, tool call, activity, reasoning, subagent, interrupt) and message updates keyed by id, sent whole or as chunks, as ACP v2 does. A prompt returns once the message is accepted, not when the turn ends.
5. **Adapters, later:** AG-UI over SSE, ACP v2 once its remote transport and resume settle, A2A for agent to agent. Each is a mapping rather than a translation because of the choices in 4.

### Rules every transport keeps

- **A dropped client detaches; only an explicit stop ends a turn.** Connection death cancels the RPC calls in flight, never a turn, which belongs to the workspace.
- **Commit before publish.** A client is only ever shown what is saved, so a reconnect at a position sees exactly what a live client saw.
- **Blobs travel by content hash, not inline.** Uploads and downloads are their own calls; `blobs/` already names files by content.
- **Nothing of the client's leaks into the host.** A working directory is an argument, never the client's environment, and a token never reaches a tool's environment.
- **Auth is a bearer token on every transport.** Locally it comes from the host's endpoint file; in the cloud the front door checks the account and routes to the host.

### What would change this

- AG-UI adding event ids, attaching several clients to one run, and resuming from a position: then it becomes the conversation layer itself.
- ACP v2 shipping several clients per session and a state update required after resume: reconsider it for the conversation layer.
- An agent-session protocol from a neutral body. None exists; the Agentic AI Foundation hosts MCP, AGENTS.md and A2A, none of which is one.

## The host

### What leaves Electron

The workspace package imports no Electron, and a unit test keeps it that way. What is Electron's is the input main hands the actor at start (`apps/studio/src/electron-main/lib/create-workspace-actor.ts`), about 30 entries:

- **Paths and binaries:** user data, runtime, registry, system skills, uv, pnpm, uutils, the Seatbelt and Mac helpers, known folders.
- **Services:** the browser view manager, trash, the Mac bridge (`finderEntries`, `resolveAlias`, `macAppAccess`, `macosPromptOnScreen`), provider configs and token refresh, the signed-in user, web search, the model cache, hosted feature checks, refusal reporting, the output folder icon.

Each service becomes an interface declared once, with a desktop implementation (in main, reached over the boundary), a headless one (answers that it needs the app) and a cloud one. In the cloud, provider keys never enter the sandbox: the front door adds them to outbound requests.

### Three seams that keep the cloud from being a rewrite

1. **Log storage behind one interface:** append, read from a position, and a transaction. JSONL on this computer; a database the cloud's front door owns when the host's disk can vanish.
2. **Tools behind an executor interface**, apart from the agent loop. The bash worker is most of this already: commands are posted to it, and only the commands that act on main's state come back (`MAIN_THREAD_COMMANDS`).
3. **Intent before effect.** A tool call is saved before it runs, and each tool says whether it is safe to run again. After a crash, a call that is not safe gets an interrupted result carrying its partial output instead of running twice. A supervisor that restarts a dead host makes this routine rather than rare.

### Ownership

Two hosts must never own one workspace, since each appends to the same device's logs. The open mark (`markWorkspaceOpen` / `openElsewhereBy` in `workspaces.ts`) checks and then writes, so two launches can both pass it.

The host claims its workspace by binding a socket, which is how VS Code, JetBrains and Codex take ownership. The bind succeeding makes it the owner. On `EADDRINUSE` the newcomer connects and says hello; on `ECONNREFUSED` the socket is stale, so it is unlinked and the bind retried once. The socket lives in a short user-only temp folder (`<tmpdir>/instrument-<hash>/`, 0700, the socket 0600) or a named pipe on Windows, never under the machine folder, whose path is close to macOS's 104-byte socket limit. Once listening, the host writes `endpoint.json` (schema version, pid, instance id, build, protocol version, a random token, the endpoint) into the workspace's machine folder through a temp file and a rename, and removes it only while it is still its own. It never goes in the workspace folder, which may sync to another computer, where a pid means nothing. The bind replaces the open mark as the authority.

Every host takes the same claim: the window's child, a windowless launch, a plain-Node `--no-app` host and the eval harness, which already runs the whole workspace in plain Node (`packages/workspace/evals/harness.ts`). A host that skips the claim can write the same records unseen, which is the hole OpenCode's standalone mode has. When a window wants a workspace a `--no-app` host owns, main asks that host to shut down, waits a bounded time and claims the socket.

## The cloud

### What the platform allows

On Cloudflare, only Containers run a full Linux process with native binaries; Workers and Durable Objects run the front door. A container's disk is wiped when it stops, snapshots are taken only when asked for and expire, and a container stays up only while its Durable Object is active, so a turn with no incoming traffic must be kept alive by the Durable Object. Each container is its own VM, and the VM is the security boundary; whether bubblewrap's user namespaces work inside one is unverified, so the cloud sandbox strategy is "none inside the VM" until shown otherwise. Egress can be limited to hosts the front door allows. The published pattern is one Durable Object per session or workspace that starts, stops and snapshots its container, and keeps the state clients read.

### The shape

The first cloud host runs the whole Node workspace in a container and streams its records out to the Durable Object as they are written, so nothing a client has seen depends on the container's disk. With the three seams in place, the agent loop can later move into the Durable Object and the container become only the executor, which lets it sleep between turns; Pi Durable's Durable Object storage is built for that shape.

### What the cloud host has of the workspace

A cloud host is another device of the workspace. Most of the workspace folder syncs to it, but not every chat: the chat it runs, and the chats its tasks fork from. Everything else the agent reaches (Memory, Topics, Skills, Apps, drafts, finished work) must be available to it, fetched on demand if not already there. So the host reads the workspace through a layer that can fetch a file it lacks, rather than assuming the whole folder is on disk.

Moving a chat between this computer and the cloud is a fork into the other place, never a running turn moving.

## The command line

`instrument` is a client of the protocol and nothing else, so it is how the protocol is proven and how much of the app gets tested without a window.

- **It ships inside the app bundle,** running the app's own binary with `ELECTRON_RUN_AS_NODE`, as VS Code's `code` does, so it always knows which `userData` it serves.
- **It finds a workspace** from `--workspace`, else the nearest `.instrument/` above the working directory, else the default, and reads its `endpoint.json`.
- **The wire is the protocol over a WebSocket on the host's socket,** with the token checked at the upgrade. It reaches a router of its own (hello, status, chats, send, a turn's stream, stop, tasks, shutdown) rather than the window's, so window-only routes stay out of reach.
- **The first call is `hello`.** Once an update is staged, the command on disk is newer than the running app, so the command line accepts the current protocol version and the one before it, and otherwise tells the person to restart Instrument.
- **It never runs a tool itself.** Seatbelt, bubblewrap and process-tree reaping stay in the host. It never uses the workspace's HTTP server either, whose gateway half is guarded only by the internal key.
- **With no host running,** it starts the app with no window (`open -g -j` on macOS, a `--headless` flag elsewhere) and attaches once `endpoint.json` appears. Main keeps the secret store, the Mac bridge, trash and a hidden renderer for the browser, so the workspace has everything it has with a window, and one permission identity. A later window launch arrives as `second-instance` and shows a window for the host already running.
- **`--no-app` runs the same host entry in plain Node,** for CI, Linux servers and evals. Credentials come from environment variables or an in-memory store, and each main-only service gets the headless implementation that answers that it needs the app. A shipped path never decrypts the app's `safeStorage` through `security`: once someone picks "Always Allow", every program that can run `security` holds the key. A plain-Node host started from a terminal runs under the terminal's macOS privacy grants, not Instrument's, so it can reach different folders than the app does, and the command line says so.

Not yet checked: whether `ws` connects to a `ws+unix:` address, whether a LaunchServices launch avoids the Keychain prompt that shell launches of the signed app raise, and how Windows pipe ACLs behave between elevated and normal processes.

## Order

Each step ships on its own.

1. **The protocol, served from main.** Define the envelope, the sync positions and the approval records, and serve them from main where the workspace runs today. The window moves its chat streams onto it.
2. **The socket claim and a first command line,** attached to main's host, attaching first, starting the app windowless next, `--no-app` last. Testing gets the command line before any process work.
3. **The process split** (the off-main-thread plan's steps 5 to 7). With the protocol in place, moving the host into a child changes the transport, not the calls.
4. **Several workspaces:** main's remaining singletons become maps keyed by workspace, and a second window starts a second child.
5. **The three seams:** log storage, executor, intent before effect.
6. **A cloud host,** behind the account, with the front door, sync and on-demand files.

## Open questions

- Which of the person's own files at the workspace's top level sync to a cloud host, and what happens when both places change the same file. Chat records cannot conflict; the person's files can.
- What cross-chat search reads in the cloud, where only some chats are present.
- Whether the browser in a cloud host is Chromium inside the container or a browser service beside it.
- Whether a cloud host can reach anything on the person's computer (the Mac bridge, local folders) or only what was synced. The simple answer is only what was synced.
- How a host in an environment the person runs, rather than ours, gets its front door and its keys.

## Related

- [Move the agent turn off the main thread](agent-turn-off-the-main-thread.md): the desktop process split, its transport and lifecycle.
- [Workspace layout](workspace-layout.md): the workspace folder and this computer's machine folder.
- [Choose where Instrument keeps files](choose-where-instrument-keeps-files.md): the folder step every launch now starts from.
- [Chat records](chat-records.md): the per-device logs the sync layer reads from a position.
