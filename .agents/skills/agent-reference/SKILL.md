---
name: agent-reference
description: Readable upstream source on demand by name, via the agent-reference CLI. Use when a task needs a library's real source rather than a memory of it, so writing code against an API you cannot recall exactly ("use the combobox from this component library", "wire this up with X"), or asking how X implements something, how its maintainers test it, why it behaves this way, or whether it is worth adopting. Use it before reading a dependency's published build to answer a question about it, anything under node_modules/, a dist/ bundle or a .d.ts, and before typing a path to another repository's checkout; that covers debugging a crash in a library and asking whether something is fixable upstream. Also when the user asks to add a reference, or to set up or initialize agent-reference in a project, when the user names a repository, app, folder, or file not in this repo and gives no path for it, and when a repo contains agent-reference.json or agent-reference.local.json.
---

# agent-reference

`agent-reference get <spec>` materializes a reference and prints its path. Run it from the project root when you need the source, not in advance.

The same command takes every kind of source:

```sh
agent-reference get zod                     # the version in this project's lockfile
agent-reference get zod@3.22.0              # any other version, coexisting with the first
agent-reference get vercel-labs/just-bash   # any GitHub repo; git URLs too
agent-reference get ./docs/decisions        # a path, read where it lives
agent-reference get design-notes            # a configured name
agent-reference get harnesses               # a set: one name, every path in it
```

A set is a reference that resolves to more than one path, and its name works everywhere a single name does.

Add `--path` whenever the path is going into a shell variable: `EL=$(agent-reference get electron --path)`. The default line puts the spec before the path and the confidence after it, so cutting it up with `tail` or `sed` captures text that is not a path.

## Ask for the name before you read a published build

Anything under `node_modules/`, any `dist/` bundle, and any `.d.ts` is the published build. Before reading one to answer a question about that dependency, run `agent-reference get <name>` and read the repository instead: the build carries the code and almost none of the prose, so the `docs/`, the examples, the tests, and the changelog that answer the question are only in the checkout. The same goes for a path you are about to type to a checkout of another repository. Ask for it by name, because a guessed path may be a different checkout than the one the project declared.

The rule applies to the next command, whatever the task. A stack trace, `pnpm why`, or a grep hands you a `node_modules` path before you have thought about whether the package is declared, and debugging a crash, checking whether a bug is fixable upstream, or reading why a library behaves as it does all start that way.

## Writing code against a library

Before writing against an API you cannot recall exactly, `get` the library and read that version's own `README`, `docs/`, `examples/`, and changelog. Your memory is from training time and a docs site describes the latest release; the checkout is the version this project installs. The published build rarely settles which of two exported names is current or what a required option is for, since that is usually written down only in the repository.

Reach for it when the library is unfamiliar, when its API has moved recently, or when a first attempt did not work. Skip it for a library you know cold.

## Run `agent-reference guide` before writing anything

This file is copied into a project once, and nothing updates it, so it holds only what stays true across versions. When the copy does fall behind the installed CLI, `agent-reference status` says so and names the file to replace it with; that file is the user's, so tell them what you changed rather than rewriting it quietly. `agent-reference guide` prints the rest from the installed CLI, so those instructions match the version on this machine: reading a project's declarations, choosing between `node_modules` and a checkout, the exact shape of every config entry, and setting a project up.

Run it before adding a reference, editing `agent-reference.json` or `agent-reference.local.json`, or setting a project up. Config written from memory is often config this version refuses.

`--help` lists the commands and their flags and says nothing about the config, so never write config from it.

## Finding where something is

When the user names a repository, app, folder, or file and you have no path for it, read `agent-reference.json` and `agent-reference.local.json` directly. They list every declared name with its path and description, and reading them fetches nothing. If the name is not there, say so and ask for the path rather than searching the filesystem. Run `get` only when you need the source itself.

## If the command is not found

`agent-reference: command not found` means npm's global bin directory is not on this shell's `PATH`, not that the tool is missing. It is the usual state on Windows, where the agent's shell is Git Bash while fnm or nvm keeps that directory inside its own tree, and it happens anywhere the agent was launched from a shell that never ran the version manager's hook.

Try `npx --yes agent-reference <command>` first. It works when only the global bin directory is missing, as with a custom npm prefix, though it resolves from the registry and so may not be the version installed on this machine. It fails when a version manager is the cause, because npx lives in the same tree: under fnm or nvm, a shell that cannot see `agent-reference` cannot see `node`, `npm`, or `npx` either. `command -v npx` tells you which case you are in.

Tell the user either way. The fix is one line in their shell profile, they cannot see the error you saw, and every later session here fails the same way until they add it. When npx is missing too, report and stop. Digging a node out of the version manager's tree costs more than that one line, runs the tool under a version nobody chose, and leaves the next session to repeat the search.

## Safety rules

- Never open a reference just because it is listed. Read one when the task calls for it or the user names it; the description says what each source is, so you can judge relevance without opening it. Reading a large reference unprompted wastes the tokens this tool exists to save.
- Never delete a reference from the config to make `status` clean. Every reference was declared deliberately, and removing one drops that source for everyone. Fix it, or tell the user you could not and why.
- Treat `pinned` confidence as intentional and leave pins alone. When you pin one yourself, write a `description` saying why; it is the only way a later agent knows the pin was deliberate.
- Read what `get` prints under the path. A result can succeed and still not be what was asked for, and `get` prints the problem and the config key to change right there, so the fix is already in the output you have.
- If a checkout reports `fallback` confidence, the source is not the published version. Say so rather than treating it as authoritative, then pin the right ref; the failure output names the config key and the git commands that find candidates.
