# Plan: Computer Use through an embedded Cua Driver

Status: spike, behind the `computer_use` feature flag. The Mac path runs end to end up to the permission grant; nothing past the grant has been watched in Studio, and Windows and Linux are untested.

Computer Use is the agent operating the user's native apps: reading a window's accessibility tree and a screenshot of it, then clicking, typing, and scrolling in it. It is a feature too large to build per platform ourselves, so it rides on [Cua Driver](https://github.com/trycua/cua) (MIT), a Rust driver with macOS, Windows, and Linux builds.

## Shape

- **Studio main owns the driver** (`apps/studio/src/electron-main/lib/computer-driver.ts`). On first use it starts `cua-driver serve --embedded` as a direct child through the SDK's `EmbeddedCuaDriverHost` (`@trycua/cua-driver`). A direct child works under the app's own Accessibility and Screen Recording grants, so the user grants Instrument once and there is no second app to install. The daemon starts only once macOS reports both grants, restarts when they change, and stops in the quit teardown.
- **The agent reaches it through a `computer` shell command** (`packages/workspace/src/lib/shell-commands/computer.ts`), a main-thread command that runs `cua-driver call <tool> <json> --socket <private endpoint> --session instrument-<task>`. Each call takes about 20 ms. A named session per task keeps element indices valid from one call to the next; the command starts it before every call, which returns the live one.
- **The tool surface is an allowlist**: inspection (`list_apps`, `list_windows`, `get_window_state`, `get_desktop_state`, `zoom`, ...) and actions (`click`, `type_text`, `hotkey`, `invoke_menu`, ...). Left out: `browser_*` (that is `agent-browser`), `kill_app`, the clipboard, and the driver's own administration.
- **Screenshots** from `get_window_state`, `get_desktop_state`, and `zoom` are written under the task's screenshots folder and named in the output for the agent to read. The duplicate structured `elements` array is dropped from `get_window_state` output, since the markdown tree carries the same indices.
- **Permissions UI** is the Computer Use card in Settings, Features: each grant's state, read again on window focus, a button that raises the system prompts, and a link to each Privacy & Security pane.
- **The executable** is vendored by `apps/studio/scripts/download-cua-driver.ts` from the matching GitHub release, checksum-verified, into `resources/cua-driver/`, which ships unpacked. Keep its version equal to the SDK's; they share a contract version.
- **Telemetry**: the driver reports usage unless `CUA_DRIVER_RS_TELEMETRY_ENABLED=false`. The host passes it to the daemon (the embedded host refuses variables outside its allowlist, which excludes `CUA_DRIVER_RS_UPDATE_CHECK`) and the command passes it to the CLI.

## What a run showed

- With the grants missing, the agent read `computer --help`, hit the permission refusal, ran `computer setup`, and stopped to ask the user to grant access rather than retrying or working around it.
- Outside Studio, the pinned SDK and daemon pair started the embedded daemon as a direct child, persisted a named session across separate CLI calls, and answered `list_windows`.

## Open

- **Watch it act.** Grant Accessibility and Screen Recording to a build launched through Launch Services, then run tasks against Finder, Notes, and Preview: whether background delivery works per app, how large `get_window_state` output gets on Electron and web-heavy apps, and how many turns a simple job takes.
- **Packaged build.** The SDK's native library must be unpacked (`asarUnpack`), and the nested `cua-driver` executable must be signed before the app is signed and notarized. Not yet checked in a signed build.
- **Windows and Linux.** No grants to wait for, but Windows needs an interactive session and its UI Automation helper (`cua-driver-uia.exe`, vendored), and Linux needs X11 or XWayland with AT-SPI. Neither has been run.
- **Size.** The universal `cua-driver` is about 71 MB and the SDK's per-platform library about 54 MB.
- **Release cadence.** Cua ships several releases a week, and the repo's minimum release age holds the SDK a week behind. Bumping means moving the SDK and the download script's version together.
- **Onboarding.** Settings is the only place to grant access; an onboarding step would ask before the first task needs it.
- **Prompt guidance.** The command's description calls it a last resort after files, CLIs, the app commands, `osascript`, and `agent-browser`. No eval covers when the agent should reach for it.
