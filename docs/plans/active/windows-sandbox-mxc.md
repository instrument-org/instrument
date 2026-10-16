# Windows sandbox: MXC behind `wrapNativeCommand`

Status: **active.** Phase 1 is built: the canary and an MXC backend behind `INSTRUMENT_MXC=1`, off by default, verified on the test PC (below). Phases 2 and 3 are not started. [windows-sandbox.md](../../architecture/windows-sandbox.md) is the evergreen description and changes only as each phase lands.

## Problem

On Windows a native program the agent runs (`python`, `node`, `git`, `uv`, uutils, anything on the PATH) runs with the person's own access, whatever Settings › Permissions says. macOS wraps each one in Seatbelt and Linux in bubblewrap, both generated from the same rules `reachOf` answers; Windows has nothing behind `wrapNativeCommand`, and Settings says so.

Microsoft's MXC (`@microsoft/mxc-sdk`, MIT, 1.0.0) is the candidate. Its Windows backend, ProcessContainer, picks one of three tiers: Tier 1 (BaseContainer, the OS's process security environment from `processmodel.dll`), Tier 2 (AppContainer with BFS, not compiled into the release binaries), and Tier 3 (AppContainer with ACEs added to the host's folders, which needs an administrator's one-time host preparation). Only Tier 1 is acceptable: Tier 3 needs admin setup and rewrites the person's folder ACLs. So it is Tier 1 or nothing.

What was believed to block Tier 1 turned out to be wrong or fixed:

- `STATUS_DLL_INIT_FAILED` for node and git came from measuring over plain `ssh host <cmd>`, a session-0 / network-logon token in which every binary importing USER32 dies with `0xC0000142`. In the interactive session the scheduled tasks use, they run.
- Inside the interactive session, MXC's default `ui.disable: true` causes the same `0xC0000142` for anything importing USER32 (node, Electron as node). `ui.disable: false` is required; the clipboard and input injection stay closed by their own defaults.
- [microsoft/mxc#1464](https://github.com/microsoft/mxc/issues/1464) (`GetFinalPathNameByHandleW` with `VOLUME_NAME_DOS` refused, so `fs.realpathSync.native` and git's cwd fail) reproduces on 26100.9457 and 26200.9457 but not on 26200.9711: the fix shipped in a Windows cumulative update, not in MXC. The issue is still open, and an older build still has it. That is why the runtime canary below, not a build floor, decides.

## Measured on the test PC (Windows 11 26200.9711, x64, interactive session, `wxc-exec.exe` 1.0.0)

- `wxc-exec --probe`: tier `base-container`, `needsDaclAugmentation: false`, `baseContainerSupportsDenyPaths: true`.
- A file in a granted folder reads; `fs.realpathSync.native` returns `C:\...`; a read of a folder no grant covers fails with `EPERM`; with only a deep folder granted, the program starts there, resolves its cwd and writes in it.
- Nesting is deepest-wins, the shape `reachOf` and Seatbelt have: a read-only folder inside a read-write one refuses writes, a read-write folder inside a read-only one takes them, and a denied folder inside a read-only one refuses reads.
- stdio passes through: `wxc-exec` hands its own std handles to the program, so pipes, stdin and exit codes (7 stays 7) behave as an unwrapped spawn's. A program that is not found exits `-1` with MXC's JSON error on stderr.
- Node's IPC channel (a fourth inherited handle) does not reach the program: `process.send` is undefined inside.
- `wxc-exec` runs standalone from its own folder, with nothing else from the package beside it, and is signed by Microsoft.
- A repository's `.git` can be renamed while `.git\hooks` is read-only, and hooks written into the moved copy: read-only grants hold a name, not the folder holding it.
- The container does not inherit the launcher's environment or working folder: with none given, the program gets the user's default environment and starts in its own folder.
- A path named in two lists gets the narrower access. A missing path is accepted and held (a denied one cannot be made), but a path whose folder is missing, or a Windows path with no drive, fails the whole request with `ERROR_PATH_NOT_FOUND`.
- A denied folder that is also in `processContainer.filesystem.enumeratePaths` answers `lstat` but still refuses listing and reads, the counterpart of Seatbelt's metadata reads. Without it, Node's JS `realpath` (which lstats every folder on the way, and which ESM `--import` uses) fails for any file below a closed folder, such as a chat folder under `AppData`.
- Each denied path costs about a third of a millisecond at every start: 70 of them took a start from 71 to 95 ms.

Cost, medians of 9 to 15 runs:

| Work | Unwrapped | Under MXC | Added |
| --- | --- | --- | --- |
| `cmd /c exit 0` | 18 ms | 73 ms | 55 ms |
| `node -e 0` | 42 ms | 97 ms | 55 ms |
| one stage, through the app's relay | 25 ms | 80 ms | 55 ms |
| four stages (`type \| findstr \| sort \| findstr`), through the app's relay | 51 ms | 147 ms | 96 ms |

A pipeline pays the container's start once per stage. Stages start together, so four stages add less than four starts end to end, but each one is its own container and its own `wxc-exec` process.

Through the agent's shell (`bash.exec` in a chat, phase 1 as built, uutils for the text commands), where each start also builds the request from the rules:

| Work | Unwrapped | Under MXC | Added |
| --- | --- | --- | --- |
| `head -1 words.txt` | 25 ms | 115 ms | 90 ms |
| `node -e 0` | 53 ms | 147 ms | 94 ms |
| `sort words.txt \| uniq -c \| sort -rn \| head -3` | 47 ms | 211 ms | 164 ms |

Building the policy from a chat's rules takes about 50 ms (realpaths of every rule's folder and the walk for names that run code); a policy is reused until the rules change or a path it read does, which a stat of each tells (about 0.6 ms against 12 ms to build on an M5 Max). The rest is the launcher's start and a request of about 45 paths; fewer paths per request is phase 2 work.

