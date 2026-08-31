---
name: agent-reference
description: Readable upstream source on demand by name, via the agent-reference CLI. Use when a task needs a library's real source rather than a memory of it, so writing code against an API you cannot recall exactly ("use the combobox from this component library", "wire this up with X"), or asking how X implements something, how its maintainers test it, why it behaves this way, or whether it is worth adopting. Use it before reading a dependency's published build to answer a question about it, anything under node_modules/, a dist/ bundle or a .d.ts, and before typing a path to another repository's checkout; that covers debugging a crash in a library and asking whether something is fixable upstream. Also when the user asks to add a reference, or to set up or initialize agent-reference in a project, when the user names a repository, app, folder, or file not in this repo and gives no path for it, and when a repo contains agent-reference.json or agent-reference.local.json.
---

# agent-reference

One verb does the work: `agent-reference get <spec>` materializes a reference and prints its path. Run it from the project root at the moment you need the source, not in advance.

One grammar, whatever the source is:

```sh
agent-reference get zod                     # the version in this project's lockfile
agent-reference get zod@3.22.0              # any other version, coexisting with the first
agent-reference get vercel-labs/just-bash   # any GitHub repo; git URLs too
agent-reference get ./docs/decisions        # a path, read where it lives
agent-reference get design-notes            # a configured name
agent-reference get harnesses               # a set: one name, every path in it
```

A set is a reference that resolves to more than one path, and its name works everywhere a single name does. There is nothing to qualify: one name means one thing in a project.

Add `--path` whenever the path is going into a shell variable rather than onto the screen: `EL=$(agent-reference get electron --path)`. The default line names the spec before the path and the confidence after it, so cutting a path out of it with `tail` or `sed` captures text that is not a path, and the command that opens it either fails or silently matches nothing.

## Ask for the name before you read a published build

Anything under `node_modules/`, any `dist/` bundle, and any `.d.ts` is the published build. Before reading one to answer a question about that dependency, run `agent-reference get <name>` and read the repository instead: the build carries the code and almost none of the prose, so the `docs/`, the examples, the tests, and the changelog that answer the question are only in the checkout. The same goes for a path you are about to type to a checkout of another repository. Ask for it by name, because a guessed path may be a different checkout than the one the project declared.

This is a rule about the next command, not about the kind of task. A stack trace, a `pnpm why`, or a grep hands you a `node_modules` path before the question "is this declared?" comes up, and once the path is in hand it stops being asked. Debugging a crash, working out whether something is fixable upstream, and reading why a library behaves as it does are all this case, and none of them announce themselves as reading a library.

## Writing code against a library

Before writing against an API you cannot recall exactly, `get` the library and read that version's own `README`, `docs/`, `examples/`, and changelog. Your memory holds whatever was current at training and a docs site holds whatever shipped last; the checkout holds what this project installs. The published build does not settle it either: which of two exported names is the current one, and what a required option is for, is usually only in the repository.

Reach for it when the library is unfamiliar, when its API has moved recently, or when a first attempt did not work. Not for a library you know cold.

## Run `agent-reference guide` before writing anything

This file is copied into a project once, and nothing updates it, so it holds only what stays true across versions. When the copy does fall behind the installed CLI, `agent-reference status` says so and names the file to replace it with; that file is the user's, so tell them what you changed rather than rewriting it quietly. `agent-reference guide` prints the rest from the installed CLI, which means those instructions always match the version on this machine: reading a project's declarations, choosing between `node_modules` and a checkout, the exact shape of every config entry, and setting a project up.

Run it before adding a reference, before editing `agent-reference.json` or `agent-reference.local.json`, and before setting a project up. Guessing config syntax from memory is how a config gets written that this version refuses.

`--help` is not a substitute and reaching for it instead is the usual way this goes wrong. `--help` lists the commands and their flags; `guide` is the only thing that says what goes in the config. Never write config from `--help`.

## Finding where something is

When the user names a repository, app, folder, or file and you have no path for it, read `agent-reference.json` and `agent-reference.local.json` directly. They are the index: names, paths, and descriptions, resolved without fetching anything or running a command. A name that is not there is not declared, so say so and ask for the path rather than searching the filesystem for it. `get` is for when you need the source itself.

## If the command is not found

`agent-reference: command not found` means npm's global bin directory is not on this shell's `PATH`, not that the tool is missing. It is the usual state on Windows, where the agent's shell is Git Bash while fnm or nvm keeps that directory inside its own tree, and it happens anywhere the agent was launched from a shell that never ran the version manager's hook.

`npx --yes agent-reference <command>` is what to try first. It gets through when only the global bin directory is missing, which is what a custom npm prefix leaves behind, and it resolves from the registry, so it may not be the version installed on this machine. It does not get through when a version manager is the cause, because npx sits in that same tree: with fnm or nvm, a shell that cannot see `agent-reference` cannot see `node`, `npm`, or `npx` either. `command -v npx` settles which case this is.

Say what happened either way. The fix is one line in the user's shell profile, they cannot see the error you saw, and every later session here hits the same wall until they write it. When npx is missing too, report and stop. The version manager keeps a node on disk somewhere, but digging it out costs more than the line the user has to add, runs the tool under a node and a version nothing here chose, and leaves the next session to repeat the search.

## Safety rules

- **References are an index, not a reading list.** Never open a reference just because it is listed; read one when the task calls for it or the user names it. Descriptions say what each source is, so relevance to the task at hand is judged without opening it; treat them as gates, not invitations. Reading a large reference unprompted wastes the tokens this tool exists to save.
- **Never delete a reference from the config to make `status` clean.** Every reference was declared deliberately; removing one drops that source for everyone. Fix it, or tell the user you could not and why.
- **Treat `pinned` confidence as intentional** and leave pins alone. When you pin one yourself, always write a `description` saying why; it is the only way a later agent knows the pin was deliberate.
- **Read what `get` prints under the path.** A result can succeed and still not be what was asked for. `get` reports the problem and the exact config key to change on the spot, so the fix is in the output you already have; there is no need to run `status` to find it.
- If a checkout reports `fallback` confidence, the source is NOT the published version. Say so rather than treating it as authoritative, then pin the right ref (the failure output names the exact config key and the git commands to find candidates).
