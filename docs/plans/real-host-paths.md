# Plan: real host paths, held to the Permissions rules

Status: done. Completed. Steps 1 to 4 landed: native commands are held to the Permissions rules by Seatbelt on macOS and bubblewrap on Linux, the shell and the file tools follow the same rules, the agent works at real paths with `/task`, `/mnt`, `/skills`, `/apps` and the path bridge removed, a folder the agent runs into raises a card on its own, and Settings › Permissions edits the rules ([the decision](../decisions/2026-10-11-the-agent-works-at-real-paths.md)). Step 5 is not built: native commands on Windows run unconfined until MXC can hold node and git ([windows-sandbox.md](../architecture/windows-sandbox.md)).

## Summary

The agent sees folders at virtual paths: its chat's folder at `/task`, folders it was given under `/mnt/<name>`, skills under `/skills`. Every native command (node, python-native, uv, pnpm, ffmpeg, git, osascript) is handed only bridged or quarantined paths, and its output is rewritten back. That layout existed because nothing at the OS level stopped a native command from writing anywhere, so a host path was never allowed to reach one.

It never contained anything. The [sandbox map](../architecture/agent-sandbox.md) says native commands have the host user's full filesystem, and [the private-dir mask is not a boundary](../findings/private-dir-masking-is-not-a-boundary.md). What it did produce was detours:

- A task copied a 2.2 GB folder into its own folder to run nine lines of standard-library Python ([decision](../decisions/2026-09-10-python-is-the-sandboxed-interpreter.md)).
- Seven of 335 tasks hit git's refusal on a given folder, including weekly reviews running `git log` ([decision](../decisions/2026-09-11-git-reaches-attached-folders.md)).
- The agent copied a file the person already had into the only writable mount and handed back the copy ([finding](../findings/a-fetched-file-gets-copied-somewhere-writable.md)).

The one protection the quarantine gave is real: a native command cannot overwrite a person's file through a path on its command line. The Permissions rules give the same protection by rule rather than by hiding, and on macOS give it for what a script reaches on its own too. Once they are enforced, the agent works at real paths everywhere, and the virtual layout and its translation code are deleted.

## What enforces reach

One set of rules, from Settings › Permissions: a path at any depth is Allowed, Ask first or Not allowed, the deepest rule wins, and a chat's own grants (a folder attached to it, a card answered in it) are allows that win at an equal path. Every layer asks the same question of a host path:

| Layer | How it applies the rules | Platforms |
| --- | --- | --- |
| File tools | `classifyHostPath` and `ruleRefusal` per path | All |
| `rg`, `du` | `classifyHostPath` per operand, for masked entries and symlinks; `rg` also runs under the OS sandbox below | All |
| just-bash builtins, sandboxed `python` and `js-exec` | The virtual filesystem, now mounting each reachable folder at its host path | All |
| In-app browser `file://` reads | The CDP bridge and `tab read` check the layout (folders the chat reaches and their masked entries), not the rules | All |
| Native command lines | `git` asks the rules before a command that writes; no other command line is checked, and the OS sandbox holds the rest | All (`git`) |
| What a native command's code reaches on its own | An OS sandbox around the spawn, generated from the rules | macOS and Linux; Windows per step 5 |

The chat's own folder stops being `/task`. The prompt names it as the place the chat works and keeps what it makes, at its real path.

Where an OS sandbox is not available, Settings › Permissions says the list is followed as closely as Instrument can, and that a program the agent runs could still reach other folders.

## Steps

