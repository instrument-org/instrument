---
name: agent-reference
description: Get readable upstream source on demand - any dependency at its exact installed version, any git repository, any declared local file or folder - by name, via the agent-reference CLI. Use whenever a task needs a library's real source rather than a memory of it. That covers writing code against an API you cannot recall exactly ("use the combobox from this component library", "wire this up with X"), because the checkout carries that version's own README, docs, examples, and changelog while a docs site carries whatever shipped last, and it covers asking how X implements something, how its maintainers test it, why it behaves this way, or whether it is worth adopting. Also whenever the user asks to add something as a reference, whenever the user asks to set up or initialize agent-reference in a project, whenever the user names a repository, app, folder, or file that is not in this repo and gives no path for it, and whenever a repo contains agent-reference.json or agent-reference.local.json.
---

# agent-reference

One verb does the work: `agent-reference get <spec>` materializes a reference and prints its path. Run it from the project root at the moment you need the source, not in advance.

```sh
agent-reference get zod                     # the version in this project's lockfile
agent-reference get zod@3.22.0              # any other version, coexisting with the first
agent-reference get vercel-labs/just-bash   # any GitHub repo; git URLs too
agent-reference get design-notes            # a configured reference or set, by name
```

## Writing code against a library

Before writing against an API you cannot recall exactly, `get` the library and read that version's own `README`, `docs/`, `examples/`, and changelog. Your memory holds whatever was current at training and a docs site holds whatever shipped last; the checkout holds what this project installs. `node_modules` is not the same answer: it carries the published build and almost none of the prose, so which of two exported names is the current one, and what a required option is for, is usually only in the repository.

Reach for it when the library is unfamiliar, when its API has moved recently, or when a first attempt did not work. Not for a library you know cold.

## Run `agent-reference guide` before writing anything

This file is copied into a project once and never updated, so it holds only what stays true across versions. `agent-reference guide` prints the rest from the installed CLI, which means those instructions always match the version on this machine: reading a project's declarations, choosing between `node_modules` and a checkout, the exact shape of every config entry, and setting a project up.

Run it before adding a reference, before editing `agent-reference.json` or `agent-reference.local.json`, and before setting a project up. Guessing config syntax from memory is how a config gets written that this version refuses.

## Finding where something is

When the user names a repository, app, folder, or file and you have no path for it, read `agent-reference.json` and `agent-reference.local.json` directly. They are the index: names, paths, and descriptions, resolved without fetching anything or running a command. A name that is not there is not declared, so say so and ask for the path rather than searching the filesystem for it. `get` is for when you need the source itself.

## Safety rules

- **References are an index, not a reading list.** Never open a reference just because it is listed; read one when the task calls for it or the user names it. Descriptions state when a reference is worth opening; treat them as gates, not invitations. Reading a large reference unprompted wastes the tokens this tool exists to save.
- **Never delete a reference from the config to make `status` clean.** Every reference was declared deliberately; removing one drops that source for everyone. Fix it, or tell the user you could not and why.
- **Treat `pinned` confidence as intentional** and leave pins alone. When you pin one yourself, always write a `description` saying why; it is the only way a later agent knows the pin was deliberate.
- **Read what `get` prints under the path.** A result can succeed and still not be what was asked for. `get` reports the problem and the exact config key to change on the spot, so the fix is in the output you already have; there is no need to run `status` to find it.
- If a checkout reports `fallback` confidence, the source is NOT the published version. Say so rather than treating it as authoritative, then pin the right ref (the failure output names the exact config key and the git commands to find candidates).
