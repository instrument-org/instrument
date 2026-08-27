# A deb update can leave the package unpacked but not configured

**Status:** open, no fix, mechanism reproduced. One occurrence upgrading 1.6.1 to 1.6.2 on a Linux test host, 2026-08-26, reproduced end to end the next day by tearing down the app's cgroup mid-transaction. What performed that teardown during the original incident is the only part still unknown. Last updated 2026-08-27.

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

The updater ran its install, dpkg unpacked the new version, and the package was left in `unpacked` state with no `configure` ever attempted. The window stayed open for 17 minutes. At least four launches in it aborted: the journal carries the message above for three, and the crash reporter captured a fourth started with different flags. It ended only because someone ran `sudo dpkg --configure instrument` by hand.

## Where the install runs from

electron-updater's `DebUpdater` runs `dpkg -i <deb>` through `pkexec`, and catches a failure by running `apt-get install -f -y`. That catch is real: `spawnSyncLog` throws when the command exits non-zero, so a clean dpkg failure is covered. It did not run here, so dpkg did not report failure to the updater.

The install itself is driven from electron-updater's quit handler, inside the exiting app process. On Linux, `installStagedUpdate` in [`update.ts`](../../apps/studio/src/electron-main/lib/update.ts) deliberately avoids `quitAndInstall()` and calls `app.quit()`, letting that handler apply the staged build. The privileged `dpkg` is therefore a child of a process on its way out, inside the desktop's application scope. When that scope was released the transaction was still unconfigured, and the root `pkexec` session never logged a clean close.

## What a reproduction showed

Driving a real 1.6.3 to 1.6.4 update on the same host, through the same RPCs the update button calls, established four things without reaching the failure itself.

**The install needs a human.** It runs `pkexec --disable-internal-agent /bin/bash -c 'dpkg -i <staged deb>'`, which raises an interactive authentication prompt on the desktop. Nothing proceeds until someone answers it.

**The app is frozen for the whole install.** `spawnSync` blocks the main thread from the moment the install starts, including while the prompt waits. RPC and CDP both stop answering. This is the reason the product's Linux install notice tells the user to ignore any "Force quit" dialogs, and the reason a user watching a frozen window might reasonably kill it.

**A blocked main thread writes no log.** The line logged immediately before the install, `Quitting to install the staged update`, never reached the log file, because the thread blocked before it flushed. That accounts for the original occurrence's silence, which had looked like evidence the install never started.

**The privileged child lives in the app's cgroup.** Both the app and its `pkexec` descendant sat in the same `app-instrument-<pid>.scope`. Anything that tears that scope down takes a running dpkg transaction with it, mid-write.

Together those give a mechanism that fits every observation: the app freezes, something ends it while dpkg is partway through, dpkg dies inside the same cgroup with the package unpacked and the profile removed, and electron-updater's `apt-get install -f -y` fallback never runs because the process that would have caught the failure is gone.

## Reproduced

With someone at the desktop to answer the authentication prompt, an attended run of a real 1.6.3 to 1.6.4 update reproduced the incident exactly. A watcher tore down the app's cgroup 80 milliseconds after dpkg finished unpacking, killing all eight processes it held including the root dpkg.

What that left:

- `dpkg -s` reporting `install ok half-configured` rather than `installed`
- `/etc/apparmor.d/instrument` gone, and no `instrument` profile loaded
- launching the app failing with the same `setuid_sandbox_host.cc:166` FATAL, dumping core
- a fresh crash report carrying `Signal: 5` / `SIGTRAP`, the same signature as the original

The one difference from the incident is `half-configured` rather than `unpacked`, because the teardown landed a fraction of a second later, after dpkg had entered its configure step. The consequence is identical, and `sudo dpkg --configure instrument` recovered it in both cases.

So killing the app mid-transaction is sufficient on its own. Nothing more exotic is needed to produce the incident state.

## What could not be determined

What performed the teardown that day. Force-quitting a frozen window fits, and so does anything else that ends the process group, but nothing in the surviving logs names it. That is now the only open part of the chain.

Two things are ruled out. Unmet dependencies: the two bare names in `Depends` that look missing on Ubuntu 24.04 (`libgtk-3-0`, `libatspi2.0-0`) resolve through the `t64` renames via `Provides`. And a clean dpkg failure: that path is covered by the fallback, which did not run.

## A second problem the reproduction exposed

`installStagedUpdate` spawns a detached watcher that relaunches the app as soon as the old process exits. During the reproduction the old process was ended while the install was still waiting for authentication, and the watcher immediately started a fresh instance of the **old** version. Had the prompt then been answered, dpkg would have been rewriting the installation under a running app.

The watcher waits on the previous process, which is not the same thing as waiting on the install.

## Why the obvious guards do not help

- Checking `dpkg -s` after the install runs in the same process that is exiting, and cannot report anything once that process is gone.
- Switching to `apt-get install ./file.deb` changes the command but not its lifetime.
- Recovering at the next startup is impossible, because the broken state is exactly the state in which the app cannot start.

## What might resolve it

Run the privileged install in its own cgroup rather than the app's, and chain the fallback into the same shell so a partial transaction gets completed rather than abandoned. That also lets the app stop blocking its main thread for the duration, which removes the frozen window that invites the kill, and gives the relaunch something to wait on other than the old process.

The mechanism has to be a transient scope, not `detached`. Node's `detached: true` is `setsid`, which makes a new session and not a new cgroup, so systemd still takes the child down with the app. Both halves were measured on the host: a setsid child died with the app's scope, and a `systemd-run --user --scope` child survived it. Two preconditions were checked and hold inside such a scope: `NoNewPrivs` stays `0`, so pkexec still works, and the authentication prompt still reaches the desktop.

This is the shape the other platforms already use. Squirrel.Mac installs from ShipIt, a separate helper that waits for the app to terminate; Linux is the outlier only because electron-updater installs inline on quit. Squirrel.Mac also carries the same relaunch race, guarded upstream in [electron#36130](https://github.com/electron/electron/pull/36130) by refusing to install while the app is running, which is the shape the guard here wants.

It remains a change to the most dangerous path in the product, and verifying it needs a real end-to-end update rather than a unit test. Note that such a test cannot run unattended: the authentication prompt needs a person at the desktop.

## Recognizing it

`dpkg -s instrument` reporting anything other than `install ok installed`, with `/etc/apparmor.d/instrument` absent. Recovery is `sudo dpkg --configure instrument`.

When investigating on a host, note that Ubuntu's crash reporter keeps only one report per executable until that report is cleared, so every repeat launch after the first produces no new report and the journal is the better record.