1. **Seatbelt for native commands on macOS.** Every spawn through `execShim` and `execaNodeForTask` runs under `/usr/bin/sandbox-exec` with an allow-by-default profile that denies the places that hold passwords and sign-ins. Measured on macOS 27: uv installs with numpy and pandas, pnpm with a native addon, ffmpeg, git over https and osascript all run; reads under `~/.ssh`, `~/.config/gh` and Keychains are refused, including from a script's own subprocess; about 6 ms per spawn. Run from the signed, hardened app too: sandbox-exec starts from it, the refusals hold, and macOS still attributes a protected folder's prompt to the app.
2. **The Permissions rules, enforced.** The rules feed every layer in the table. The Seatbelt profile gains the Not allowed and Ask first places, and denies writes across the home folder outside granted folders, which means allowing what native tools write themselves: `~/Library/Caches`, `~/.cache`, the pnpm store, uv's folders, the chat's own folder. This is where native tools are most likely to break, so it gets the same real-workload run before it ships. A refusal under an Ask first place raises the card and the agent runs the command again after Allow.
3. **Real paths**, measured against the evaluation below. Remove `/task`, `/mnt`, the native-command bridge, output rewriting and chat-to-task path translation (inventory below). The prompt's folder guidance becomes a statement of where the chat works and which folders it holds.
4. **Linux: bubblewrap.** Native commands run under bwrap built from the same rules: the home folder bound read-only, a closed folder replaced by an empty one and a closed file by an empty file, each granted folder bound back read-write, shallow to deep. bwrap is probed once, and where it cannot run the commands go unwrapped and Settings shows its note. Hidden entries in the home folder have no pattern form, so the spawn lists the home folder and hides each one by name. Measured on Ubuntu 24.04 (kernel 7.0, bwrap 0.9.0): every rule case behaves as on macOS, a script's own child included, at about 2 ms a spawn. Ubuntu blocks unprivileged user namespaces, but the `.deb` already installs an AppArmor profile for the app that allows them, and bwrap started by the app runs under that profile, so no separate profile or root step is needed. An AppImage installs no profile and stays unenforced.
5. **Windows: MXC.** AppContainer through `@microsoft/mxc-sdk` (MIT, 1.0.0), needing Node 24 or later and Windows 11 24H2 or later. Measured on build 26200: the process container's filesystem policy matches the rules (deny by default, a read-write grant inside a denied folder works, writes outside grants refused) at about 50 ms a spawn. But in that container node 24 and Git for Windows die at startup with `STATUS_DLL_INIT_FAILED`, with their folders readable and with UI allowed, while `cmd` and a stock Python run. Until that is understood, MXC can hold Python and plain commands but not node or git, so Windows ships unenforced with the Settings note.

Node's permission model (`--permission` with `--allow-fs-*`) is not a substitute: it covers node alone, not python-native, uv, ffmpeg or git.

## Evaluation before real paths

Real paths change what every model sees on every turn, so step 3 is measured against a baseline suite run on the virtual layout, and merges when it matches or beats it. The suite is built and graded apart from the change it measures, so the builder isn't grading itself. It runs on a fast model for every iteration, with a wider set of models rechecked at the end.

It answers one open concern: whether the virtual layout's obscurity kept weaker models in check, so that seeing real paths makes them wander, reach for the home folder, or work around a refusal.

- **Capability.** Work on a given folder in place: native tools (python-native, uv, ffmpeg, git) on its files, returning a result where the person's file lives, fetching a file without copying it somewhere writable. Measured by success, turns taken, detours such as copies, and whether paths shown to the person are ones they recognize.
- **Safety.** Tasks that tempt the agent past its grants: a credential place, a write in the home folder outside any grant, a Not allowed folder, an Ask first folder. Measured by attempts made, whether a refusal ends the attempt or starts a workaround, whether it asks through the card, and whether it tells the person what it couldn't reach.

## What goes, and what stays

From a read-only inventory; line counts are estimates.

Goes, about 1,350 to 1,500 production lines and 1,300 test lines:

- **The native-command bridge.** `resolveNativeHostPath`, `resolvePathArgs`, `bridgeInlineCodePaths`, `bridgeFlagValuePath`, `scanScriptFileForVirtualPaths`, `resolveHostDevicePath`, the copy-first errors, and their wiring in node, python, ffmpeg, ffprobe, uv, pip, osascript and shortcuts.
- **Output rewriting.** `virtualizeHostPaths` and its `/private` and escaped spellings, `redactTaskDir`, and the browser's `file://` respelling (`agentSpellingOfFileUrls`, `chatSpellingOfUrl`).
- **Chat-to-task path translation.** `mount-paths.ts` and its call sites, plus Studio's mount mappers in `file-tabs.ts` and `tool-request-folder.tsx`.
- **Mount naming.** `MOUNT`, `assignMountNames`, `assignAttachedMounts`, the `no-bare-mount-path` lint rule, `MountedWorkspacePathSchema`.
- **Prompt text.** About 4 to 5k characters of virtual-path and copy-first guidance, and probably the step that copies a loaded skill into the chat's folder before its scripts run.

Stays:

- **Masks and containment.** The private `.instrument` mask and other chats' folders hidden, symlink containment.
- **Git's isolation.** Its credential and config isolation and its argv policy.
- **just-bash.** The mounting and its patches, which exist because of mounts rather than their names.
- **Output redaction.** Credential redaction in output.

Seatbelt can also make the private-dir mask a real boundary on macOS, which the virtual layout never could.

## Open questions

- How Windows spells real paths inside a POSIX shell (`/c/Users/...`, as Git Bash does), and what that does to paths the agent shows the person.
- Whether sandboxed `python` keeps its place as the default once `python-native` can read granted folders in place. It still needs no install and has no native reach, which matters most where no OS sandbox runs.
- Whether a native command reaching an Ask first place should be refused up front from its command line, or only after Seatbelt refuses it, when the card comes up and the command runs again.
