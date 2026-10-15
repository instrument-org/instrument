# The sandbox on Windows

What holds the agent to Settings › Permissions on Windows, what does not yet, and what closes the gap.

## What holds today

The agent's own tools follow the Permissions rules on every platform: the shell's builtins (`cat`, `ls`, `rg`, `cp`, and the rest) and the file tools check each path against the rules before they touch it, refuse what is Not allowed, and ask before a folder marked Ask first. The shell spells a Windows path the POSIX way, `D:\Photos` as `/d/Photos`, and converts it back at the edge for native commands and for anything shown to the person.

## The gap

A native program the agent runs (`python`, `node`, `uv`, `pnpm`, `git`, `ffmpeg`) runs with the person's own access. On macOS a Seatbelt profile built from the rules wraps each one, and on Linux bubblewrap does; on Windows nothing does yet. So a script the agent writes can read or change any file the person can, whatever the list says. The arguments it is given are checked, but what its code opens on its own is not.

Settings › Permissions says so on Windows, in plain words, with a link to this page.

## What closes it

Microsoft's MXC (`@microsoft/mxc-sdk`, AppContainer-based) is the candidate. It is deny-by-default, so the rules become a list of the folders a program may reach: the user's tool folders, the chat's folder, and the folders granted. It needs Windows 11 24H2 or later and a one-time administrator step.

Each program starts in a container of its own, about 55 ms on top of starting it, so a pipeline pays that start once per stage, and the bytes the app relays between stages on Windows cross the container's boundary at each one. [The plan](../plans/active/windows-sandbox-mxc.md) has the measurements.

Its filesystem policy works in our probes. What blocks adopting it is [microsoft/mxc#1464](https://github.com/microsoft/mxc/issues/1464): inside its base container a program cannot turn an open file back into a drive-letter path (`GetFinalPathNameByHandleW` with `VOLUME_NAME_DOS` is refused). Node's `fs.realpath` fails on every path, and Git for Windows cannot read its working directory unless the drive root is readable, which would turn an allow list back into a deny list. In the sandbox bake-off, node and git also failed to start with `STATUS_DLL_INIT_FAILED`.

Once that is fixed upstream, Windows 11 24H2 and later run native programs under MXC, generated from the same rules as Seatbelt and bubblewrap, behind the same `wrapNativeCommand` seam, and the notice in Settings goes away there. Older Windows stays as it is, with the notice.

## Related

- [agent-sandbox.md](agent-sandbox.md): how every layer applies the rules.
- [The agent works at real paths](../decisions/2026-10-11-the-agent-works-at-real-paths.md): the decision behind the rules and the native sandbox.
- `scripts/sandbox-bakeoff/`: the probe that measures each platform's sandbox against real workloads.
