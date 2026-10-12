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

## Linux

Not enrolled yet. Cua Driver lists GNOME on Wayland as supported with limits: it needs its bundled Shell helper, one Shell restart (a log-out on Wayland), and `CUA_DRIVER_RS_ENABLE_WAYLAND=1`, and AT-SPI needs `gsettings set org.gnome.desktop.interface toolkit-accessibility true`. Record what enrollment took here once a host has been through it.

## macOS

Not enrolled yet. The driver needs Accessibility and Screen Recording granted to the process that runs it; `cua-driver permissions grant` raises both prompts on the Mac's own screen.
