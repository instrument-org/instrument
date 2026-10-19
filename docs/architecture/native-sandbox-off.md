# When the agent's programs run without a sandbox

Instrument shows a warning, in its notifications and in Settings › Permissions, when it can't put programs the agent runs inside a sandbox on your computer. This page explains what that means and what you can do about it. The second half is for developers.

## What it means

Your permissions decide which folders the agent may read and change. Instrument's own tools always follow them. Programs the agent starts, such as a Python script, a Node script or `git`, follow them only because Instrument starts each one inside a sandbox that the operating system enforces.

When that sandbox isn't available, those programs run with the same access you have: they can read and change any file your account can. Instrument's own tools still follow your permissions, and nothing changes about what the agent is asked to do. The difference is that a program it runs is no longer stopped at the edge of what you allowed.

Instrument only runs without the sandbox when your computer's own settings show it can't make one. If the sandbox fails to start for any other reason, Instrument doesn't run the program at all, and tries again the next time.

## Why it can happen

**Linux, with user namespaces closed.** The sandbox Instrument uses on Linux, bubblewrap, needs a kernel feature called user namespaces. Some systems turn it off for apps the system hasn't been told about. Ubuntu does this, and one known way to run into it is starting Instrument from its AppImage, since the `.deb` package installs the setting that lets Instrument use the feature. Installing Instrument from the `.deb` package is the first thing to try.

**Linux, without bubblewrap.** Instrument looks for bubblewrap at `/usr/bin/bwrap`. Installing your distribution's `bubblewrap` package puts it there.

**macOS, without `sandbox-exec`.** Instrument uses the system's own `/usr/bin/sandbox-exec` when its built-in launcher can't apply the rules. Every supported version of macOS ships it, so seeing this warning on a Mac is unexpected. Please tell us about it with Report a Problem in the Help menu.

**Windows.** Instrument can't yet sandbox programs on Windows, and Settings › Permissions says so on every Windows computer. See [the Windows sandbox](windows-sandbox.md).

After you change something, quit Instrument and open it again so it checks again.

## For developers

The check runs once per process, the first time a native command or the Permissions page needs it (`native-sandbox/probe.ts`). It starts a program that does nothing under the sandbox. If that works, every native command runs sandboxed. If it fails, the system's own settings decide what happens next, never the probe's error text:

- Linux: bubblewrap missing (`/usr/bin/bwrap`), or user namespaces closed by `kernel.unprivileged_userns_clone=0`, `user.max_user_namespaces=0` or `kernel.apparmor_restrict_unprivileged_userns=1` (`userNamespacesClosed` in `native-sandbox/bwrap.ts`). Either one makes the sandbox unavailable for the rest of the session: native commands run unwrapped, and the app warns.
- macOS: only a missing `sandbox-exec` makes Seatbelt unavailable (`seatbeltState` in `native-sandbox/seatbelt.ts`).
- Anything else is a probe with no answer: the command waiting on it fails with `NativeSandboxUnavailableError`, and the next command probes again.

`nativeSandboxOff` in `native-sandbox/index.ts` names the reason, which the Permissions view carries as `sandboxOff`. Settings › Permissions shows it, and the notifications bell carries a critical notice for it on macOS and Linux (`sandboxOffNotice` in `apps/studio/src/electron-main/lib/notices.ts`). `simulateSandboxOff`, reached through the debug RPC, reports a reason without changing what holds a command, so both warnings can be checked on a computer whose sandbox works.
