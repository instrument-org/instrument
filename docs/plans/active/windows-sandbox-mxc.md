# Windows sandbox: MXC behind `wrapNativeCommand`

Status: **active.** Phase 1 is built: the canary and an MXC backend, verified on the test PC (below). Phase 2 is built but for the bake-off runner: MXC holds native commands by default wherever the launcher ships and the canary passes, `INSTRUMENT_MXC=0` turns it off, and the Settings notice, with a critical bell notice since `970871632`, shows only where it does not hold; what a chat's programs need under the container (Node's package.json look, the `tools` channel, the folders under `AppData` programs keep, `uvx`) is done and verified on the PC; the ssh-agent is measured and left open. Phase 3 is not started. [windows-sandbox.md](../../architecture/windows-sandbox.md) is the evergreen description and changes only as each phase lands.

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
- A folder named in `deniedPaths` answers `lstat` and `stat` on its own; a folder below it that the deny closes does not, unless it is in `processContainer.filesystem.enumeratePaths`, which answers `lstat` and refuses reads but lets the folder be listed and every name in it stat'd (size, dates), all the way down to a folder denied by name below it: more than Seatbelt's metadata reads, which list nothing. Without that, Node's JS `realpath` (which lstats every folder on the way, and which ESM `--import` uses) fails for any file below a closed folder, such as a chat folder under `AppData` (`EPERM, lstat ...\AppData\Local`). MXC drops an `enumeratePaths` entry that is also denied. A denied folder whose nearest listed folder above is denied as well (the runtime folder inside the app's data folder) refuses `lstat` even when it is named to look at.
- A held program runs at low integrity, with the administrators group deny-only and no AppContainer SID in its token. The launch sets its `TEMP`, `TMP` and `LOCALAPPDATA` to a profile under `AppData\Local\Packages` made for that launch and removed when it ends, whatever the request's environment says; a program it starts keeps the environment it is given.
- A named pipe the program can open needs an ACE for `ALL APPLICATION PACKAGES` as well as Everyone (`D:(A;;GA;;;WD)(A;;GA;;;AC)` works, with or without a low label). Node's pipes refuse it, with the default ACL or `readableAll`/`writableAll`, and `icacls` cannot change a pipe's DACL; OpenSSH's agent pipe (`SY`, `BA`, `AU`) refuses it too. Loopback TCP, v4 and v6, connects.
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

In an unsigned NSIS preview with MXC on by default, through a real chat's shell, the mean of ten runs in one loop, two runs each, with `INSTRUMENT_MXC=0` as the unwrapped side. The text commands here run unwrapped (`unsandboxed-uutils.ts`), so they cost the same either way:

| Work | Unwrapped | Under MXC | Added |
| --- | --- | --- | --- |
| `node -e 0` | 53 ms | 175 to 211 ms | about 140 ms |
| `python -c 0` | 40 to 50 ms | 195 to 204 ms | about 155 ms |
| `git -C repo status` | 41 ms | 192 ms | about 150 ms |
| `powershell.exe -NoProfile -Command exit` | 163 ms | 342 ms | about 180 ms |
| `cmd /c exit 0` | 85 to 130 ms | 125 to 190 ms | about 60 ms, noisy |

