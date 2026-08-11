# Linux host enrollment

Use this only when `linux-studio-host.mjs status` reports a missing profile or unit. Host enrollment changes persistent machine state, so inspect the host first and keep all debugging endpoints on loopback.

The host is a desktop installation with the packaged product installed from its native package, an SSH server, and Python 3 available to the login user. The helper runs Python on the host rather than a shell script, because the endpoints it reports are JSON and the host may not have a JSON-capable shell tool. Nothing else is required: `systemctl --user`, `ss`, and `pgrep` are part of a normal systemd desktop.

## Host profile

Create `~/.instrument/studio-host.json` with host-local values:

```json
{
  "schemaVersion": 1,
  "installed": {
    "unit": "instrument-studio-installed.service",
    "cdpPort": 48171,
    "executable": "/path/to/installed/instrument"
  }
}
```

Keep this file off Git. It is the only place the helper should learn machine-specific executable, unit, and port values. Each target needs its own CDP port and its own unit; the helper refuses a profile that shares either.

Give this host a CDP port distinct from every other enrolled host, not merely distinct within this profile. The helper derives a default local forwarding port from the remote one, so two hosts sharing a CDP port collide on whichever machine drives both.

`dev` and `devSeeded` entries are accepted by the schema and are not implemented. Enrolling a development target additionally needs a checkout, a Node toolchain, and a second unit; write it as its own unit with its own port rather than making one unit take per-run configuration.

## Unit contract

Create the launcher as a **user** unit, not a system one. A user unit needs no root, and it is the only form that can inherit the graphical session it has to draw into.

The unit must:

- Use the executable's directory as its working directory.
- Set `DISABLE_AUTO_UPDATE_POLLING=true`. This gates the periodic poll only. It does not prevent a check made through the app's own UI, and it does not prevent a staged update from installing on quit.
- Launch the configured executable with `--remote-debugging-port=<installed.cdpPort>`.
- Pass the same display-platform flag the installed desktop entry uses, so what you test is the path real users get rather than a different rendering backend.
- Set a short `TimeoutStopSec`. An app whose main thread is blocked by a desktop-modal prompt never processes `SIGTERM`, and the default stop timeout makes every stop in that state look like a hang.
- Redirect output to a host-local log outside any checkout.
- Omit an install section. The launcher is started on demand and must not come up with the session.

The unit must **not** set `DISPLAY`, `WAYLAND_DISPLAY`, `XAUTHORITY`, or `XDG_RUNTIME_DIR`. A graphical session publishes those into the user manager's environment, and units inherit them from there. The X authority file is regenerated at every login, so a unit that pins it works until the next reboot and then fails in a way that reads like a broken app.

Do not open a firewall port for CDP. The app must listen only on loopback; connect through SSH forwarding.

## Session requirements

A user must be logged into the desktop for the display environment to exist. Automatic login makes that unattended, at one cost worth knowing before choosing it: the session never receives the account password, so the login keyring cannot be unlocked at login, and the first stored-secret read raises a modal that blocks the app's main thread. Give that keyring an empty password so it unlocks unattended. It then stores secrets unencrypted, which is acceptable only on a disposable host.

## Validation

Run these from the controlling machine after enrollment:

```bash
HOST_HELPER=.agents/skills/test-studio-on-linux/scripts/linux-studio-host.mjs
node "$HOST_HELPER" status --host <ssh-host>
node "$HOST_HELPER" start --host <ssh-host> --target installed
node "$HOST_HELPER" stop --host <ssh-host> --target installed
```

Confirm `status` reports the expected installed version, `session.present`, and `cdpConfigured`, `commandConfigured`, `loopback`, `ownerMatches`, `rendererReady`, `updaterPollingDisabled`, `userAgentMatches`, and `workingDirectoryMatches` as `true`.

Confirm `stop` reports `portReleased: true` and no surviving processes. A desktop environment can re-home a launched application into its own scope, outside the unit's control group; stopping the unit then reports success while children stay alive holding the debug port, and the next start refuses because the app appears to be running without CDP.
