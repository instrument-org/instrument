# A deb update can leave the package unpacked but not configured

**Status:** open. One occurrence on a Linux test host, 2026-08-26, upgrading 1.6.1 to 1.6.2. The mechanism is traced as far as the surviving logs allow; the trigger is not reproduced and there is no fix. Last updated 2026-08-27.

## Why an unconfigured package cannot start

Ubuntu 23.10 and later set `kernel.apparmor_restrict_unprivileged_userns = 1`, which blocks the unprivileged user namespaces Chromium's namespace sandbox needs. electron-builder answers that in the deb by shipping an AppArmor profile at `/etc/apparmor.d/instrument` whose entire body grants the one thing that is missing:

```text
profile "instrument" "/opt/Instrument/instrument" flags=(unconfined) {
  userns,
  include if exists <local/instrument>
}
```

It does **not** make the SUID helper setuid: `chrome-sandbox` installs as `root:root 0755`, not `4755`. So launching depends entirely on that profile being loaded. Without it Chromium falls back to the SUID helper, finds it non-setuid, and treats that as fatal:

```text
[FATAL:sandbox/linux/suid/client/setuid_sandbox_host.cc:166] The SUID sandbox helper
binary was found, but is not configured correctly. Rather than run without sandboxing
I'm aborting now.
```

A Chromium `FATAL` aborts on `SIGTRAP`, so the desktop shows its own "closed unexpectedly" dialog. Nothing in what the user sees connects it to an update.

The profile is removed when the old package is torn down and reloaded by the new package's `postinst`. Every interval between those two is an interval where the app cannot start, and a normal upgrade closes it in about a second.

## What happened

The updater ran its install, dpkg unpacked the new version, and the package was left in `unpacked` state with no `configure` ever attempted. The window stayed open for 17 minutes. Five launches in that window aborted with the message above, two of them raising the desktop crash reporter. It ended only because someone ran `sudo dpkg --configure instrument` by hand.

## Where the install runs from

electron-updater's `DebUpdater` runs `dpkg -i <deb>` through `pkexec`, and catches a failure by running `apt-get install -f -y`. That catch is real: `spawnSyncLog` throws when the command exits non-zero, so a clean dpkg failure is covered. It did not run here, so dpkg did not report failure to the updater.

The install itself is driven from electron-updater's quit handler, inside the exiting app process. On Linux, `installStagedUpdate` in [`update.ts`](../../apps/studio/src/electron-main/lib/update.ts) deliberately avoids `quitAndInstall()` and calls `app.quit()`, letting that handler apply the staged build. The privileged `dpkg` is therefore a child of a process on its way out, inside the desktop's application scope. When that scope was released the transaction was still unconfigured, and the root `pkexec` session never logged a clean close.

## What could not be determined

Why dpkg stopped after unpacking. Its output went to the `pkexec`'d shell, a child of the app, so none of it reached the system journal or the app's own log, and the app's last log line is `Update downloaded`, written before the install began. dpkg's log records no `configure` attempt at all, which says configure was never started rather than started and failed. Unmet dependencies are ruled out: the two bare names in `Depends` that look missing on Ubuntu 24.04 (`libgtk-3-0`, `libatspi2.0-0`) resolve through the `t64` renames via `Provides`.

## Why the obvious guards do not help

- Checking `dpkg -s` after the install runs in the same process that is exiting, and cannot report anything once that process is gone.
- Switching to `apt-get install ./file.deb` changes the command but not its lifetime.
- Recovering at the next startup is impossible, because the broken state is exactly the state in which the app cannot start.

## What might resolve it

Run the privileged install detached from the app's lifetime, the way the Linux relaunch already is, and chain the fallback into the same shell so a partial transaction gets completed rather than abandoned. That is a change to the most dangerous path in the product, and verifying it needs a real end-to-end update on a Linux host rather than a unit test. Weigh it against the fact that this has been seen once.

## Recognizing it

`dpkg -s instrument` reporting anything other than `install ok installed`, with `/etc/apparmor.d/instrument` absent. Recovery is `sudo dpkg --configure instrument`.

When investigating on a host, note that Ubuntu's crash reporter keeps only one report per executable until that report is cleared, so every repeat launch after the first produces no new report and the journal is the better record.
