# Plugins over connectors

Date: 2026-08-15

## Status

Current beliefs, not settled architecture. Every decision below is a starting position chosen to be cheap to reverse, and the ones that matter are behavioral claims about whether an agent can reliably connect a user to a service. Connecting to data is a core path for this product, so these have to survive evaluation against real agents across the model set before any of them should be treated as fixed. [The plan](../plans/active/plugins.md) carries the evaluation approach and the phase order.

## Context

The unit of third-party access was going to be a connector: a folder holding a manifest and a guide, authored by the agent, with credentials held out of band. A prototype of that exists and is unmerged.

Two things changed while it sat.

The Agent Plugins specification reached 1.0.0 with a technical steering committee spanning AWS, Cursor, Microsoft, OpenAI, and Vercel, shipping in ChatGPT, Codex, Cursor, GitHub Copilot, Kiro, and VS Code. It standardizes the packaging of Agent Skills and MCP server configuration into one directory format. It deliberately does not standardize authorization, credential storage, trust policy, permission prompts, or distribution.

MCP reached its 2026-07-28 revision, which removed protocol-level sessions, replaced server-initiated requests with the Multi Round-Trip Requests pattern, deprecated Dynamic Client Registration in favor of Client ID Metadata Documents, and deprecated Sampling.

## Decisions

### The unit is a plugin, and it is a container

A plugin is a directory holding `plugin.json`, optional `mcp.json`, optional `skills/`, and a reverse-DNS namespace directory for anything Instrument-specific. It follows the Agent Plugins layout so that the portable half stays portable and so that the agent, which authors these, is writing a format it has seen many times rather than one invented here.

Everything the specification does not cover, and that is most of what makes this work, lives under `com.instrument.studio` inside the package. Other clients are required to ignore an unimplemented namespace without validating its contents, so conformance costs nothing and no opinion has to be surrendered.

A plugin need not reach a remote service at all. A package of skills, scripts, and guidance with no `mcp.json` is a valid plugin, which is part of why the container framing is the right one.

### Plugins are Instrument's own, and the mount is flat

`/plugins/<name>/`, writable, one set, maintained by the agent.

Skills are being reorganized by provenance because a skill is inert data and a skill belonging to a co-installed agent is as usable as one of ours. A plugin is a live authenticated connection. Another client's plugin directory yields configuration whose grants were issued to that client and whose tokens live in that client's storage, which is configuration we cannot authenticate. There is one useful source, so there is nothing for path segments to carry.

### Registry packages are templates, adopted by copy

First-party plugins ship in the registry and are copied into the workspace on adoption rather than mounted read-only.

This follows from the same reasoning. The moment a package is connected it holds a credential reference, an enabled state, and possibly a grant, all of which are per-workspace and per-user. A shared read-only mount has nowhere to put them.

Copy-on-adopt also pins by construction, which is the property we want: an update can be offered later by recording the source entry and version at adoption time, but it can never be pushed silently into a package a user depends on.

The registry set should be materialized locally and readable by the agent as ordinary files. A search tool answers only the questions its parameters anticipated; a directory of packages answers questions nobody designed for, and composing a new package from three existing ones becomes reading three files and writing a fourth.

### A package is a definition; a connection is an instance

One plugin, many connections. A user with a work Gmail and a personal Gmail has one package and two connection records, each with a name they chose, the issuer that granted it, and a credential reference.

This keeps the package portable, since per-user state never enters it. It makes the user-facing name a property of the connection rather than a folder name. And it satisfies the requirement that persisted client credentials be keyed by authorization server issuer rather than by a local slug, which falls out of the record shape instead of being a rule to remember.

### One input surface, with credentials excluded

Requests for user input use a single generic mechanism shaped after MCP elicitation: a restricted schema of flat primitives and enums, and three response actions of accept, decline, and cancel. Choices, forms, and confirmations all render through it.

Taking that shape means a connected MCP server's own elicitation request renders through the same surface. One renderer, two producers.

Credentials are excluded deliberately, because elicitation forbids requesting sensitive information and directs it to out-of-band mechanisms. Secret entry keeps its own path into the encrypted store, and the agent learns only that a credential is present.

The surface belongs at the composer rather than in the transcript. A request rendered inline can be scrolled away from while the composer stays live beneath it, which lets a user type past a question the turn is blocked on.

Outstanding requests must survive an app restart, which means a durable record rather than state derived from replaying the message stream. It holds the outstanding batch, partial answers, an opaque state blob that must be echoed without inspection, and enough of the original call to reissue it.

### Guidance instead of tool-call approvals

Per-plugin guidance loaded when a plugin is used, expressed as files in the package. Not a per-call approval flow.

The product is not aimed at people who want granular permission matrices, the existing precedent is the coarse read-only versus full-access choice on folders, and there is no model-grading loop to lean on. The first version errs toward action.

What a user actually wants to express is usually an instruction rather than a permission: compose Gmail as a draft and never send. That is guidance, it is legible, the agent can maintain it on the user's behalf the way it maintains memory, and it degrades gracefully when it is wrong. Approval flows can be added later; they are much harder to remove.

### Programmatic access first, browser access alongside

Programmatic access is the priority, because it is what lets the agent do things a person cannot do quickly by hand.

Authenticated browser access to the same service is a separate grant with different properties, and both are wanted. Reading a Notion page or a Google Doc in the in-app browser, or using a design tool's real interface beside its MCP server, are cases the product should support. Asking a user to authenticate twice is acceptable, because the two sessions genuinely differ.

Capturing a session by presenting a provider's own login page in the in-app browser is a legitimate last rung of the authorization ladder, used when the rungs above have failed. It is not documented as the canonical path: it breaks silently when a provider changes their login flow, sessions are short-lived and often device-bound, and a captured session usually grants more than a scoped token would.

### Prefer MCP where a server exists

Refresh, discovery, and registration all ride the SDK on the MCP path and are hand-written work on the HTTP path. MCP tools are also named, typed, and enumerable, which makes them callable without a model in the loop.

The HTTP path remains first-class. Most of the long tail has no MCP server, and closing that off would defeat the point.

## Deferred

Tool-call approvals and per-call consent. Declared, typed operations on HTTP plugins, and with them deterministic validation and first-party UI features reading user data. Importing sessions from the user's existing browser. Merging skills and plugins into one entity, which the ecosystem appears to be trending toward and which may well be right, but which should follow a working plugin system rather than precede it. Publishing packages outward.

## What would falsify these

The decisions above are behavioral bets, and each fails in a recognizable way.

If agents cannot reliably choose between a service's several interfaces, then interface selection is not something guidance can carry and needs encoding in the runtime.

If agents routinely author packages that pass a canary but fail in real use, then a single canary is the wrong validation and declared operations move from deferred to required.

If users abandon tasks blocked on a question, then the composer surface is not sufficient and the blocked state needs to reach them somewhere else.

If guidance files are ignored often enough to cause harm, then the approval flow this decision defers becomes necessary rather than optional.

## Related

- [Plugins plan](../plans/active/plugins.md)
- [Connector authentication technical notes](../findings/connector-authentication-technical-notes.md)
- [Agent sandbox](../architecture/agent-sandbox.md)
- [In-app browser](../architecture/in-app-browser.md)
