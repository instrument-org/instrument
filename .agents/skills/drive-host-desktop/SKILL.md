---
name: drive-host-desktop
description: Drive a test host's desktop outside Studio (system file pickers, permission prompts, installers, the default browser during sign-in) through Cua Driver over SSH, reading accessibility trees instead of screenshots wherever it can. Use alongside test-studio-on-windows or test-studio-on-linux whenever a check leaves Studio's own window, or to see what is on a test host's screen.
---

# Drive a host's desktop

Studio's own window is driven over CDP with `studio-drive` (`studio-chrome-devtools`, plus `test-studio-on-windows` or `test-studio-on-linux` for the tunnel). That stays the first choice for anything inside the app: it is exact and cheap. This skill covers what CDP cannot reach: native dialogs the app opens, the system browser a sign-in hands off to, an installer, a notification, the desktop itself.

```bash
DESK=.agents/skills/drive-host-desktop/scripts/desk.mjs
node "$DESK" <host> <tool> [key=value ...] [--json '{...}']
```

`<host>` is the SSH alias. The driver is [Cua Driver](https://github.com/trycua/cua), the same one Studio's computer-use work embeds, so a rough edge found here is likely one the product will meet too. Each host runs it in its interactive desktop session; `desk.mjs` reaches it over SSH and prints trees as Markdown and images as local file paths to `Read`.

## The loop

Find the window, read its tree, act on an element by its index, read again to confirm:

```bash
node "$DESK" <host> list_windows
node "$DESK" <host> get_window_state window="Select Folder" query="folder"
node "$DESK" <host> set_value window="Select Folder" el=12 value='C:\Users\me\Documents'
node "$DESK" <host> click window="Select Folder" el=31
node "$DESK" <host> list_windows
```

- `window=<text>` picks the first window whose title or app name contains the text (case-insensitive) and fills in `pid` and `window_id`. Pass them yourself when two windows match.
- `el=<n>` is element `[n]` from the most recent `get_window_state` on that host. Any newer tree read replaces it, so act right after the read you mean.
- `query=<text>` cuts a tree to matching rows and their ancestors; `max_elements` and `max_depth` bound a large one. A browser window's full tree runs to thousands of rows, so query it.
- Values are parsed: numbers, `true`/`false`, and JSON arrays or objects (`keys='["ctrl","l"]'`). Anything else is a string. `--json` takes a whole argument object.

`node "$DESK" <host> tools` lists every tool in one line each; `describe <tool>` lists its arguments. Read those instead of guessing an argument name.

## Screenshots

`get_window_state` returns only the tree unless you pass `include_screenshot=true`. Ask for an image when the tree cannot answer: something drawn rather than labeled, layout, or proof for a report. `get_window_state` and `get_desktop_state` cap the long edge at 1280 px, which reads fine and costs a fraction of a full-resolution capture; `zoom` with a region returns that part at full resolution. Coordinates for a desktop-scope click (`scope=desktop x= y=`) come from the `get_desktop_state` image.

## Input delivery

Actions go to the window in the background by default, without raising it, so the person at the machine is not interrupted. Some targets drop background input, and the driver then answers `background_unavailable` instead of acting. Retry that one action with `delivery_mode=foreground`, which raises the window briefly. Do not start with foreground.

## Traps

- **The broker.** The driver scopes sessions and tree snapshots to one connection, so the first run for a host starts a background broker holding one connection, and later runs talk to it (about 0.1 s a call). It exits after 15 idle minutes. When something looks wedged, `node "$DESK" <host> stop` and run again; its log is `$TMPDIR/desk/<host>-broker.log`.
- **A sleeping display returns stale pixels on Windows.** A capture taken after the monitor slept showed the taskbar clock hours behind, with no error. If a screenshot's clock or content looks old, wake the display (move the mouse or press a key through the driver) and capture again.
- **Modern Windows apps** (Settings, the new Notepad) can return an empty tree, and refuse background key presses. Cua's docs list classic dialogs, browsers and Electron as covered; Explorer's desktop has been checked here, the rest not yet.
- **`kill_app` and invoking items act on the person's real desktop.** Invoking a file's icon opens it. Prefer the app under test's own windows, and never close something you did not open.
- **UAC prompts** sit on a secure desktop that no driver can reach. The Windows driver runs elevated (see enrollment), so it can drive apps run as administrator, which also means it can do anything an administrator can.

## Host enrollment

`desk.mjs` reads `desktop.mcp` from the host profile (`~/.instrument/studio-host.json`, the file the `test-studio-on-*` helpers read): the command that starts the driver's MCP server in that host's shell. When it is missing, follow [references/host-enrollment.md](references/host-enrollment.md).
