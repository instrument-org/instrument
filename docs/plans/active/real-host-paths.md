# Plan: real host paths, held to the Permissions rules

Status: proposed. Step 1 is spiked (a Seatbelt profile around native commands, denying passwords and sign-ins); nothing else is started. Tracked in FP-1371 with the Permissions list it depends on. Replaces the virtual layout's reason for being, and with it the "the main agent never learns where anything lives" premise of [agent-requested-folder-access.md](agent-requested-folder-access.md).

## Summary

The agent sees folders at virtual paths: its chat's folder at `/task`, folders it was given under `/mnt/<name>`, skills under `/skills`. Every native command (node, python-native, uv, pnpm, ffmpeg, git, osascript) is handed only bridged or quarantined paths, and its output is rewritten back. That layout existed because nothing at the OS level stopped a native command from writing anywhere, so a host path was never allowed to reach one.

It never contained anything. The [sandbox map](../../architecture/agent-sandbox.md) says native commands have the host user's full filesystem, and [the private-dir mask is not a boundary](../../findings/private-dir-masking-is-not-a-boundary.md). What it did produce was detours:

- A task copied a 2.2 GB folder into its own folder to run nine lines of standard-library Python ([decision](../../decisions/2026-09-10-python-is-the-sandboxed-interpreter.md)).
- Seven of 335 tasks hit git's refusal on a given folder, including weekly reviews running `git log` ([decision](../../decisions/2026-09-11-git-reaches-attached-folders.md)).
- The agent copied a file the person already had into the only writable mount and handed back the copy ([finding](../../findings/a-fetched-file-gets-copied-somewhere-writable.md)).

The one protection the quarantine gave is real: a native command cannot overwrite a person's file through a path on its command line. The Permissions rules give the same protection by rule rather than by hiding, and on macOS give it for what a script reaches on its own too. Once they are enforced, the agent works at real paths everywhere, and the virtual layout and its translation code are deleted.

## What enforces reach

One set of rules, from Settings › Permissions: a path at any depth is Allowed, Ask first or Not allowed, the deepest rule wins, and a chat's own grants (a folder attached to it, a card answered in it) are allows that win at an equal path. Every layer asks the same question of a host path:

| Layer | How it applies the rules | Platforms |
| --- | --- | --- |
| File tools, `rg`, `du` | `classifyHostPath` per path | All |
| just-bash builtins, sandboxed `python` and `js-exec` | The virtual filesystem, now mounting each reachable folder at its host path | All |
| In-app browser `file://` reads | The CDP bridge and `tab read` check | All |
| Native command lines | Every path argument checked before spawning: Not allowed refused, Ask first raises the card | All |
| What a native command's code reaches on its own | An OS sandbox around the spawn, generated from the rules | macOS now; Linux and Windows per the steps below |

The chat's own folder stops being `/task`. The prompt names it as the place the chat works and keeps what it makes, at its real path.

Where an OS sandbox is not available, Settings › Permissions says the list is followed as closely as Instrument can, and that a program the agent runs could still reach other folders.

## Steps

1. **Seatbelt for native commands on macOS.** Every spawn through `execShim` and `execaNodeForTask` runs under `/usr/bin/sandbox-exec` with an allow-by-default profile that denies the places that hold passwords and sign-ins. Measured on macOS 27: uv installs with numpy and pandas, pnpm with a native addon, ffmpeg, git over https and osascript all run; reads under `~/.ssh`, `~/.config/gh` and Keychains are refused, including from a script's own subprocess; about 6 ms per spawn. Not yet run from the signed, hardened app.
2. **The Permissions rules, enforced.** The rules feed every layer in the table. The Seatbelt profile gains the Not allowed and Ask first places, and denies writes across the home folder outside granted folders, which means allowing what native tools write themselves: `~/Library/Caches`, `~/.cache`, the pnpm store, uv's folders, the chat's own folder. This is where native tools are most likely to break, so it gets the same real-workload run before it ships. A refusal under an Ask first place raises the card and the agent runs the command again after Allow.
3. **Real paths.** Remove `/task`, `/mnt`, the native-command bridge, output rewriting and chat-to-task path translation (inventory below). The prompt's folder guidance becomes a statement of where the chat works and which folders it holds.
4. **Linux: bubblewrap.** Hide a denied folder with `--tmpfs`, a denied file with `--ro-bind /dev/null`, and bind nested allows back over them. Probe at launch and fall back to unenforced with the Settings note. Ubuntu 24.04 blocks unprivileged user namespaces unless an AppArmor profile for `bwrap` is installed with root, which a `.deb` can do and an AppImage cannot; a bundled copy at another path stays blocked.
5. **Windows: a spike on Microsoft's MXC.** AppContainer through `@microsoft/mxc-sdk` (MIT), also what Codex uses. It is deny-by-default, so the rules become a list of granted trees (the user profile, tool folders, granted folders); it needs a one-time admin step and Windows 11 24H2 or later, and calls itself an early preview. Worth carrying as experimental if it fails safe: a probe at launch, and the Settings note when it cannot run.

Node's permission model (`--permission` with `--allow-fs-*`) is not a substitute: it covers node alone, not python-native, uv, ffmpeg or git.

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
