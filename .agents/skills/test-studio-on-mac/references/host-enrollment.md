# Enrolling a macOS test VM

A UTM macOS VM on an Apple Silicon Mac, kept as a clean base and cloned for every run.

## Create the VM (a person, once)

1. UTM → Create a New Virtual Machine → Virtualize → macOS 12+; let it download the latest restore image. 8 GB memory, 4 cores, an 80 GB disk (sparse: it uses only what the guest writes).
2. Setup Assistant: skip migration and the Apple Account, create a local account, leave FileVault off (it blocks automatic login), skip location, analytics, Screen Time and Siri.
3. In the VM's System Settings: Sharing → Remote Login on (leave "full disk access for remote users" off); Users & Groups → log in automatically as that account; Lock Screen → never turn the display off, never require a password.
4. Delete the restore image from UTM's cache once the VM boots (`~/Library/Containers/com.utmapp.UTM/Data/Library/Caches/*.ipsw`); it is only needed to create another VM.

## Enroll it (an agent, over SSH)

1. A dedicated key in the guest's `authorized_keys`, and an SSH alias for its `.local` name.
2. Cua Driver, the release the other hosts run: unpack the `darwin-arm64` archive, put `CuaDriver.app` in `/Applications` (its signature is what the privacy grants attach to), link `~/.local/bin/cua-driver` to `CuaDriver.app/Contents/MacOS/cua-driver`, and `cua-driver telemetry disable`.
3. `cua-driver permissions grant` raises Accessibility, Screen Recording and direct-capture consent on the VM's screen, for a person to approve; Screen Recording may need CuaDriver added with "+" from `/Applications`. `cua-driver permissions status --json` should then read `accessibility: true`, `screen_recording: true`, attribution `driver-daemon`.
4. A LaunchAgent that starts the daemon as the app at every login (`open -g -a /Applications/CuaDriver.app --args serve`, `RunAtLoad`, `LimitLoadToSessionType` Aqua): Cua's own autostart is Windows-only.
5. `~/.instrument/studio-host.json` with `{"schemaVersion": 1, "desktop": {"mcp": "<home>/.local/bin/cua-driver mcp"}}`; on macOS the remote `mcp` proxies to the logged-in daemon.
6. Sign Safari into the test Google account, so first-launch sign-in completes.
7. Shut the VM down from inside and leave it stopped: it is the base. UTM's soft stop raises a confirmation dialog in the guest, and `sudo shutdown` needs the account's password; `desk.mjs <host> invoke_menu window=<a Finder window> path='["Apple","Shut Down…"]'` raises the same dialog, which shuts down on its own after a minute. Close every Finder window first (`path='["File","Close Window"]'`): Finder reopens the windows it had at logout in the base and in every clone, whatever the dialog's "Reopen windows" box says. `reset-vm` clones it for each run; a clone keeps the driver's grants because CuaDriver's signature is unchanged.
