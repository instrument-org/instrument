---
name: test-studio-on-linux
description: Start, inspect, stop, and drive an installed Instrument Studio build on a preconfigured Linux desktop host through SSH and loopback-only CDP. Use for Linux-specific Electron validation, remote Studio smoke tests, installed-product checks, or any request to test Studio on a Linux machine from another host.
---

<!-- cspell:ignore noninteractively preconfigured unwritable -->

# Test Studio on Linux

Use the host profile and helper rather than embedding a machine's paths, unit names, or ports in prompts or repo files.

```bash
HOST=<ssh-host>
LINUX_HOST=.agents/skills/test-studio-on-linux/scripts/linux-studio-host.mjs
DRIVE=.agents/skills/studio-chrome-devtools/scripts/studio-drive.mjs
```

`studio-chrome-devtools` owns that driver and carries what holds wherever Studio is driven: the page model, the traps, and why real input is not `element.click()`. Read it too; this skill adds only what the remote Linux host changes. Anything on the host outside Studio's window, such as a native dialog or the system browser during sign-in, goes through `drive-host-desktop`. `test-studio-on-windows` is its sibling and the two are deliberately shaped alike, so what you know from one transfers.

The SSH alias must already work noninteractively. A user must stay logged into the desktop, because the launcher inherits that session's environment to find a display. The host must have `~/.instrument/studio-host.json`; `status` explains when it is missing.

If the profile or the systemd unit is missing, read [references/host-enrollment.md](references/host-enrollment.md) before changing the host.

## Choose the target

Two targets are enrolled, `installed` and `preview`. `installed` validates the installed packaged product, uses the production user data, and can mutate real local application state. Route helpers do not exist, so use generic `eval`, `click`, `press`, `wait`, and `shot` operations.

There is no `dev` target: enrolling one needs a checkout and a Node toolchain on the host, neither of which a bare desktop install has. The profile schema leaves room for it, and the enrollment reference describes the shape.

`preview` tests a branch's packaged app without touching the installed one. `gh workflow run preview.yml --ref <branch> -f os=linux` (or `all`) builds both architectures; then:

```bash
node "$LINUX_HOST" install-preview --host "$HOST" --run <run-id>
node "$LINUX_HOST" start --host "$HOST" --target preview [--name <preview-name>]
node "$LINUX_HOST" tunnel --host "$HOST" --target preview --local-port 49173
node "$LINUX_HOST" stop --host "$HOST" --target preview
node "$LINUX_HOST" remove-preview --host "$HOST" --all-but-latest      # or --name <a>,<b>
```

`remove-preview` deletes superseded previews and their data (a running one is skipped) and reports the free space left; the VM's disk is small.

`install-preview` takes the run's `tar.gz` for the host's architecture (the AppImage needs FUSE), cached locally by artifact id, unpacks it under `~/.local/share/instrument-previews/<name>`, and makes Chromium's `chrome-sandbox` root-owned and setuid through `sudo -n`, without which the app will not start (`sandboxReady` says whether that worked). `start` runs the named preview, or the newest, as a transient user unit with its own CDP port, so it inherits the desktop session the way the installed unit does. It runs as `instrument-preview-<name>` with its own user data, and `window.__studioDrive` is attached, so route helpers work. Every build is a first launch, since the run number is part of its name; for another first launch, build again. `stop` sends SIGTERM to the app's main process only, as quitting would, and kills what is left after ten seconds. Never stop it with `systemctl --user stop` alone: signaling every process in the unit at once kills the GPU process mid-teardown, Chromium exits with `GPU process isn't usable`, and the main thread spins at full CPU until systemd's 90-second SIGKILL. That is a product bug a logout or shutdown also hits, not a quirk of the tooling.

## Establish source identity

Run status before every test and report the version it returns:

```bash
node "$LINUX_HOST" status --host "$HOST"
```

This host tracks whatever the update feed offers, so the version under test can change between runs. Two consequences worth stating in any result: the build you tested is the one `status` reported and not necessarily the one you expected, and stopping the target can itself install a staged update, because electron-updater installs on quit. `DISABLE_AUTO_UPDATE_POLLING=true` is set on the unit and gates only the periodic poll, not a staged install and not a check made through the app's own UI. Pinning a version means clearing `~/.cache/<updater-cache>/pending` before stopping, or making that directory unwritable so nothing can stage.

An installed build validates the installed application version, never a local diff. Note also that a host is one CPU architecture: an `aarch64` host says nothing about `x86_64` packaging or native modules, though distribution, GTK, and display-server behavior carry across.

## Start and connect

Start waits until the expected executable owns the loopback CDP listener and the expected Studio renderer target appears:

```bash
node "$LINUX_HOST" start --host "$HOST" --target installed
```

Start refuses when the app is already running without the configured CDP endpoint, because a packaged build holds a single-instance lock and a second launch would exit rather than add the debug flag.

Open a foreground SSH tunnel. Choose an unused local port, especially when local Studio instances or tunnels to other hosts are running:

```bash
node "$LINUX_HOST" tunnel --host "$HOST" --target installed --local-port 49171
```

Keep the tunnel process alive while driving. CDP stays bound to the host's loopback and is never exposed to the LAN.

Give each host its own port band. Every host defaults its local port to the remote port plus 1000, so two hosts sharing a CDP port collide on the driving machine the moment both tunnels are up, and the second one silently drives the first one's app.

Wait for this probe before calling `studio-drive`, and confirm the platform in the user agent rather than assuming the tunnel reached the host you meant:

```bash
curl --fail --retry 10 --retry-all-errors --retry-delay 1 http://127.0.0.1:49171/json/version
```

## Drive and collect evidence

```bash
node "$DRIVE" wait 'document.readyState === "complete"' --port 49171
node "$DRIVE" eval --port 49171 '({ title: document.title, readyState: document.readyState })'
node "$DRIVE" eval --port 49171 'Array.from(document.querySelectorAll("button, a, [role=button]"), (element) => element.innerText?.trim() || element.getAttribute("aria-label")).filter(Boolean)'
node "$DRIVE" click --text "<visible control from the inspection>" --port 49171
node "$DRIVE" press Escape --port 49171
node "$DRIVE" shot /tmp/linux-installed.png --port 49171
```

Do not use `state`, `goto`, or `modal`. They wait for a dev-only handle that packaged builds intentionally omit.

`rpc` is the exception, and it is why enumerating the DOM should not be the first move on this target. It goes through a different handle (`window.__studioDebug`) that does ship in a packaged build, so the installed product can be asked what it holds rather than read off what it painted:

```bash
node "$DRIVE" rpc workspace.chats.tasks '{"id":"<chat-id>"}' --port 49171
```

Two things it needs on a remote host. Developer Mode has to be on in that machine's own settings, because the preference is checked per call and the bridge cannot turn itself on; a call made while it is off says exactly that. And `wait --idle`, which blocks until a chat's agents go quiet, needs an explicit `--chat` here, since without one it asks the dev-only handle which chat the active tab is showing.

Treat screenshots as supporting evidence. Also assert the expected DOM or state, inspect relevant logs, and include the installed version in the result.

## Stop

```bash
node "$LINUX_HOST" stop --host "$HOST" --target installed
```

Stopping reports `portReleased` and any surviving processes. Both matter here: the desktop environment can re-home a launched app into its own scope, outside the unit's control group, and then stopping the unit leaves children alive holding the debug port. Stop also stops the scopes those children are in, so treat a non-empty `survivingProcesses` or `portReleased: false` as something to investigate rather than retry through.

When the host is a UTM guest on the Mac you run from, the helper also powers the guest itself: `vm-start --host "$HOST" --vm "<UTM name>"` starts it if needed and waits for SSH, and `vm-stop` shuts it down from inside (`sudo -n systemctl poweroff`) and waits for UTM to report it stopped, never forcing it. Unlike the Mac VM the guest is never replaced, because it carries a signed-in browser and the installed release app. Stop the preview first; a shutdown with the app running hits the 90-second hang above.

## Troubleshooting

- CDP accepts connections but never answers, and `status` shows the unit active with `portListening: true`: the main thread is blocked. A desktop-modal secret prompt is the usual cause on this platform, because `/json/*` needs a UI-thread hop that never comes. Clear the prompt on the desktop, then retry. The tell is a read timeout rather than a connection refusal; refusal means the app is not up yet.
- A keyring prompt appears on every launch: automatic login means the session never receives the account password, so the login keyring cannot be unlocked at login and the first stored-secret read prompts for it. Give that keyring an empty password, which lets it unlock unattended. It stores secrets unencrypted, so do that only on a disposable host.
- `start` reports no graphical session: log into the desktop, then retry. The unit inherits the display environment from the user manager rather than pinning it, because the X authority path is regenerated at every login and a pinned one works until the next reboot.
- `stop` times out: an app whose main thread is blocked never processes `SIGTERM`, so the unit must set a short stop timeout and let systemd escalate.
- Start refuses because the app is already running: something launched it outside the unit, most often the desktop's own application launcher. Quit it, then start through the helper.
- The driver connects but the app is not the one you meant: check the platform and version in `/json/version`. A tunnel to a different host answering on the same local port looks identical to success.
- An `instrument://` link sent over SSH does nothing and logs nothing: send it as `systemd-run --user --wait --collect -p ExitType=cgroup gio open '<link>'`. The unit gives `gio` the desktop session's environment, and `ExitType=cgroup` keeps the unit up until the launch it made exits. Without it, `gio` returns as soon as it has started the app's second launch, the unit stops, and systemd kills that launch before it hands the link to the running app. The running app logs every link that reaches it under `(outside-link)` in `main.log`, so no line there means the link never arrived.
- An external link leaves the window on the app but no browser appears: confirm the host has a working `http`/`https` association before blaming the app.