## Approach

### A third backend behind `wrapNativeCommand`

`wrapNativeCommand(file, args, reach)` already returns `{ file, args, reach }` for execa or `spawn`. On Windows, with MXC on and the canary passed, it returns the launcher with the program and its policy, and `launchNative` turns that into `wxc-exec.exe --config-base64 <request>` once the working folder and environment are known, with the program's command line quoted into the request as Node would quote it (or joined as given for a verbatim `cmd.exe` line). Every caller (`execShim`, `startPipeStage`, `execaNodeForChat`, `run-uv`, `python-base`) goes through `launchNative` and otherwise spawns as before, with the same stdio, cwd, environment allowlist, cancellation and process-tree kill. `wxc-exec` runs the program in a job object with kill-on-close, so killing `wxc-exec` (what `child.kill` and `watchSubprocessTree` do on Windows) ends the program and everything it started.

The request, MXC policy 1.0.0:

- `containment: "processcontainer"`, `fallback.allowDaclMutation: false`, so a host where Tier 1 cannot serve the request fails the spawn instead of dropping to Tier 3 and editing ACLs.
- `process.cwd` is the spawn's cwd, `process.env` is the environment execa would have passed (the allowlist plus the shim's own), since the container does not inherit `wxc-exec`'s. A spawn with no cwd leaves it out rather than read `process.cwd()`, which a running shell blocks; the program then starts in its own folder.
- `ui: { disable: false }` (see above); clipboard and injection keep their closed defaults.
- `network`: egress, ingress and host loopback all allowed. The network is open to native commands on every platform ([the decision](../../decisions/2026-10-12-the-shell-stays-just-bash-and-real-programs-do-the-rest.md)), and a dev server the agent starts has to be reachable from the in-app browser.
- `filesystem`, generated from the rules (`mxcFilesystemPolicy`, below).

The command line is capped at 32,767 characters; the request is base64 of a few kilobytes. A request that would not fit is written to the app's sandbox folder (closed to every native command, below) and passed with `--config`.

### Generated from the same rules

`mxcFilesystemPolicy(reach)` is `seatbeltProfile` and `bwrapArgs` again, as MXC's three lists, ordered the same way and with the same deepest-wins meaning, which the PC confirmed:

