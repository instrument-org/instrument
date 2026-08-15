# Plugins

Status: shaping. Nothing landed. Phase 0 gates everything and is not plugin work.

The shape and the reasoning behind it are in [Plugins over connectors](../../decisions/2026-08-15-plugins-over-connectors.md). This is the order to build it in, and how to tell whether it works.

## What has to be true

A user names a service and gets connected to it. If the service is well known and works with comparable products, failing to connect it is a product failure rather than an edge case. That is the bar, and it is a bar about recovery rather than about any single path succeeding.

The agent is the first user of this system. A plugin format that a person finds elegant and an agent cannot author reliably is a failed format. Robustness for the human user interface comes after the agent loop works, not alongside it.

## Evaluation

This is a core path, so belief is not enough. The evaluation approach matters more here than in most plans, and it should be built alongside phase 2 rather than bolted on after phase 4.

The harness already exists for this shape of question. See `.agents/skills/validate-changes/SKILL.md` for which of the four ways to run the product answers which kind of question, and prefer a real agent across the model set for anything about whether the agent can do this at all.

What to measure, per scenario, against a recorded baseline:

- Whether a connection was reached at all, which is the only number that matters to the product bar.
- Turns spent, and money spent, because unbounded recovery is a real cost and there is deliberately no retry budget in the design.
- Which route succeeded, and which were tried first. A service that only ever connects on the fourth rung is telling us the first three are misconfigured.
- Whether the package the agent wrote still works on a second, cold run in a fresh workspace. Passing a canary once is weaker evidence than it looks.
- Whether guidance files were followed when they contradicted the obvious action, which is the load-bearing assumption behind deferring approval flows.

Scenarios worth having from the start: a service with a first-party MCP server, a service with only a REST API, a service whose OAuth fails and has a token fallback, a service with no registry template at all, a second connection to a service already connected once, and a service that cannot be connected, to check that failure is legible rather than silent.

## Phase 0: clear the decks

Not plugin work. Nothing below is worth starting while the mount layout is still moving.

- Land the skills mount reorganization, since it changes what `/skills` means and the plugin mount sits beside it.
- Retire the connectors prototype rather than rebasing it. Keep it readable as a reference implementation; it is a complete worked example of the agent-authored setup loop and re-landing four files against the plugin shape is less work than carrying them forward twice.

## Phase 1: harvest what does not depend on the shape

Roughly half the prototype does not care whether the unit is called a connector or a plugin. Landing it now stops the decay on the expensive, well-tested parts and none of it is wasted when the shape settles.

**Interactive tool resolution.** The RPC and the machine-side deferral that lets a tool call block on a human. This is a general harness capability and it does not exist today, which is why `Choose` is still vestigial. Ship the transport and state layer only; the presentation layer is phase 3 and should not be committed to before then.

Worth deciding as part of this: whether the resolution mechanism ships enabled. A task that blocks on a question the user never sees is worse than a task that never asks. Landing the machinery without exposing it is a legitimate intermediate state.

**Credential storage and OAuth.** The encrypted store, the OAuth provider, and the flow. Two corrections belong in this move rather than after it:

- Derive the redirect URL from the port the callback server actually bound. It is built from a default constant today while the server binds a detected free port, so a second running instance sends the browser to a port nothing is listening on and sign-in dies without a useful signal. This becomes structural once pre-registered and metadata-document client identities exist, because their redirect URIs are fixed ahead of time.
- Key persisted client registrations by authorization server issuer rather than by a local slug. One connector usually means one authorization server, so this behaves until a server's authorization server changes, at which point a registration issued by the old one is silently reused against the new one.

**Guards and transport.** URL safety, per-hop address checks, the secret scanner, the request path, and the service catalog. The catalog is format-agnostic service metadata and does not depend on what the installed unit is called.

## Phase 2: land the shape

Four files rewritten once, against a settled layout, rather than carried forward twice.

