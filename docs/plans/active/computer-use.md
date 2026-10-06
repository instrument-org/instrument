# Plan: Computer Use through an embedded Cua Driver

Status: spike, behind the `computer_use` feature flag. On macOS a signed build drives other apps (Chrome, Drafts) once both grants are in place; Windows and Linux are untested.

Computer Use is the agent operating the user's native apps: reading a window's accessibility tree and a screenshot of it, then clicking, typing, and scrolling in it. It is a feature too large to build per platform ourselves, so it rides on [Cua Driver](https://github.com/trycua/cua) (MIT), a Rust driver with macOS, Windows, and Linux builds.

## Shape

- **Studio main owns the driver** (`apps/studio/src/electron-main/lib/computer-driver.ts`). On first use it starts `cua-driver serve --embedded` as a direct child through the SDK's `EmbeddedCuaDriverHost` (`@trycua/cua-driver`). A direct child works under the app's own Accessibility and Screen Recording grants, so the user grants Instrument once and there is no second app to install. The daemon starts only once macOS reports both grants, restarts when they change, and stops in the quit teardown.
- **Setup is a Settings screen, never the agent.** Settings, Computer Use (shown once the flag is on) walks through Accessibility, Screen Recording, and a test capture, reading each grant again whenever the window regains focus. Each step raises the system's own request where macOS has one and links to its Privacy & Security pane, named for the running macOS (Device Control and Data Access from macOS 27; Screen & System Audio Recording from macOS 15). A Screen Recording grant made in the pane reaches the app only after a relaunch, which the screen offers. The test capture is where macOS's direct-capture consent ("bypass the private window picker") appears, rather than mid-task.
- **The agent is offered `computer` only once setup is complete.** The bash description lists it while the flag is on and both grants are in place (read through Electron, synchronously, per request). Otherwise the command refuses and names the Settings screen; there is no agent-side setup command.
- **The agent reaches the driver through the `computer` shell command** (`packages/workspace/src/lib/shell-commands/computer.ts`), a main-thread command that runs `cua-driver call <tool> <json> --socket <private endpoint> --session instrument-<task>`. Each call takes about 20 ms. A named session per task keeps element indices valid from one call to the next; the command starts it before every call, which returns the live one. A driver that fails to load is reported as the app's fault, since a raw path in the error once sent a model off blaming the app's install location.
- **The tool surface is an allowlist**: inspection (`list_apps`, `list_windows`, `get_window_state`, `get_desktop_state`, `zoom`, ...) and actions (`click`, `type_text`, `hotkey`, `invoke_menu`, ...). Left out: `browser_*` (that is `agent-browser`), `kill_app`, the clipboard, and the driver's own administration.
- **Snapshots** from `get_window_state`, `get_desktop_state`, and `zoom` save their image under the task's screenshots folder and name it in the output for the agent to read. `get_window_state` output keeps only the markdown tree: the structured `elements` array duplicates it, and the application menu bar, which can be half of a snapshot, is reached by title through `invoke_menu` instead.
- **The executable** is vendored by `apps/studio/scripts/download-cua-driver.ts` from the matching GitHub release, checksum-verified, into `resources/cua-driver/`, which ships unpacked. Keep its version equal to the SDK's; they share a contract version.
- **Packaging.** The SDK derives its native library's path from its own module URL and hands it to dlopen, which cannot read an asar, so a packaged build imports the SDK from `app.asar.unpacked` by path and `@trycua` and `@ubjs` are unpacked whole. The signed build signs the nested `cua-driver` and the SDK's library with the app's Developer ID and passes notarization.
- **Telemetry**: the driver reports usage unless `CUA_DRIVER_RS_TELEMETRY_ENABLED=false`. The host passes it to the daemon (the embedded host refuses variables outside its allowlist) and the command passes it to the CLI.

## What runs showed

- With both grants in place, a signed build listed Chrome's windows across five Chrome processes, read each window's tree and screenshot, and drove Drafts.
- The accessibility tree gives Chrome's tab titles but not their URLs, so the agent fell back to `osascript`, which reaches only one Chrome process.
- Asked to grant access themselves, models split: one ran the old setup command, another told the user to. Moving setup to Settings removes the choice.

## Open

- **Windows and Linux.** No grants to wait for, but Windows needs an interactive session and its UI Automation helper (`cua-driver-uia.exe`, vendored), and Linux needs X11 or XWayland with AT-SPI. Neither has been run.
- **First-run onboarding.** The Settings screen is reachable only after turning the flag on; a shipped feature would offer it from onboarding or the first time a task could use it.
- **Size.** The universal `cua-driver` is about 71 MB and the SDK's per-platform library about 54 MB.
- **Release cadence.** Cua ships several releases a week, faster than the repo's minimum release age, so the pinned version is an exact-version exclusion in `pnpm-workspace.yaml`. Bumping means moving that exclusion, the SDK, and the download script's version together.
- **Prompt guidance.** The command's description calls it a last resort after files, CLIs, the app commands, `osascript`, and `agent-browser`. No eval covers when the agent should reach for it.