- The system drive's root is read-only, which is what `reachOf` says of a path no rule holds (readable, asks before it changes). Everything else is reached only through an entry below.
- The home folder is read-only (rank -1, as Seatbelt's write deny at the home), so an allow above it opens nothing in it to change.
- Each rule at its path, with "Use folders without asking" applied (`levelWithoutAsking`): allow is read-write, `readOnly` is read-only, ask, never and hidden are denied. A rule for a folder's hidden entries (`dotEntries`) is each hidden entry listed by name, as bubblewrap does, since MXC has no patterns.
- The reach's own folders at rank 3: `readOnly` (skills, the app's bin folder, the managed Pythons) read-only, `readWrite` (the chat's folder, uv's data, node-tools, apps) read-write.
- The app's install folder (`process.execPath`'s and `process.resourcesPath`) read-only: it lies under `AppData`, a place that asks, and `node` is Electron run as Node, `git` is dugite's and `rg`, uutils and ffmpeg are in `resources`.
- The app's sandbox folder (where the canary's verdict and any oversized request live) denied, so no wrapped program can forge a verdict that turns the sandbox off.
- Names that run code: the walk bubblewrap already does (`namesThatRunCode`) finds each one in an allowed folder, and each is read-only. MXC has no mount points, so the rename that bubblewrap prevents is open here (see the gap below).
- One entry per path; at an equal path the higher rank wins, as `ruleRank` orders.
- Each closed folder above an open entry goes in `enumeratePaths`, so a program can `lstat` its way down to what it may read; a readable folder never does, since MXC would narrow it to looking.
- A rule's path that is missing is left out unless it sits in a folder that can be changed, where it could be made; a path with no drive, or whose folder is missing, is left out since MXC would refuse the whole request. The reach's own read-write folders are made first, as bubblewrap makes them.
- The policy is reused until the rules change or a path it read does, so a name that runs code made by one command is held from the next.

If a generated policy disagrees with what `reachOf` says of a path, that is a generator bug; the rules themselves are owned elsewhere and are not changed for MXC. The unit tests assert the lists for representative rule sets and that, for every listed path, the list it lands in matches `reachOf`'s answer for read and write.

### The canary

The condition for adopting it: a runtime canary decides, not a Windows build floor. A container that starts but silently grants everything passes a liveness check, so the canary proves three things in one real spawn, through the same generator and the same `wxc-exec` the agent's commands use:

1. **A granted folder reads.** A file the app wrote into a folder granted read-write is read back with its contents.
2. **A handle resolves to a drive-letter path.** `fs.realpathSync.native` on that file, which libuv answers with `GetFinalPathNameByHandleW(..., VOLUME_NAME_DOS)`, returns its `C:\...` path. This is the #1464 class: it does not crash, so liveness passes it.
3. **A folder not granted is refused.** A file in a folder the rules close (a "never" rule inside the read-only home) cannot be read, and a file cannot be written beside the granted folder, where nothing grants a change. This is the condition that matters most.

The program is the app's own `node` (Electron as Node), since that is what the agent runs and it imports USER32, with the script passed inline; it prints one JSON line, and anything else (a nonzero exit, unparsable output, a check that came back wrong) is a failure. Before the spawn, `wxc-exec --probe` must report `base-container` with `needsDaclAugmentation: false`. `--dry-run` only checks that a request parses and a tier is chosen; it never proves containment, so it is not part of the verdict.

A verdict is `works` or `fails` (naming the condition), cached in memory and on disk per OS build (major, minor, build and UBR, `10.0.26200.9711`, read from the registry) and per `wxc-exec` (its size and modified time), so a Windows update or a new MXC re-probes. No answer at all (a timeout) is not cached and is tried again by the next command, as the Seatbelt and bubblewrap probes do, and the command it was for is refused (`NativeSandboxUnavailableError`) rather than run unwrapped.

On `fails`, native commands run unwrapped, as today, `nativeSandboxEnforced()` is false and the Settings notice stays. The reason is logged.

### Refused paths on Windows

`refusedPathIn` reads a refusal from a program's output to raise the right card. On Windows the programs say it differently and name paths with backslashes: Node's `EPERM: operation not permitted, open 'C:\...'`, Rust tools' `Access is denied. (os error 5)`, git's `Permission denied`. Phase 1 adds `Access is denied` to the refusals and lets the path finder take drive-letter and UNC spellings; the note it appends spells a path the way the person sees it (`C:\Users\sam\Documents`). Each pipeline stage is its own container and reads its own stderr, so attribution per stage needs nothing new.

MXC's own capture of denials (`processContainer.captureDenials`, Learning Mode ETW) could name the exact path the OS refused, the way the macOS `log stream` idea would; it needs a trace session per run and is phase 3 at the earliest.

### Settings and copy

With MXC holding commands, the notice in Settings › Permissions goes away, as on macOS and Linux. Where the canary failed, the notice stays with today's words. Nothing new is said to the person in phase 1; whether to say why it fell back (an older Windows build) is a phase 2 question.

### Windows builds

MXC's own table puts process isolation at 26100.9278 (24H2) and 26200.9278 (25H2) and later; #1464 was still there at 9457 and gone at 9711. Nothing in the app keys off those numbers: the canary decides on each machine and each build. Windows 10 and Windows 11 before 24H2 have no Tier 1, so the probe reports another tier and the canary fails at its first step.

### Packaging

