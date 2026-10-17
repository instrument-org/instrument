# The sandbox on Windows

What holds the agent to Settings › Permissions on Windows, what MXC adds when it is on, and what it still leaves open.

## What holds everywhere

The agent's own tools follow the Permissions rules on every platform: the shell's builtins (`cat`, `ls`, `cp`, and the rest) and the file tools check each path against the rules before they touch it, refuse what is Not allowed, and ask before a folder marked Ask first. `rg` is the real ripgrep binary, which nothing sandboxes on Windows: the paths it is given are checked against the rules and its walk leaves the app's own data out, but it reads what the person can. The shell spells a Windows path the POSIX way, `D:\Photos` as `/d/Photos`, and converts it back at the edge for native commands and for anything shown to the person.

## Native programs

A native program the agent runs (`python`, `node`, `uv`, `pnpm`, `git`, `ffmpeg`, uutils, anything on the PATH) is held by the operating system on macOS (Seatbelt) and Linux (bubblewrap), from the same rules. On Windows that is Microsoft's MXC (`@microsoft/mxc-sdk`), and only when the app runs with `INSTRUMENT_MXC=1`; without it, native programs run with the person's own access, so a script can read or change any file the person can, and Settings › Permissions says so in plain words, with a link to this page.

### How MXC holds a program

`wrapNativeCommand` (`lib/native-sandbox/index.ts`) returns MXC's launcher, `wxc-exec.exe`, which Studio ships alone in `resources/mxc/` (`scripts/download-mxc.ts`, pinned by hash; it is signed by Microsoft and needs nothing else from the package). `launchNative` then builds the request once the working folder and environment are known, since the container inherits neither from the launcher, and every caller spawns through it.

Microsoft's MXC (`@microsoft/mxc-sdk`, AppContainer-based) is the candidate. It is deny-by-default, so the rules become a list of the folders a program may reach: the user's tool folders, the chat's work folder, and the folders granted. It needs Windows 11 24H2 or later. It needs no administrator step for the mode we would use: `wxc-host-prep`'s `prepare-system-drive` grants AppContainer SIDs, which is a different tier, and a run from an unelevated token reports `needsDaclAugmentation: false`.

Two things were recorded here as blocking it, and both were re-tested on build 26200.9711 and did not hold.

[microsoft/mxc#1464](https://github.com/microsoft/mxc/issues/1464), where a program inside the base container cannot turn an open file back into a drive-letter path, does not reproduce on that build: `GetFinalPathNameByHandleW` with `VOLUME_NAME_DOS` answers, `fs.realpathSync.native` works, and `git status`, `rev-parse`, `log` and `commit` exit 0 **with no grant on the drive root at all**, which is what the earlier reading of this said was impossible. Only `QueryDosDevice` is still refused, and nothing here calls it. The issue's reporters were on 26100.9457, so the floor sits somewhere between the two and one host cannot narrow it.

`STATUS_DLL_INIT_FAILED` was the harness, not MXC. It is [microsoft/mxc#1465](https://github.com/microsoft/mxc/issues/1465): from a session-0 or network-logon token every binary importing USER32 dies with `0xC0000142`, whatever the UI policy says. Our bake-off ran over SSH. On the same host with the same policy, in an interactive session, node, git and powershell all exit 0. Granting the whole of `C:\` read-write did not help, which is what rules out a DLL search path; Git's own `env.exe` named the real refusal, `NtCreateDirectoryObject(\BaseNamedObjects\msys-2.0...)` with `0xC0000022`, which is [microsoft/mxc#1061](https://github.com/microsoft/mxc/issues/1061).

Note that `scripts/sandbox-bakeoff/probe.ts` cannot produce a Windows result: it reads `const mac = process.platform === "darwin"`, runs everything through `/bin/sh -c`, and asks for `containment: { type: mac ? "seatbelt" : "bubblewrap" }`. Whatever produced the earlier Windows verdict is not in this repository, which is reason enough to re-measure rather than read.

Two things are settled about how it would ship. The elevated tier is out:
it wants an administrator-approved setup with local accounts and firewall
rules, and this is not an app whose user should have to understand that. And
git runs with the person's own `.gitconfig` readable, rather than with HOME
redirected and `GIT_CONFIG_NOSYSTEM` set: a chat that commits as the wrong
author is worse than one more file in the list, and the app has no business
pretending the person's own tools are configured differently than they are.

What is not settled is the version floor, and the fallback matters more than
the floor does: an older Windows drops silently to the AppContainer tier,
where #1464 does bite. Silently is the wrong behavior. Settings says plainly
there which Windows this is, that the sandbox is not protecting it, and what
updating would change.

So Windows 11 at a build still to be pinned runs native programs under MXC, generated from the same rules as Seatbelt and bubblewrap, behind the same `wrapNativeCommand` seam (`wxc-exec.exe --config-base64 <b64> -- <cmd>` fits its `{file, args}` return, and `--dry-run` makes a generated policy testable without running anything), and the notice in Settings goes away there. It costs about 45 ms a spawn against roughly 6 ms for Seatbelt. Older Windows stays as it is, with the notice.

## Related

- [agent-sandbox.md](agent-sandbox.md): how every layer applies the rules.
- [The agent works at real paths](../decisions/2026-10-11-the-agent-works-at-real-paths.md): the decision behind the rules and the native sandbox.
- `scripts/sandbox-bakeoff/`: the probe that measures each platform's sandbox against real workloads.
- Measuring anything that runs a program on Windows takes the interactive session, as the test host's scheduled tasks run: over a bare SSH command, every program importing USER32 fails whatever the policy says.
