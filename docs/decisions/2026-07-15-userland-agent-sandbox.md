# Userland agent sandbox over OS-level isolation

Recorded retroactively to capture the rationale behind an already-established design. The "how it works" reference lives in [`docs/architecture/agent-sandbox.md`](../architecture/agent-sandbox.md); this record is the "why."

## Context

Instrument is an Electron desktop app where the user chats with an AI agent that operates inside a per-task folder. The agent is **not** in a VM, container, or OS sandbox: it runs as ordinary code in the Studio main process, on the user's machine, with the user's own privileges. A hard design goal is that the user never has to approve individual tool calls.

## Options weighed

- **OS-level isolation** (VM, container, or OS sandbox) wrapping the agent process. Strong containment, but heavy to ship in a desktop app, and it fights the fact that the useful escape hatches (`pnpm`, `tsx`, `ffmpeg`, `uv`/Python, `curl`) exist precisely to touch the real host.
- **Per-tool-call approval**, gating each risky action behind a user prompt. Rejected: it defeats the goal of an agent that can work a task end to end without babysitting.
- **Layered userland constraints implemented inside each tool** (chosen).

## Decision

Contain the agent with a layered set of _userland_ constraints, implemented inside each tool rather than by the runtime, ordered strongest to weakest:

1. Path-constrained file tools (resolved against the task dir, rejected on escape).
2. just-bash builtins running against an in-memory virtual FS rooted at the task.
3. An `agent-browser` flag/subcommand allowlist.
4. Real-binary escape hatches that intentionally run at full host trust.

The constraints are picked so tool calls don't need per-call approval, not so a hostile adversary can be safely handed arbitrary code execution.

## Consequences

- The escape hatches (`pnpm`, `tsx`, `ffmpeg`, `uv`/`python`/`pip`, `curl`) have the host user's full filesystem, network, `process.env`, and `child_process` access once running; just-bash's containment does not extend to them. `curl` runs with `dangerouslyAllowFullInternetAccess`.
- `agent-browser` page-level behavior inside Chromium is currently unrestricted.
- The system prompt asking the model to behave is a soft layer, **not** a security boundary.
- This is guardrails against accidental escape and footguns for a cooperating agent, chosen for the no-approval UX. It is not adversarial isolation; if that threat model changes, this decision should be superseded.

## References

- Architecture: [`docs/architecture/agent-sandbox.md`](../architecture/agent-sandbox.md)
- just-bash threat model: `reference/just-bash/THREAT_MODEL.md`
- Code: `packages/workspace/src/agents/main.ts`, `packages/workspace/src/tools/`, `packages/workspace/src/lib/create-bash-env.ts`, `packages/workspace/src/lib/shell-commands/`
