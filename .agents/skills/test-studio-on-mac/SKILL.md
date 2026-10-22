---
name: test-studio-on-mac
description: Install, start, stop and drive Instrument preview builds on a macOS test host over SSH and loopback-only CDP, and reset a UTM macOS VM to a clean first launch. Use for macOS permission and privacy-prompt testing (Seatbelt, TCC dialogs, Automation), installed-product checks on a Mac other than the one you are on, or any request to test Studio on a Mac test machine.
---

# Test Studio on a Mac test host

```bash
HOST=<ssh-host>
MAC_HOST=.agents/skills/test-studio-on-mac/scripts/mac-studio-host.mjs
DRIVE=.agents/skills/studio-chrome-devtools/scripts/studio-drive.mjs
```

`studio-chrome-devtools` owns the driver for Studio's own window; `drive-host-desktop` drives everything outside it (macOS privacy dialogs, Safari during sign-in, Finder, System Settings). This skill adds the preview lifecycle and the VM reset. Its siblings, `test-studio-on-windows` and `test-studio-on-linux`, are shaped alike.

The host is a macOS test machine, not anyone's working Mac: permission tests plant canary files, grant and refuse privacy permissions, and drive apps like Mail. A UTM macOS VM is the intended host (see [references/host-enrollment.md](references/host-enrollment.md)); a person's own Mac only for a final pass they asked for.

## A run

```bash
node "$MAC_HOST" reset-vm --base <clean-vm> --vm <run-vm> --host "$HOST" [--dir <folder>]   # fresh clone, booted, SSH up
node "$MAC_HOST" install-preview --host "$HOST" --run <run-id>              # into /Applications
node "$MAC_HOST" start --host "$HOST" [--name <preview-name>]
node "$MAC_HOST" tunnel --host "$HOST"                                     # prints its local port
node "$DRIVE" snapshot --page onboarding --port <local-port>
node "$MAC_HOST" stop --host "$HOST"
node "$MAC_HOST" status --host "$HOST"
```

- `reset-vm` powers off the run VM, deletes it, clones the clean base (which must stay stopped) and boots the clone. A clone shares disk with its base until it changes, so it takes seconds, but only on the base's own volume: `utmctl clone` always writes into UTM's storage on the startup disk, so a base kept on an external drive comes back as a full copy of its disk image (about 30 GB) there. For a base outside UTM's storage, pass `--dir` the folder holding its `.utm` bundle: the clone is made beside it with `cp -c` and opened in UTM as a shortcut, and deleting it at the next reset removes it from that folder. Every run after a reset is a first launch on a machine no earlier run touched: no privacy answers, no Instrument data, no leftovers.
- `install-preview` takes the run's `arm64-mac.zip` (cached locally by artifact id), unpacks it with `ditto` into `/Applications`, and reports its bundle id, signature and Gatekeeper verdict. Each preview has its own bundle id (`com.finalpoint.instrument.preview.<name>`), so macOS keeps its privacy answers apart from any other build's.
- `start` launches with `open -n -g -a <app> --env DISABLE_AUTO_UPDATE_POLLING=true --args --remote-debugging-port=48183`. Through `open`, the app is its own responsible process, so privacy prompts name it; launched from a shell, they would name the shell or never appear.
- `stop` sends SIGTERM to the app's main process, kills what is left after ten seconds, and kills whatever still holds the CDP port.

## Privacy prompts

macOS asks once per app for Desktop, Documents, Downloads, removable volumes, Automation of another app, and the rest, and remembers the answer per bundle id. The dialogs are drawn by the system; read and answer them with `drive-host-desktop` (`get_desktop_state` to see them, `get_window_state` / `click` on the dialog's window, or `desk.mjs <host> input` for keys). Record the order dialogs appear in: the app's own card first, then macOS's dialog.

## Traps

- **Sign-in goes through Safari.** On the VM, Safari keeps a Google session from enrollment; "Continue with Google" completes through the app's local callback, then Safari stays in front of the app. Bring the app back with `desk.mjs <host> bring_to_front`.
- **`/usr/bin/python3` and `/usr/bin/git` are stubs** on a Mac without Apple's command-line tools: running them raises "install command line developer tools". The agent's own Python and git do not use them, but a test or a person's command can trigger the dialog.
- **One VM at a time.** The base and its clones share a host name; only one may run.
- **Start a VM only through `reset-vm`.** It hides UTM around the start; a bare `utmctl start`, `--hide` included, opens the VM's window on the screen of the person at the Mac and takes their focus. Clicking UTM in the Dock shows the window again.
