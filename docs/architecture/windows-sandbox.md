# The sandbox on Windows

What holds the agent to Settings › Permissions on Windows, what MXC adds when it is on, and what it still leaves open.

## What holds everywhere

The agent's own tools follow the Permissions rules on every platform: the shell's builtins (`cat`, `ls`, `rg`, `cp`, and the rest) and the file tools check each path against the rules before they touch it, refuse what is Not allowed, and ask before a folder marked Ask first. The shell spells a Windows path the POSIX way, `D:\Photos` as `/d/Photos`, and converts it back at the edge for native commands and for anything shown to the person.

## Native programs

A native program the agent runs (`python`, `node`, `uv`, `pnpm`, `git`, `ffmpeg`, uutils, anything on the PATH) is held by the operating system on macOS (Seatbelt) and Linux (bubblewrap), from the same rules. On Windows that is Microsoft's MXC (`@microsoft/mxc-sdk`), and only when the app runs with `INSTRUMENT_MXC=1`; without it, native programs run with the person's own access, so a script can read or change any file the person can, and Settings › Permissions says so in plain words, with a link to this page.

### How MXC holds a program

`wrapNativeCommand` (`lib/native-sandbox/index.ts`) returns MXC's launcher, `wxc-exec.exe`, which Studio ships alone in `resources/mxc/` (`scripts/download-mxc.ts`, pinned by hash; it is signed by Microsoft and needs nothing else from the package). `launchNative` then builds the request once the working folder and environment are known, since the container inherits neither from the launcher, and every caller spawns through it.

The request asks for MXC's Tier 1, BaseContainer, the process security environment Windows 11 24H2 and later provide, which needs no administrator step. It refuses the fallback that would add ACEs to the person's folders (`fallback.allowDaclMutation: false`), so a machine without Tier 1 fails the spawn rather than having its folders edited. UI stays enabled in the request: with it disabled, anything importing USER32, Node and Electron run as Node among them, fails to start with `STATUS_DLL_INIT_FAILED`. The clipboard and input injection stay closed by MXC's defaults. The network is open, as it is to native commands everywhere.

The filesystem lists come from `mxcFilesystemPolicy`, the Seatbelt profile again in MXC's terms, where the deepest entry holding a path decides: the system drive and the home folder readable, each rule's folder opened or closed, the reach's own folders, the app's install, the names that run code already in an allowed folder read-only, and the app's sandbox folder closed. A closed folder above an open one is also listed for looking at (`enumeratePaths`), so a program can `lstat` its way down (Node's `realpath` does) while the folder still refuses listing and reads. A path MXC would reject (no drive, or a missing folder above it) is left out, as is a missing path nothing could make. A reach's policy is kept for a second, so a pipeline's stages share one.

### The canary

Whether MXC holds on a machine is decided by running it, not by the Windows build (`lib/native-sandbox/mxc-canary.ts`). Before the first command, the launcher's own probe must report Tier 1 with no ACEs to add, and then one real spawn of the app's `node`, through the same generator and launcher, must show three things: a file in a granted folder reads, `fs.realpathSync.native` resolves it to its drive-letter path ([microsoft/mxc#1464](https://github.com/microsoft/mxc/issues/1464), which a check that only asks whether a program ran would pass), and a closed folder can neither be read nor an ungranted one written, judged from outside by what was read or made. The verdict is kept per Windows build with its update revision and per launcher, in a folder every request closes. If any condition fails, native commands run unwrapped and the Settings notice stays; if the canary gives no answer, the command is refused and the next one tries again.

### Cost

Each program starts in a container of its own, about 55 ms on top of starting it, and about 90 ms through the agent's shell, which also builds the request. A pipeline pays that start once per stage, and the bytes the app relays between stages on Windows cross the container's boundary at each one. [The plan](../plans/active/windows-sandbox-mxc.md) has the measurements and what is left to do.

### What MXC leaves open

- A `node` script has no `tools` global: Node's IPC channel is an inherited handle the container does not get.
- A CommonJS script below a closed folder with no `package.json` between fails, since Node looks for one in every folder above it and stops on the refused read. A chat's folder carries one from the template.
- A repository's `.git` can be renamed out from under the read-only grant on its hooks.

## Related

- [agent-sandbox.md](agent-sandbox.md): how every layer applies the rules.
- [The agent works at real paths](../decisions/2026-10-11-the-agent-works-at-real-paths.md): the decision behind the rules and the native sandbox.
- `scripts/sandbox-bakeoff/`: the probe that measures each platform's sandbox against real workloads.
- Measuring anything that runs a program on Windows takes the interactive session, as the test host's scheduled tasks run: over a bare SSH command, every program importing USER32 fails whatever the policy says.
