# Workspace package

Core AI agents, workflow logic, RPC, and tools.

## Structure

- **RPC**: Router in `src/rpc/index.ts`. Handlers in `src/rpc/routes/`. Base and `toORPCError` in `src/rpc/base.ts`. Exposed to Studio as `workspaceRouter` via `@instrument-org/workspace/electron`.
- **Streaming**: every `eventIterator` procedure goes under `live.*` (snapshot on subscribe, then updates) or `events.*` (fires only on change), and nothing else does. A `live.*` mirror of a non-live procedure shares its leaf name: `chats.info` / `chats.live.info`. A live view of records re-reads on `recordChanges` (`lib/record-changes.ts`), which the write layers publish; do not add a topic or a hand publish for a record write.
- **Tools**: `src/tools/`. Build with `setupTool()` from `create-tool.ts`; register in `all.ts`. Fallible logic returns a `Result`; map it to tool output, or throw for oRPC.
- **Result library**: the repo's standard is `typescript-result` (the `typescript-result` skill), as in `packages/ai-gateway`. Code here that composes with functions still returning neverthrow's `Result` (`Store`, the shell commands, tools) stays on neverthrow rather than converting at every call; a module with no such neighbors uses `typescript-result`.
- **Agents**: one agent, `instrument` (`src/agents/instrument.ts`, wired by `create-agent.ts`, its tools picked from `TOOLS`), runs every chat and task session. In a chat it does quick work itself with every tool, and `task new` (`src/lib/shell-commands/task/fork.ts`) forks it into a task: a session in the chat's own store (`src/lib/chat/children.ts`) whose parent is the chat's, which reads the chat's messages up to where it forked as its own history rather than a copy (`Store.getMessagesWithParts`), works in the chat's folder, and wakes the chat when it finishes (`src/lib/chat/wake.ts`). The `task` command (`src/lib/shell-commands/task/command.ts`, one module per subcommand on `defineSubcommands`) is `new`, `send`, `stop`, `list`, `log`, and `folder`, and takes a task by its handle in the chat (`t1`). A user message mid-turn joins the running turn at its next step (`src/lib/chat/mid-turn.ts`), every tool call carries `activity` and `explanation`, and the first step of a turn the user typed is sent with a never-stored note (`src/lib/turn-note.ts`).
- **Workspace server**: loopback Hono app in `src/logic/server/index.ts`: the CDP bridge `agent-browser` drives a guest through, and the AI gateway mounted at `AI_GATEWAY_API_PATH` when provided. It serves no files: a page on this computer opens at its `file://` address for the person and the agent alike, and the person's viewers read files through Studio's own `instrument://computer-<token>` channel.
- **Schemas**: `src/schemas/`. Use for RPC/tool I/O where applicable.
- **Machines**: XState in `src/machines/`. `WorkspaceActorRef` is the main-process handle; RPC context gets `workspaceRef` and `workspaceConfig`.
- **Skills**: `src/lib/skills.ts` discovers them across the bundled set, the registry, co-installed agent homes, and the workspace `skills/` dir, deduping symlinks by canonical directory and copies by package fingerprint. `skill-catalog.ts` renders the budgeted catalog, which `available-skills-context.ts` puts in the session's context message (`LoadSkill`'s description is static, so installing a skill never rewrites a tool definition); `validate-skill.ts` holds the rules the runtime enforces. Each skill source mounts at `/skills/<source>/` for the agent, and only the workspace's own (`/skills/workspace/`) is writable (see `docs/architecture/agent-sandbox.md`).
- **Records**: a chat is the only record, and `src/lib/record-folders.ts` is the one answer to where its folder is (`chatDir`, under the config's `chatsDir`). `resolveChat(id)` says whether an id is a chat's, never an id's shape; `chatDir` throws `NotFound` for one that is not. Everything that names a record takes a `ChatId` (`schemas/chat-id.ts`), and a task is named by its session in the chat's store; the chat's session id is internal to its store (`chats.session` reads it, and `chats.ofSession` turns a session from an older address back into its chat). JSON files on disk are written only through `src/lib/json-record-file.ts`.
- **Mount paths**: `src/mount-points.ts` holds `MOUNT`, the virtual paths the agent works in (`/task`, `/skills`, `/mnt`, `/apps`). `/task` is the working folder, the chat's for its tasks too (`workDir`, `src/lib/work-dir.ts`). `/apps` mounts in a chat's own conversation only. Interpolate it into prompts, tool descriptions, and command help rather than typing a path out, so what the agent is told cannot disagree with what it gets; `instrument/no-bare-mount-path` (`oxlint-rules.ts`) fails the lint on a literal anywhere under `src/`.

## Context messages

- `session-context` message (system prompt + `agent.getMessages`) is the session's immutable baseline: written once by `prepare-model-messages.ts` when the session first needs model input, then reused byte for byte, so the request prefix a provider cache is keyed on does not move.
- The single exception is an upgrade, and it comes two ways. A stored system message that differs from the agent's `systemPrompt()` is replaced on the next turn, so a prompt edit reaches every task with no bump. Each stored baseline also carries the `SESSION_CONTEXT_VERSION` it was written under, and one older than the running build's (or from before the marker existed) is replaced the same way. Bump that constant only when a change to the context message `getMessages` writes has to reach tasks that already have a baseline stored. Either way it is rebuilt once, then reused like any other.
- So every `getMessages`-derived value (system date, project instructions, folder list, skill catalog, task layout) is a startup snapshot for the life of the session. A fact that must reach the model later is an **append-only correction**: a persisted `data-*` part rendered onto a user turn (`attached-folder-changes.ts`, `create-browser-status-part.ts`, `date-change.ts`), never an edit to an earlier message. Corrections must be deterministic to render from what is stored, so no live reads or timers during model-message conversion.
- Derive standing values from current state (`getEffectiveProjectContext`) so a value read at baseline time is not pinned to a snapshot that later parts already superseded.
- A correction recorded on an assistant message (`data-maxSteps`, `data-skillChanges`) is carried forward in `SessionMessage.toModelMessages` to the next user turn, since injection only runs for user messages.

## Evals

`pnpm eval` runs the real agent loop against real models (`evals/`, cases in `evals/cases/`). `--model` is required, start on Workers AI, and name the models you ran. The `workspace-evals` skill has the rest; the `validate-changes` skill says whether an eval is the right check at all.

A commit that adds, drops, or reverses a rule for how an agent behaves (its prompt in `src/agents/`, or text a command prints for the model to act on) names the eval case covering that rule in a `Tested:` trailer, with the models it ran on, and adds a case under `evals/cases/` when none covers it. Rewording that keeps the rule is exempt, and so is a change no run could tell apart; say which in the commit. A rule tuned to one transcript and reversed for the next is how prompt churn happens, and a case pinning the behavior is what shows the next reversal what it would undo. Prefer a command refusal to a prompt rule wherever a command can enforce it: refusals hold where prose drifts.

## Seeded workspaces

`scripts/seed-workspace.ts` builds a throwaway app workspace from a committed
description in `fixtures/workspaces/` at the **repo root** (this package's own
`fixtures/` is something else), for `ELECTRON_USER_DATA_DIR`.
`scripts/record-fixture-session.ts` captures a real chat (with every task in it, each a session in its `chat.db`) or a lone 1.x task folder into one.

```bash
pnpm workspace:seed --list                                # from the repo root
pnpm workspace:seed --out <dir> --fixture documents [--fresh]
pnpm --filter @instrument-org/workspace script:record-fixture-session <chat-dir> --fixture <name> --chat <key> [--task-key <handle>=<key>]...
pnpm --filter @instrument-org/workspace script:record-fixture-session <task-dir> --fixture <name> --task <key>
```

The seeder goes through `initializeChat` and `Store`, never the filesystem: a
seeder that lays out `chats/<id>/.instrument` itself would keep producing
workspaces the app can no longer read once storage changes.

The repo-root `fixtures/workspaces/README.md` covers what a fixture holds and how to add one.
