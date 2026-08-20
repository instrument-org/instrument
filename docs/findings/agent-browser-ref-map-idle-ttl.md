# agent-browser snapshot refs die on the daemon idle timeout

**Status:** fixed by raising the daemon idle timeout to five minutes. The rejected alternatives are recorded below because each looks reasonable until the reason it fails is stated.

## Symptom

An agent runs `agent-browser snapshot -i`, gets refs (`@e49`), then a following
`agent-browser click @e49` fails with `Unknown ref: e49` -- even though the page
never navigated and a fresh snapshot re-finds the same element under the same
ref. Re-snapshotting doesn't help: the next action fails the same way. Observed
with a slow model whose think time between the snapshot and the click ran 34s
and 63s (real transcript, "Wikipedia link navigation").

## Root cause: refs are daemon-only in-memory state with an effective 30s TTL

Snapshot refs live only in the agent-browser daemon's in-memory `RefMap`
(`DaemonState.ref_map`, a `HashMap`, built fresh via `RefMap::new()` on daemon
start; `handle_snapshot` does `ref_map.clear()` then repopulates). It is never
persisted, so a new daemon starts empty and `Unknown ref` is just a miss on that
map (upstream `cli/src/native/element.rs`, verified against tag `v0.32.1`; we
ship `v0.31.1`, same code).

We ran the daemon with `AGENT_BROWSER_IDLE_TIMEOUT_MS=30000`. The CLI counts
that from the last command (each invocation re-arms it) and, on fire, runs
`close_current_browser` and exits the daemon (`cli/src/native/daemon.rs`),
dropping the `RefMap`. The next `click @eN` spins up a fresh daemon that
reattaches to the still-warm view over `--cdp` but has an empty map -> `Unknown
ref`.

So refs had an effective 30s TTL tied to the daemon idle timeout. Nothing
documents this: both our skill and the upstream README say refs only go stale
"after navigation or a DOM change," so a slow agent re-snapshots and re-fails
without understanding why. The **view** survives (workspace owns it on a
separate 1-hour reaper, `task-browser.ts`), which is why re-snapshot keeps
re-finding the element while the click keeps failing.

## Why it surfaced now

The 30s idle timeout was added in `13a83d684` (2026-04-20) as part of
daemon-leak prevention and lived as a bare `"30000"`; `45006dbf8` (2026-07-22)
routed it through the shared `AGENT_BROWSER_IDLE_TIMEOUT_MS` constant. The bug is
latent since April: it only bites when a snapshot->action tool-call gap exceeds
30s, which a slow model reliably does. It is a consequence of the leak-prevention
direction, not of the fingerprint fix itself. See
[agent-browser-orphaned-daemons.md](./agent-browser-orphaned-daemons.md).

## Fix

Raised `AGENT_BROWSER_IDLE_TIMEOUT_MS` to `"300000"` (5 min) in
[agent-browser.ts](../../packages/workspace/src/lib/agent-browser.ts). It must
outlast an agent's think time between a snapshot and the action that consumes
its refs, while staying well under the workspace's 1-hour view reaper so it
remains a backstop.

Safe because the daemon idle timeout is only a backstop: the primary reap is the
explicit `close --session` on view teardown (`task-browser.ts`
`destroyAndCloseLogic` -> `closeAgentBrowserSessionsForSessions`), which is
untouched by the value and (since `45006dbf8`) presents a matching daemon-config
fingerprint. Raising the value does not reintroduce the orphan-leak class; it
just lets a cheap daemon (a CDP websocket + the ref map) live minutes instead of
seconds between commands. Both consumers read the one shared constant, so the
spawn and close fingerprints stay matched.

## Not done / alternatives considered

- **Persist/rebuild the ref map across daemon restarts** -- not possible without
  upstream changes (`RefMap` isn't serialized; `backendNodeId`s wouldn't survive
  a fresh CDP attach). Rejected.
- **Keep 30s, heartbeat the daemon between commands** -- adds a background
  pinger for no benefit over a longer timeout. Rejected.
- **Skill guidance:** consider a one-line note that refs are snapshot-scoped and
  to snapshot immediately before acting, as belt-and-suspenders. Not required by
  the timeout fix.