- `/plugins/<name>/` flat and writable, with the mount table split so that skills and plugins stop being modeled as one kind of thing.
- `plugin.json`, optional `mcp.json`, `skills/`, and a `com.instrument.studio` namespace for auth binding, enablement, the validation canary, and the HTTP plugin type.
- Connection records separate from packages, so one package can hold several named connections.
- The guide becomes a skill inside the package. The read-before-use gate moves with it rather than being lost in the rename; it is the mechanism that keeps endpoint documentation out of every tool description and it survives compaction on purpose.
- Add an intent field to the generic call. The agent declares what it is trying to do, which buys readable logs, a reviewable record of what an agent-authored package did, and a better transcript summary than a bare method and path.

The exit criterion for this phase is an evaluation run, not a green build. A functional plugin system the agent can drive is what phase 3 and 4 are built on.

## Phase 3: the input surface

Needs design before implementation. Start that conversation during phase 1, not after phase 2, because everything user-facing downstream depends on it: setup, consent, choices, and reconnection all land here.

- Composer-docked rather than rendered in the transcript.
- Batched requests, following the Multi Round-Trip Requests shape. Requests arrive as a map and are answered together; a genuine sequence is a fresh round trip rather than a queue the client drains.
- A durable pending record, so a half-filled form survives a restart and a blocked task is recoverable rather than merely re-rendered.
- Decline and cancel as distinct outcomes, and abandonment as a supported state rather than a leak.
- Credential entry sharing the surface but bypassing the model entirely.

Wireframes for the conversation: [the input surface](wireframes-user-input-surface.html), [setup in context](wireframes-plugin-setup-flow.html), [management surfaces](wireframes-plugin-management.html), [a task that is waiting](wireframes-waiting-task.html).

## Phase 4: make it robust

This is the phase that delivers the product bar. Until it lands, the system connects the easy cases.

- The authorization ladder in its documented priority order: an existing connection, then pre-registered client identity, then a client ID metadata document, then dynamic registration, then asking the user. Only the last two exist in any form today.
- Pre-registered client identities fetched from our own service rather than shipped inside packages, so they can be rotated without an app release.
- A client ID metadata document hosted on a domain we control, which requires the callback port work from phase 1.
- The registry corpus materialized locally so the agent can read across it.
- Interface fallback written into guides. The catalog already lists several interfaces per service with the auth each takes, so the option space exists in data and the decision procedure is what is missing. The catalog holds the options; the guide holds the procedure.
- Per-plugin guidance files, loaded on use, maintained by the agent on the user's behalf.
- Browser session capture as the last rung, behind an explicit per-service click, never opening in the user's own browser.
- Connection pooling. Per-operation connect and close is a deliberate simplification that stops being reasonable once a connection can mean spawning a process.

## Deferred, with the reason

**Local MCP servers over stdio.** Mostly policy rather than transport. The field shapes are settled by specification, including that the command is a single token rather than a shell string, that bundled executables resolve inside the package, and that environment values are visible package data that must not hold secrets. What is not settled is whether spawning is gated by confirmation, an allowlist, or a bundled runtime. An agent-authored manifest carrying a command is arbitrary code execution on the host, so this waits for the input surface to exist.

**Tool-call approvals.** Deliberately not in the first version. Guidance files are the bet; if evaluation shows they are ignored when it matters, this returns.

**Declared operations and deterministic validation.** Would let first-party interface features read real user data and would make validation stronger than a single canary. Downstream of a working system, and preferring MCP now keeps the door open at no cost.

**Importing sessions from the user's existing browser.** Main-process work behind an operating system keychain prompt, on the far side of the agent boundary. Architecturally compatible, not near-term.

**Merging skills and plugins.** Plausible and possibly where the ecosystem lands. The interface would likely keep both lenses regardless, since users recognize skills as a thing. Follows a working plugin system.

## Open questions

Whether the interactive resolution mechanism ships enabled, and what happens to a question nobody answers. Expiry is one option and it is not clear users like it.

Whether a route that failed is recorded globally or per user. That a service refuses dynamic registration is true for everyone and belongs with the service; that one person's administrator disabled API keys belongs with their connection. Mixing them teaches the wrong lesson to the wrong audience.

Whether the whole registry corpus ships with the app. Reading across it requires it to be local; a large corpus has a download cost. These pull against each other.

Whether guidance is free-form prose, structured, or both. The agent maintains it, the user should be able to read and edit it, and those two pull in different directions.
