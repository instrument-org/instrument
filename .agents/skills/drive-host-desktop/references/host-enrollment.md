# Enrolling a host's desktop driver

Enrollment installs Cua Driver on the host, runs it in the interactive desktop session, and records how to reach it in the host profile. It changes persistent machine state, so inspect the host first.

## Pick the version

Install the version Studio pins: `CUA_DRIVER_VERSION` in `apps/studio/scripts/download-cua-driver.ts` where that script exists, otherwise the newest release at least two weeks old. Matching the product's pin is what makes this double as a test of the driver the product ships. Download the release asset for the host from `trycua/cua` with `gh release download cua-driver-rs-v<version> -R trycua/cua`, together with `SHA256SUMS`, and check the archive against it before copying it to the host.

The driver sends usage telemetry unless told not to. Turn it off on every host: `cua-driver telemetry disable`.

## Windows

SSH runs in Session 0, which has no desktop, so the driver has to run in the logged-in user's session, and SSH reaches it through a named pipe private to that account.

1. Unpack the `windows-x86_64` archive under `%LOCALAPPDATA%\cua-driver\`.
2. From the interactive session, run `cua-driver telemetry disable`, `cua-driver autostart enable`, then `cua-driver autostart kick`. Over SSH, get there through a one-shot `schtasks /create ... /it` task (see `test-studio-on-windows`). `autostart enable` raises a UAC prompt that someone at the machine has to accept.
   - It registers the task elevated, and that is required: Windows OpenSSH gives an administrator a full, High-integrity token, and the pipe refuses a High-integrity client when the daemon runs at Medium. A daemon started without elevation answers from the desktop but reports "No process is on the other end of the pipe" over SSH.
3. Check from SSH: `cua-driver status` reports the daemon running on `\\.\pipe\cua-driver`, and `cua-driver call list_windows` lists the desktop's windows. If they show nothing, compare `whoami /user` over SSH and on the desktop; the SIDs must match.
4. Add to the host profile, with the host's real path:

```json
"desktop": {
  "mcp": "C:\\path\\to\\cua-driver.exe mcp --socket \\\\.\\pipe\\cua-driver"
}
```

Write the profile with `[IO.File]::WriteAllText`, since `Set-Content -Encoding utf8` on Windows PowerShell 5.1 adds a byte-order mark. Never pass JSON to `cua-driver call` through Windows PowerShell 5.1 either: it strips the quotes from field names. That is part of why `desk.mjs` speaks MCP over stdin instead.

## Linux (GNOME on Wayland)

1. Unpack the `linux-<arch>` archive (not the `-binary` one, which lacks the Shell helper) under `~/.cua-driver/packages/`, point `~/.cua-driver/packages/current` at it, and link `~/.local/bin/cua-driver` to its executable.
2. In the desktop session's environment (`DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/<uid>/bus`, `XDG_RUNTIME_DIR=/run/user/<uid>` over SSH): `cua-driver telemetry disable`; `~/.cua-driver/packages/current/wayland-helper/install.sh`, which installs and enables the `winrects@cua` Shell extension; and `gsettings set org.gnome.desktop.interface toolkit-accessibility true`.
3. Run the daemon as a user service bound to the graphical session, so it starts with the desktop and inherits its display:

```ini
[Unit]
PartOf=graphical-session.target
After=graphical-session.target

[Service]
Environment=CUA_DRIVER_RS_ENABLE_WAYLAND=1
Environment=CUA_DRIVER_RS_TELEMETRY_ENABLED=false
ExecStart=%h/.local/bin/cua-driver serve
Restart=on-failure

[Install]
WantedBy=graphical-session.target
```

4. GNOME loads extensions only at login, so restart the session once. On a host with automatic login, a reboot does it. Then `gnome-extensions info winrects@cua` reads `State: ACTIVE`, and `cua-driver status` over SSH reports the daemon on `~/.cache/cua-driver/cua-driver.sock`.
5. Add to the host profile:

```json
"desktop": {
  "mcp": "/home/<user>/.local/bin/cua-driver mcp --socket /home/<user>/.cache/cua-driver/cua-driver.sock"
}
```

6. For keyboard and pointer input, which the driver cannot deliver on GNOME Wayland, copy `scripts/mutter-input.py` to `~/.cua-driver/mutter-input.py` and add its command to the same `desktop` entry, with the session bus spelled out since SSH has none:

```json
"input": "env DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/<uid>/bus XDG_RUNTIME_DIR=/run/user/<uid> python3 /home/<user>/.cua-driver/mutter-input.py"
```

`cua-driver doctor` run over SSH warns that neither `DISPLAY` nor `WAYLAND_DISPLAY` is set. That describes the SSH shell, not the daemon; `cua-driver call list_windows` is the real check.

## macOS

The macOS test VM is enrolled as part of its base: see `test-studio-on-mac`'s [host enrollment](../../test-studio-on-mac/references/host-enrollment.md). In short, `CuaDriver.app` in `/Applications` holds the Accessibility and Screen Recording grants (`cua-driver permissions grant` raises both on the Mac's own screen, for a person to approve), a LaunchAgent starts its daemon at login, and the host profile needs no socket path, since `cua-driver mcp` reaches the logged-in daemon itself:

```json
"desktop": {
  "mcp": "/Users/<user>/.local/bin/cua-driver mcp"
}
```

Clones of the base keep the grants, because they attach to CuaDriver's signature.
