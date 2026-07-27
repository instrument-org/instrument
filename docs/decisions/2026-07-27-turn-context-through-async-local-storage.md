# Turn context through AsyncLocalStorage

## Context

Skill attribution needs to know which turn a write belongs to at the two shared
write boundaries -- the mounted `/skills` filesystem and `writeFileWithDir`.
Both sit many frames below the agent loop, are used by callers that have no
session in hand, and cannot grow a session parameter without threading one
through every tool.

The workspace had already rejected `AsyncLocalStorage` once, for
`WorkspaceConfig`: Hono per-request middleware, spawn-runtime stdio listeners,
and XState spawn-at-init all run outside any `run` scope, so a store would be
missing exactly where the config is needed. That objection is about entry
points, not about the mechanism.

## Decision

Turn identity travels through an `AsyncLocalStorage` owned by `turn-context.ts`,
entered in exactly one place: `streamTool`, which wraps every tool call. The
store holds the task, session, and a minted turn id.

The module is deliberately not skill-specific. It knows about turns, and
consumers read from it; `stream-tool.ts` does not import anything about skills.

Three properties make this safe where the `WorkspaceConfig` version would not
have been:

- **One entry point.** Every recorded write is downstream of a tool call, and
  tool calls have exactly one execution path.
- **Fail-soft.** No store means no attribution, never a throw and never a guess.
  Code outside a turn behaves as if the feature were absent.
- **Turn-scoped, not session-scoped.** The id is minted per turn and never
  persisted. A continuation left over from a finished turn still carries the
  finished turn's id, so it is dropped rather than billed to whatever turn is
  running now on the same session.

Nested execution keeps the outer turn. When a tool spawns a sub-agent, that
sub-agent runs on its own session inside the spawning tool call, but its skill
writes belong to the turn the user started -- that is the session they have open
and the report they will read. Attributing them inward would strand the report
in a sub-agent nobody is looking at.

## Consequences

Turn identity is now available to any boundary that needs it without a
parameter, and the next such feature extends `TurnContext` instead of adding a
second store. The cost is a global that only exists inside a tool call: reading
it anywhere else returns undefined, and that has to stay a supported answer
rather than something callers work around.

`beginTurn`/`endTurn` are driven by the skill index today because it is the only
consumer. A second consumer should hoist those calls to the agent's `onStart`
and `onFinish`, where the turn actually begins and ends.

## Implementation

- [Turn context](../../packages/workspace/src/lib/turn-context.ts)
- [Tool execution boundary](../../packages/workspace/src/lib/stream-tool.ts)
- [Skill change tracking](../../packages/workspace/src/lib/workspace-skill-index.ts)
- [Why `WorkspaceConfig` is a module singleton instead](../../packages/workspace/src/lib/workspace-config.ts)