Only `wxc-exec.exe` is needed: it runs standalone, and the SDK's Node bindings (koffi, node-pty, about 105 MB across every platform) are not used. A `download-mxc.ts` beside `download-uv.ts` fetches the `@microsoft/mxc-sdk` tarball from the npm registry, checks it against a pinned sha256, and keeps `bin/<arch>/wxc-exec.exe` for the Windows target (12 MB on x64, 6 MB on arm64) in `resources/mxc/`, which `asarUnpack` already ships. It is signed by Microsoft. The workspace config carries its path as `mxcExecPath`, the way it carries `seatbeltHelperPath`.

### Gaps MXC leaves

- **The `tools` global.** `node`'s preload calls a connected app's tools over Node's IPC channel, a fourth inherited handle, which the container does not get. Under MXC a `node` script has no `tools` until that channel moves to something the container can open (a named pipe the app creates with an ACL for the container, or stdio framing). Phase 2.
- **Names that run code, by renaming the folder holding them.** Seatbelt denies unlinking `.git` and bubblewrap mounts it in place; MXC has neither, so a program can move `.git` aside, write hooks into it and move it back. Existing hooks folders are read-only, so the hole needs that rename. Phase 2 looks for a deny on the rename (a denied entry for the parent's own name, or a PSEC flag); until then it is listed as a known gap.
- **The ssh-agent.** On Windows it is a named pipe, which a container cannot open unless its ACL allows. A chat allowed `~/.ssh` may find `ssh` cannot reach the agent. Phase 2 measures it.
- **A CommonJS script below a closed folder with no `package.json` between.** Node 24.21 (Electron 44's) looks for a `package.json` in every folder above a `.js` file and fails outright (`Cannot read package config ...\AppData\package.json: operation not permitted`) when a closed folder refuses the read, where a missing file would be fine; Node 24.15 did not fail, and under Seatbelt the read reports a missing file. Neither an enumerate nor a read-only grant of that one `package.json` helps. A chat's folder carries a `package.json` from the chat template, so the walk stops there; a script in a granted folder under Documents with no `package.json` above it fails. Phase 2: a `package.json` the app keeps where the walk would otherwise reach a closed place, a Node flag, or an upstream fix.
- **Programs installed under `AppData`.** A program on the PATH under `AppData\Local\Programs` (Python from python.org, VS Code's `code`) sits in a place that asks first. A program started by its path ran on the PC without a grant for its folder, so starting it works; reading its own libraries beside it is what phase 2 measures.

## Phases

1. **Canary and backend behind a flag.** `INSTRUMENT_MXC=1` in the app's environment turns MXC on; off by default. The generator, the canary with its per-build cache, `wrapNativeCommand`'s third branch, `nativeSandboxEnforced()` reading the verdict, Windows refusal attribution, `download-mxc.ts` and `mxcExecPath`. Unit tests for the generator (lists, ordering, the `reachOf` cross-check) and for the canary's verdict handling. Verified on the PC in the interactive session (`mxc-canary.test.ts` and `mxc-shell.test.ts` run there with `INSTRUMENT_TEST_MXC_EXEC` and `INSTRUMENT_MXC=1`): the three conditions pass; each forced to fail (`INSTRUMENT_MXC_CANARY_FAULT=grant|realpath|refuse`, which misgenerates the policy or reaches the file through a junction into a closed folder) fails the canary and leaves commands unwrapped with `nativeSandboxEnforced()` false; a chat's shell is refused a closed folder, per pipeline stage with the card's note; `pipe-stage.test.ts` and the native-pipes tests pass under MXC; `bash-background.test.ts` fails the same two cases it fails without MXC on Windows once its test chat has the `package.json` a real chat has (without one, five more fail on the gap above).
2. **On by default where the canary passes.** The `tools` channel, the `.git` rename, the ssh-agent pipe and `AppData` programs above; the sandbox bake-off's `mxc` runner moved to the Windows backend and run in the interactive session; a preview build driven on the PC through a real chat. The Settings notice goes away where MXC holds. Turning it on by default is decided before this lands.
3. **Later.** Denial capture for exact paths, and the arm64 build on an arm64 machine.

## Not doing

- **Tier 3 or any host preparation.** It needs an administrator and edits ACLs on the person's folders.
- **A minimum Windows build in the app.** A floor would ship #1464 to a build in range that has not taken the update, and would refuse a machine where it works; the canary asks the machine.
- **The SDK's in-process bindings.** They load koffi and node-pty into the app for no gain over the executable.
