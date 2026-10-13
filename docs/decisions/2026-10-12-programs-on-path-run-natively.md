# Programs on the PATH run natively

Date: 2026-10-12

Follows [`python` and `node` run native](2026-10-12-python-and-node-run-native.md) and [the agent works at real paths](2026-10-11-the-agent-works-at-real-paths.md).

## Context

The agent's shell ran only just-bash's builtins and the commands we register. Everything else on the computer was out of reach by name: `sips`, `screencapture`, `pdftotext`, a Homebrew tool, a CLI the person installed for exactly this kind of work. The agent could still run any of them from a `python` or `node` script, under the same Seatbelt or bubblewrap profile, so withholding the name protected nothing; it only cost a script per call and taught the agent that the computer had less on it than it does. The shell also misreported what existed: `which` knew only registered names, and `command -v`, `type` and `hash` searched a PATH that no mount backs.

Once native commands are held to the Permissions rules by the operating system, a program run by name is no more powerful than the same program run from `python`.

## Options weighed

**An allowlist of programs, or a card per program.** Rejected: the folder rules are what hold a program, and they already hold every program a script starts. A list would need upkeep for every tool a person might have, and a card would ask the person about something that changes nothing they protect.

**Register every name on the PATH as a custom command before each call.** Rejected: it lists every PATH folder on every bash call, misses a program installed during the call, and `type` and `command -v` would still name the shell's stub paths rather than the program.

**A transform plugin that rewrites unknown names to a runner command.** Rejected: it has to guess before the interpreter knows what a name is (a function defined earlier in the script, an alias, a name built by expansion), and `command -v` and `type` would still not see the programs.

**A hook in just-bash's command lookup.** Chosen. just-bash has no option for it, so the patch adds `resolveExternalCommand`, asked once its own lookup misses and by `type`, `command -v` and `hash`, carried as a local diff with the pull request text written in [just-bash-upstream.md](../architecture/just-bash-upstream.md). It is general: any embedder over a real disk wants it, and an embedder that does not pass it sees no change.

## Decision

- A name no builtin, function, or command of ours answers runs the first match on the PATH a native command runs with (the app's own, which on macOS and Linux is the person's login shell PATH and holds the app's bin folder, with the chat's virtualenv and the bundled uv ahead of it): a regular file this user may execute, or on Windows the name with each PATHEXT extension in turn. It runs through `execShim` like every native command, so it gets the environment allowlist, the shell's directory, stdin, cancellation, background streaming, and Seatbelt or bubblewrap.
- Our commands and the builtins keep their names. A program by the same name is reached by its path.
- A name with a `/` runs natively when it names a script with a `#!` line or a Mach-O, ELF or PE binary. An executable file with neither is a shell script with no interpreter line, which a shell runs itself, and just-bash still does. A shebang script therefore runs under its own interpreter, real `sh` or `bash` included, rather than just-bash's.
- `which` lists our commands by bare name and then the PATH, and takes `-a`. `command -v`, `type` and `hash` answer from the same lookup. A name found nowhere is `command not found` with status 127.
- The bash tool's description says other programs on the PATH run too, under the same rules, and that `which` finds them.

## What it costs

- A command we wrap with checks of its own (`git`'s argv policy, `osascript`'s app check, `agent-browser`'s flags) has them only under its bare name. Run by its path, the same binary gets the folder rules and the environment, which is what a script running it already got.
- On Windows nothing holds the program but the command lines Instrument can read, as for every native command there.

## What would change it

A program that does real harm under the folder rules, which would mean the rules are short of what a person expects, and the fix belongs in the rules rather than in a list of programs.