A held program starts about 150 ms later there, more than the 90 ms the phase 1 shell measured; where it goes (the request, now with `AppData`'s enumerated folders and denied names, or the policy check) is not measured yet.

The same preview, driven through real chats on GLM 5.3 Flash: files and a summary in the work folder, a matplotlib chart, `node count.js` with no package.json, `pnpm add is-odd` then `require`, `git init`/`commit`/`status` and Windows PowerShell 5.1's `Get-Location` in the work folder and in a granted folder under Documents (the folder, never `C:\`), a granted Documents file behind its card, a Downloads file declined at its card, `AppData\Roaming` listed and a file in one app's folder behind a card naming that app, a node server stopped with `kill bg_1`, `/tmp` shared between the shell and Python, and `ssh-add -l | sort` twice with no card. Held programs ran under `wxc-exec` at Low integrity. `kill`, `taskkill` and `Get-Process` did not reach a process outside the chat; since a held program sees only its own processes, the agent took "not found" for "gone" and said a running process had exited, and answered "what's using CPU?" with the sandbox's own processes before saying it could not see the rest.

What Windows serves through another process, measured on the PC (Windows 11 26200.9711) through a chat's shell, unwrapped and held. None of it follows the filesystem policy, so the policy changes since leave it as measured:

| Command | Unwrapped | Under MXC | Cause |
| --- | --- | --- | --- |
| clipboard (`Set-Clipboard`, `clip.exe`) | works | fails, also with `ui.clipboard: "all"` | broker |
| `start file.txt`, `explorer.exe .` | opens | nothing opens | broker |
| `start https://...` | opens a tab | waits until killed | broker |
| `Start-Process <url>`, choco's shim | works | `Access is denied` | ShellExecute |
| `Get-CimInstance`, `Get-Printer`, `Get-Volume`, `systeminfo` | works | `Access to a CIM resource was not available` | WMI over DCOM |
| `Get-Process`, `tasklist` held | every process | only the command's own | process ACLs at low integrity |
| `ping` | works | `Unable to contact IP driver` | ICMP |
| `cmdkey /list` | the person's credentials | none | credential store |
| `reg add HKCU\...`, `setx`, `schtasks /create` | works | refused | low integrity |
| COM in process (`Scripting.FileSystemObject`, `WScript.Shell`), fonts | works | works | |

## Approach

### A third backend behind `wrapNativeCommand`

`wrapNativeCommand(file, args, reach)` already returns `{ file, args, reach }` for execa or `spawn`. On Windows, with MXC on and the canary passed, it returns the launcher with the program and its policy, and `launchNative` turns that into `wxc-exec.exe --config-base64 <request>` once the working folder and environment are known, with the program's command line quoted into the request as Node would quote it (or joined as given for a verbatim `cmd.exe` line). Every caller (`execShim`, `startPipeStage`, `execaNodeForChat`, `run-uv`, `python-base`) goes through `launchNative` and otherwise spawns as before, with the same stdio, cwd, environment allowlist, cancellation and process-tree kill. `wxc-exec` runs the program in a job object with kill-on-close, so killing `wxc-exec` (what `child.kill` and `watchSubprocessTree` do on Windows) ends the program and everything it started.

The request, MXC policy 1.0.0:

- `containment: "processcontainer"`, `fallback.allowDaclMutation: false`, so a host where Tier 1 cannot serve the request fails the spawn instead of dropping to Tier 3 and editing ACLs.
- `process.cwd` is the spawn's cwd, `process.env` is the environment execa would have passed (the allowlist plus the shim's own), since the container does not inherit `wxc-exec`'s. The program starts through uutils' `env` with `TEMP` and `TMP` put back to the temp folder the environment names (`withTempRestored`), so a file it leaves there outlives it and is the one the shell's `/tmp` names; a verbatim `cmd.exe` line and a batch file start as they are. A spawn with no cwd leaves it out rather than read `process.cwd()`, which a running shell blocks; the program then starts in its own folder.
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
- A denied folder with an open entry below it goes in `enumeratePaths` instead of `deniedPaths`: one denied by name breaks git (`failed to stat '<pad>C:/Users/x/<denied>'`) and makes Windows PowerShell 5.1 start in `C:\` for anything working below it, and an enumerated one breaks neither. A folder of the app's own data is enumerated only on the way to one of the reach's read-write folders (the chat's work folder, the runtime's caches), and each folder in it off that way is denied by name, so the names of its keys, profiles and records stay closed.
- A denied entry whose nearest listed folder above is denied too is left out: the deny above closes it already, and MXC would refuse it `lstat`. Below an enumerated folder it stays, so its names do not show.
- Each folder a deny above closes on the way to an open entry goes in `enumeratePaths`, so a program can `lstat` its way down to what it may read. A readable folder never does, since MXC would narrow it to looking.
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

`refusedPathIn` read a refusal from a program's output to raise the right card; it is gone now that the agent asks with `ask_permission` ([explicit-permission-asks.md](explicit-permission-asks.md)), so what follows matters only for what the agent reads. On Windows the programs say it differently and name paths with backslashes: Node's `EPERM: operation not permitted, open 'C:\...'`, Rust tools' `Access is denied. (os error 5)`, git's `Permission denied`. Phase 1 adds `Access is denied` to the refusals and lets the path finder take drive-letter and UNC spellings; the note it appends spells a path the way the person sees it (`C:\Users\sam\Documents`). Each pipeline stage is its own container and reads its own stderr, so attribution per stage needs nothing new.

MXC's own capture of denials (`processContainer.captureDenials`, Learning Mode ETW) could name the exact path the OS refused, the way the macOS `log stream` idea would; it needs a trace session per run and is phase 3 at the earliest.

### Settings and copy

With MXC holding commands, the notice in Settings › Permissions goes away, as on macOS and Linux. Where the canary failed, the notice stays with today's words. Nothing new is said to the person in phase 1; whether to say why it fell back (an older Windows build) is a phase 2 question.

### Windows builds

MXC's own table puts process isolation at 26100.9278 (24H2) and 26200.9278 (25H2) and later; #1464 was still there at 9457 and gone at 9711. Nothing in the app keys off those numbers: the canary decides on each machine and each build. Windows 10 and Windows 11 before 24H2 have no Tier 1, so the probe reports another tier and the canary fails at its first step.

### Packaging

Only `wxc-exec.exe` is needed: it runs standalone, and the SDK's Node bindings (koffi, node-pty, about 105 MB across every platform) are not used. A `download-mxc.ts` beside `download-uv.ts` fetches the `@microsoft/mxc-sdk` tarball from the npm registry, checks it against a pinned sha256, and keeps `bin/<arch>/wxc-exec.exe` for the Windows target (12 MB on x64, 6 MB on arm64) in `resources/mxc/`, which `asarUnpack` already ships. It is signed by Microsoft. The workspace config carries its path as `mxcExecPath`, the way it carries `seatbeltHelperPath`.

### Gaps MXC leaves

- **The ssh-agent.** OpenSSH's agent pipe refuses a held program, and a relay pipe the app makes with Node refuses it as well (above), so `ssh` in a chat allowed `~/.ssh` finds no agent under MXC. Closing this needs a pipe made with an `ALL APPLICATION PACKAGES` ACE, which takes native code the app does not ship.
- **Names that run code, by renaming the folder holding them.** Seatbelt denies unlinking `.git` and bubblewrap mounts it in place; MXC has neither, so a program can move `.git` aside, write hooks into it and move it back. This is a known, accepted gap rather than phase 2 work ([threat model](../../architecture/threat-model.md#what-we-do-not-protect), [decision](../../decisions/2026-10-17-accept-the-git-rename-gap.md)).

Closed in phase 2:

- **The `tools` global.** Node's IPC handle does not reach the program, so `tools` goes over loopback TCP with a per-process token, on every platform; a call takes about 0.1 ms on the PC, held or not.
- **A script below a closed folder with no `package.json` between.** Node 24.21 (Electron 44's) looks for a `package.json` in every folder above a `.js` or `.ts` file and fails outright (`Cannot read package config ...\AppData\package.json: operation not permitted`) when a closed folder refuses the read, where a missing file would be fine. Neither an enumerate nor a read-only grant of that one `package.json` helps, and no chat folder carries a `package.json`. The preload every `node` imports reads past the refusal: a `module.registerHooks` resolve hook, and a wrapper on the CommonJS loader's `.js` handler, which reads the type before any hook runs. CommonJS, ES module syntax in `.js`, `.mjs`, `.ts` and a missing package all behave as unwrapped in the work folder, a visible Chats folder and a granted folder under Documents. A Node another program starts (a child process) still fails, and its command says how past it.
- **Programs installed under `AppData`.** `AppData\Local\Programs` is readable to every chat, and `AppData\Local\Packages` (the launch's own profile) writable: python.org's Python runs, imports `ssl` and `sqlite3`, and makes a venv; `uv venv` and `pip install` work.
- **`uvx`** probed a winget `uv` under `AppData` and failed; it is the bundled uv's `uv tool run` now.

## Phases

1. **Canary and backend behind a flag.** `INSTRUMENT_MXC=1` in the app's environment turned MXC on; off by default. The generator, the canary with its per-build cache, `wrapNativeCommand`'s third branch, `nativeSandboxEnforced()` reading the verdict, Windows refusal attribution, `download-mxc.ts` and `mxcExecPath`. Unit tests for the generator (lists, ordering, the `reachOf` cross-check) and for the canary's verdict handling. Verified on the PC in the interactive session (`mxc-canary.test.ts` and `mxc-shell.test.ts` run there with `INSTRUMENT_TEST_MXC_EXEC` and `INSTRUMENT_MXC=1`): the three conditions pass; each forced to fail (`INSTRUMENT_MXC_CANARY_FAULT=grant|realpath|refuse`, which misgenerates the policy or reaches the file through a junction into a closed folder) fails the canary and leaves commands unwrapped with `nativeSandboxEnforced()` false; a chat's shell is refused a closed folder, per pipeline stage with the card's note; `pipe-stage.test.ts` and the native-pipes tests pass under MXC; the background-process tests failed five more cases under MXC than without it, on Node's package.json look, until phase 2's preload read past it.
2. **On by default where the canary passes.** The `tools` channel, Node's package.json look, `AppData` programs and `uvx` above (done), and the ssh-agent (measured, open); the sandbox bake-off's `mxc` runner moved to the Windows backend and run in the interactive session; a preview build driven on the PC through a real chat. The Settings notice goes away where MXC holds. On by default, with `INSTRUMENT_MXC=0` turning it off.
3. **Later.** Denial capture for exact paths, and the arm64 build on an arm64 machine.

## Not doing

- **Tier 3 or any host preparation.** It needs an administrator and edits ACLs on the person's folders.
- **A minimum Windows build in the app.** A floor would ship #1464 to a build in range that has not taken the update, and would refuse a machine where it works; the canary asks the machine.
- **The SDK's in-process bindings.** They load koffi and node-pty into the app for no gain over the executable.
