# When the agent's programs have no sandbox

Instrument shows a warning, in its notifications and in Settings › Permissions, when it can't put programs the agent runs inside a sandbox on your computer. This page explains what that means and what you can do about it. The second half is for developers.

## What it means

Your permissions decide which folders the agent may read and change. Instrument's own tools always follow them. Programs the agent starts, such as a Python script, a Node script or `git`, follow them only because Instrument starts each one inside a sandbox that the operating system enforces.

When that sandbox isn't available, Instrument doesn't run those programs at all. The agent can still read and write files with its own tools, which follow your permissions, but Python and Node scripts, `git`, and its search commands won't run.

You can choose to run them anyway, with the switch in that warning in Settings › Permissions. They then run with the same access you have: they can read and change any file your account can. The choice belongs to this computer, stays visible in Settings while it's on, and stops mattering once the sandbox works again, so fixing the cause is still the better way through.

## Why it can happen

**Linux, with user namespaces closed.** The sandbox Instrument uses on Linux, bubblewrap, needs a kernel feature called user namespaces. Some systems turn it off for apps the system hasn't been told about. Ubuntu does this, and one known way to run into it is starting Instrument from its AppImage on Ubuntu 24.04, since the `.deb` package installs the setting that lets Instrument use the feature. Ubuntu 25.04 and later let bubblewrap itself use the feature, so the AppImage's sandbox works there. Installing Instrument from the `.deb` package is the first thing to try.

**Linux, without bubblewrap.** Instrument looks for bubblewrap at `/usr/bin/bwrap`. Installing your distribution's `bubblewrap` package puts it there.

**The sandbox didn't start, for a reason the settings don't show.** Instrument tries again with every program, so this can clear up on its own. If it keeps happening, please tell us with Report a Problem in the Help menu.

**macOS, without `sandbox-exec`.** Instrument uses the system's own `/usr/bin/sandbox-exec` when its built-in launcher can't apply the rules. Every supported version of macOS ships it, so seeing this warning on a Mac is unexpected. Please tell us about it with Report a Problem in the Help menu.

**Windows.** Instrument can't yet sandbox programs on Windows, and Settings › Permissions says so on every Windows computer. See [the Windows sandbox](windows-sandbox.md).

After you change something, quit Instrument and open it again so it checks again.

## For developers

The check runs once per process, the first time a native command or the Permissions page needs it (`native-sandbox/probe.ts`). It starts a program that does nothing under the sandbox. If that works, every native command runs sandboxed. If it fails, the system's own settings decide what happens next, never the probe's error text:

- Linux: bubblewrap missing (`/usr/bin/bwrap`), or user namespaces closed by `kernel.unprivileged_userns_clone=0`, `user.max_user_namespaces=0` or `kernel.apparmor_restrict_unprivileged_userns=1` (`userNamespacesClosed` in `native-sandbox/bwrap.ts`). Either one makes the sandbox unavailable for the rest of the session.
- macOS: only a missing `sandbox-exec` makes Seatbelt unavailable (`seatbeltState` in `native-sandbox/seatbelt.ts`).
- Anything else is a probe with no answer, probed again by the next command.

Wherever no sandbox holds a native command, `wrapNativeCommand` refuses it with `NativeSandboxUnavailableError`, unless the person turned on "Run programs without a sandbox" (the machine preference `runProgramsWithoutSandbox`, reaching the workspace and the bash worker as `programsWithoutSandbox` in the config). Windows, which has no sandbox until MXC holds its commands, keeps running them unwrapped, as Settings says there.

`nativeSandboxOff` in `native-sandbox/index.ts` names the reason, which the Permissions view carries as `sandboxOff`. Settings › Permissions shows it with the switch, and on macOS and Linux the notifications bell carries a notice for it (`sandboxOffNotice` in `apps/studio/src/electron-main/lib/notices.ts`): critical until the person decides, so it toasts, stays until closed and keeps the bell's dot red, and quiet once they chose to run programs anyway. `simulateSandboxOff`, reached through the debug RPC, reports a reason without changing what holds a command, so the warnings can be checked on a computer whose sandbox works.
