# Drop the agent tool in favor of attached-folder mounts

## Context

Attached external folders were reachable only through a `retrieval` sub-agent: the main agent called the `agent` tool, which spawned a specialized agent that searched, read, and copied files from folders outside the task. The `agent` tool was retrieval-only in practice (`TASK_AGENT_NAMES = ["retrieval"]`, with retrieval-shaped descriptions and result summaries) and spawned one agent at a time, awaited serially.

Mounting attached folders read-only into a unified workspace FS layout (`/mnt/<name>/...`) lets the main agent read them directly with `read_file`, `glob`, and `grep`, which removes the reason the retrieval indirection existed.

## Decision

Mount attached folders read-only and delete the retrieval-specific surface: the `agent` tool, the `retrieval` agent, `copy_to_task`, and their UI/eval artifacts. Retain the reusable sub-agent machinery: `spawnAgent` / `SpawnAgentFunction` is still threaded through tool execution, the `machines/agent.ts` nested-session runner stays, and the `Agent<T>` interface plus the `AGENT_NAMES` list are kept in their multi-agent shape (currently just `main`).

Re-introducing sub-agents later means defining a new agent, adding its name to the list, and writing a fresh tool over the retained `spawnAgent` primitive. The hard part (nested session lifecycle, abort, replay, completion) stays live on the `main` path.

## Alternatives considered

- Keep the `agent`/`retrieval` tool alongside mounts: ships two mechanisms for the same job and muddies the model's tool selection.
- Generalize the `agent` tool into a real sub-agent framework now: premature. The old tool was serial and retrieval-shaped, so keeping it buys no parallel capability; a future fan-out layer is better built fresh on `spawnAgent` without inheriting the retrieval-era API.

## Implementation

- [Retained sub-agent runner](../../packages/workspace/src/machines/agent.ts)
- [spawnAgent wiring](../../packages/workspace/src/lib/run-tool-call.ts)
- [Commit c7fb52963](https://github.com/instrument-org/instrument/commit/c7fb52963742cccc1296ffb9d6e2aea580bef8b5)
