---
name: test-studio-on-linux
description: Start, inspect, stop, and drive an installed Instrument Studio build on a preconfigured Linux desktop host through SSH and loopback-only CDP. Use for Linux-specific Electron validation, remote Studio smoke tests, installed-product checks, or any request to test Studio on a Linux machine from another host.
---

# Test Studio on Linux

Use the host profile and helper rather than embedding a machine's paths, unit names, or ports in prompts or repo files.

```bash
HOST=<ssh-host>
LINUX_HOST=.agents/skills/test-studio-on-linux/scripts/linux-studio-host.mjs
DRIVE=.agents/skills/studio-chrome-devtools/scripts/studio-drive.mjs
```

`studio-chrome-devtools` owns that driver and carries what holds wherever Studio is driven: the page model, the traps, and why real input is not `element.click()`. Read it too; this skill adds only what the remote Linux host changes. `test-studio-on-windows` is its sibling and the two are deliberately shaped alike, so what you know from one transfers.

The SSH alias must already work noninteractively. A user must stay logged into the desktop, because the launcher inherits that session's environment to find a display. The host must have `~/.instrument/studio-host.json`; `status` explains when it is missing.

If the profile or the systemd unit is missing, read [references/host-enrollment.md](references/host-enrollment.md) before changing the host.

## Choose the target

Only `installed` is enrolled. It validates the installed packaged product, uses the production user data, and can mutate real local application state. Route helpers do not exist, so use generic `eval`, `click`, `press`, `wait`, and `shot` operations.

There is no `dev` target: enrolling one needs a checkout and a Node toolchain on the host, neither of which a bare desktop install has. The profile schema leaves room for it, and the enrollment reference describes the shape.

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

Treat screenshots as supporting evidence. Also assert the expected DOM or state, inspect relevant logs, and include the installed version in the result.

## Stop

```bash
node "$LINUX_HOST" stop --host "$HOST" --target installed
```

Stopping reports `portReleased` and any surviving processes. Both matter here: the desktop environment can re-home a launched app into its own scope, outside the unit's control group, and then stopping the unit leaves children alive holding the debug port. Stop also stops the scopes those children are in, so treat a non-empty `survivingProcesses` or `portReleased: false` as something to investigate rather than retry through.

## Troubleshooting

- CDP accepts connections but never answers, and `status` shows the unit active with `portListening: true`: the main thread is blocked. A desktop-modal secret prompt is the usual cause on this platform, because `/json/*` needs a UI-thread hop that never comes. Clear the prompt on the desktop, then retry. The tell is a read timeout rather than a connection refusal; refusal means the app is not up yet.
- A keyring prompt appears on every launch: automatic login means the session never receives the account password, so the login keyring cannot be unlocked at login and the first stored-secret read prompts for it. Give that keyring an empty password, which lets it unlock unattended. It stores secrets unencrypted, so do that only on a disposable host.
- `start` reports no graphical session: log into the desktop, then retry. The unit inherits the display environment from the user manager rather than pinning it, because the X authority path is regenerated at every login and a pinned one works until the next reboot.
- `stop` times out: an app whose main thread is blocked never processes `SIGTERM`, so the unit must set a short stop timeout and let systemd escalate.
- Start refuses because the app is already running: something launched it outside the unit, most often the desktop's own application launcher. Quit it, then start through the helper.
- The driver connects but the app is not the one you meant: check the platform and version in `/json/version`. A tunnel to a different host answering on the same local port looks identical to success.
- An external link leaves the window on the app but no browser appears: confirm the host has a working `http`/`https` association before blaming the app.
