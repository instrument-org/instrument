# Loading a Python skill popped the macOS Command Line Tools installer

**Status:** resolved by the native sandbox closing the installer service, with `DEVELOPER_DIR` kept only for local MCP servers; checked 2026-10-13. Recorded 2026-07-29.

## Context

A new user on 1.4.1 uploaded a spreadsheet as their first task and got a system dialog asking to install the command line developer tools. They had no idea what it was asking and no reason to trust it.

An earlier fix had aimed at exactly this and missed. It pointed `$CC`/`$CXX` at `/usr/bin/false` on the theory that a skill install falling back to a source compile would reach `/usr/bin/cc`, which is an xcode-select stub. That reasoning was sound but the premise was wrong, and the fix shipped in the release the user was running.

## What we found

**The trigger surface is 95 binaries, not four.** On macOS 27, 95 tools in `/usr/bin` are stubs: hard links of two small binaries (78 sharing `make`'s file, 16 sharing `xcodebuild`'s) plus `xcrun`. Each imports libxcselect's `xcselect_invoke_xcrun`, which resolves the active developer directory before doing anything else, and when nothing can be found asks the system to install the tools, which puts up a dialog. The stub does not wait for it: on macOS 27.0.1 it prints `xcode-select: note: No developer tools were found, requesting install.` and exits 1 within 0.04 s, so a tool call that reaches one fails rather than hangs, and the dialog stays on screen for someone who has no idea what it is asking. `git`, `make`, `python3`, `pip3`, `install_name_tool`, `strip`, `ranlib`, `libtool`, `strings` and `xcrun` itself are all stubs. Apple documents most of them under FILES in `man xcode-select`, though the list there is incomplete: `cc`, `c++`, and `objdump` are stubs the man page omits. `$CC`/`$CXX` influence four of them.

Eleven more tools link libxcselect without being stubs: `atos`, `devicectl`, `filtercalltree`, `heap`, `kmutil`, `leaks`, `malloc_history`, `sample`, `stringdups`, `symbols` and `vmmap` import `xcselect_get_developer_dir_path` to look the directory up, and with no developer directory they run normally. `xcode-select` itself is not a stub either: `xcode-select -p` reports a missing directory as an error and exits 2, and only `--install` asks for the installer.

**What raises the dialog is a launchd service.** A stub with no developer directory looks up the Mach service `com.apple.dt.CommandLineTools.installondemand` (`/System/Library/LaunchAgents/com.apple.dt.CommandLineTools.installondemand.plist`, Aqua sessions only), which launches `Install Command Line Developer Tools.app`. When the lookup fails, the stub prints `xcode-select: error: No developer tools were found and no install could be requested (possibly because there is no active GUI session)` and exits 1.

**Nothing in the affected path compiles.** The `spreadsheet` skill locks `pandas`, `numpy`, and `openpyxl`, all of which have `cp312-macosx_11_0_arm64` wheels, and its JS side is a tarball dependency with no native addons. `$CC` was never read.

**The actual caller is uv, provisioning its managed interpreter.** `packages/workspace/scripts/clt-shim-audit.ts` shadows every stub name with a logging pass-through and runs the real `load_skill` installs. One non-benign hit, on a cold cache:

```
install_name_tool (1x)
  from uv: install_name_tool -id .../cpython-3.12.12-macos-aarch64-none/lib/libpython3.12.dylib ...
xcode-select (1x) -- probe only, never prompts
  from node: xcode-select -p
```

uv relocates the standalone CPython's dylib install name after unpacking it. That happens on the first Python skill load in a fresh install, which is exactly when the user hit it. Sweeping all twelve installable registry skills produces the same single result.

## The fix

**The native sandbox closes the installer service.** `seatbeltProfile` (`native-sandbox/seatbelt.ts`) denies `mach-lookup` of `com.apple.dt.CommandLineTools.installondemand` (`COMMAND_LINE_TOOLS_INSTALLER`) in every profile, so every native command and everything it starts, with its environment cleared or not, gets the stub's "no install could be requested" error instead of the dialog. It is there whether or not the tools are installed: a Mac with the tools never asks, and `xcode-select --install` belongs in the person's Terminal. On a macOS 27 VM without the tools, every one of the 95 stubs, run through `env -i` under a profile holding only that deny, printed `xcode-select: error: No developer tools were found and no install could be requested (possibly because there is no active GUI session).`, exited 1, and raised no dialog. `installManagedPython` (`run-uv.ts`), which runs uv as the app, outside any chat's reach, to provision the managed interpreter, runs under a profile that closes only that service (`withInstallerClosed`); that is the step that runs `install_name_tool`. uv treats the relocation as best-effort: when it fails, uv continues and the interpreter runs.

**The shell says what to do.** A stub's own error does not say what to do. When a native command fails and its output carries "no install could be requested", `execShim` appends `This command, or a program it started, needs Apple's Command Line Tools, which aren't installed on this Mac. Ask the person whether they want to install them (they run \`xcode-select --install\` in Terminal), and run the command again once they have.` `xcode-select --install` under the profile reports the refused request (`no developer tools were found, and no install could be requested (perhaps no UI is present)`) and still exits 0, so `execShim` reads its output whatever the exit code and fails it. The shell does not pick stubs out ahead of time: `make` runs and fails with status 1, Apple's lines and then the note, and `which make` names `/usr/bin/make`.

**What the sandbox does not cover.** Local MCP servers (`apps/mcp/local-server.ts`) run outside it, since a server that drives Chromium sandboxes itself and Seatbelt does not nest: an Electron app launched under even the one-line profile had every helper fail `sandbox initialization failed: Operation not permitted`. Their launches and their `pnpm add` installs get `DEVELOPER_DIR` pointed at a path that does not exist (`commandLineToolsEnv()` in `command-line-tools-env.ts`), last in the launch's environment, after the credential, so nothing an app names replaces it. `DEVELOPER_DIR` is consulted ahead of the xcode-select link, and therefore ahead of the branch that offers to install, so every stub fails with `xcrun: error: missing DEVELOPER_DIR path` instead of prompting, whether it was invoked by bare name or absolute path. It is only a variable, and a child that clears its environment drops it; that is accepted for third-party code the person chose to run. `commandLineToolsEnv()` sets it only when `xcode-select -p` fails or prints a directory that no longer exists (an upgrade or uninstall leaves the path behind), and `xcode-select -p` never asks for an install. It keeps a `DEVELOPER_DIR` someone configured, and asks again at each launch until it finds the tools, so tools installed since need no restart.

The other spawns outside the profile: `osascript` scripts that tell an allowed app (`do shell script` is refused in them), `agent-browser`, and Studio's own spawns (`open`, `du`, `xattr`, fixed osascript, the Claude Code CLI), none of which carries `DEVELOPER_DIR`. A script that has Terminal run a command, and a Shortcuts "Run Shell Script" action, run in those apps with their own environment. A stub any of these reached would show the dialog, and fail at once.

**Layers the service deny replaced.** Before it, `DEVELOPER_DIR` was set on Studio's own process at startup and carried through the native environment allowlist, with `CC`/`CXX=/usr/bin/false` beside it, and the shell read each program's binary for the stub's import (`xcselect_invoke_xcrun`) and refused one with status 127 before it ran, rechecking `xcode-select -p` to lift all of it once the tools arrived. Inside the profile the variable added nothing the deny did not, and the refusal said what the note now says. `CC=/usr/bin/false` was worse than nothing: a build that compiled through `$CC` failed as `/usr/bin/false`, with no text the note could recognize.

## Checking it

`packages/workspace/scripts/clt-shim-audit.ts` runs on an ordinary Mac with the tools present, where no dialog can appear, and asserts the useful invariants instead: which stubs a real skill install reaches, and that none of them could have asked for the installer.

```bash
cd packages/workspace
pnpm --silent script:clt-shim-audit -- --mode shadow
pnpm --silent script:clt-shim-audit -- --mode sandboxed
```

- `shadow` shadows PATH with logging stubs that pass through to the real binary, so the install completes and the log names every stub reached.
- `sandboxed` has the logging stubs answer as real ones do on a Mac without the tools whose installer service is closed: Apple's "no install could be requested" error and exit 1, `xcode-select -p` reporting no directory, and `xcode-select --install` reporting the refused request with exit 0. Each stub also records whether the installer service was in reach where it ran. The install has to succeed anyway, no stub may have had the service in reach, and a real chat shell has to fail `make`, `env make` and `xcode-select --install` with the note, and keep a Python it starts from the service. The service checks are skipped where the service is not reachable outside the sandbox either, as on a CI runner with no GUI session.

`sandboxed` reports the install, the stubs it reached, then the shell:

```
spreadsheet
  pnpm install: ok
  uv install:   success
  interpreter:  runs (3.12.13)

Command Line Tools stubs reached:
  install_name_tool (1x)
    from ?: install_name_tool -id .../cpython-3.12.13-macos-aarch64-none/lib/libpython3.12.dylib ...

shell boundary:
  ok   make --version: exit 1, This command, or a program it started, needs Apple's Command Line Tools, ...
  ok   env make --version: exit 1, This command, or a program it started, needs Apple's Command Line Tools, ...
  ok   xcode-select --install: exit 1, This command, or a program it started, needs Apple's Command Line Tools, ...
  ok   installer service from inside the sandbox: 1100 (0 outside it)
```

Both passes run on the macOS legs of `release.yml` and on `smoke-test.yml`. Both exit non-zero on a failed install, an interpreter that cannot run, or a stub outside `EXPECTED_SHIMS`: a name no previous run reached is a new way for the dialog to appear, so it fails rather than scrolling past in a log. `sandboxed` also fails on a stub that had the installer service in reach, or a command the shell did not add the note to.

`CLT_SHIM_NAMES` in `packages/workspace/scripts/lib/clt-shims.ts` is the list of stubs the passes shadow: the binaries in macOS 27's `/usr/bin` that import `xcselect_invoke_xcrun`. Nothing re-derives it from the running OS, so a stub a later macOS adds is not shadowed until the list gains it.

## What is still open

The audit simulates a stub's answer on a Mac that has the tools, so it shows the profile reaches every process an install starts and that the shell wires the note, not what Apple prints. The note keys on "no install could be requested", which both of Apple's wordings carry on macOS 27 (the stubs' and `xcode-select --install`'s); a release that rewords them would lose the note, not the deny.

The reporter's screenshot names `install_name_tool` in the dialog title, which confirms the caller the audit identified rather than leaving it inferred. The VM's dialog on a chat's first `python3` came the same way: the shell's `python3` is the chat's virtualenv, which uv makes by provisioning its managed CPython and relocating it with `install_name_tool` by bare name; the bundled uv names no `/usr/bin/python3`, and with `UV_PYTHON_PREFERENCE=only-managed` it runs no system interpreter. A cold-cache shadow pass logs `install_name_tool` from uv and no `python3`.

We have no measure of how many users have no developer tools at all, so the size of the population this protects is unknown.

## Why not bundle Python instead

Shipping our own CPython would remove today's single trigger and leave the class intact: `uv pip install` still runs for every Python skill, and any package without a matching wheel builds from source and reaches `cc`, `make`, `ar`, and `ranlib`. The sandbox's deny would still be wanted afterward. Against that sit five platform builds to keep patched, signing a Python framework through notarization, tens of megabytes on every download including users who never touch Python, and a CPython CVE becoming an app release rather than a version bump. `MANAGED_PYTHON_VERSION` is also deliberately pinned to 3.12 because newer interpreters outrun the scientific wheel ecosystem, and uv keeps the option of provisioning a different version per skill.

The real argument for bundling is unrelated to this dialog: the first Python skill needs a download from GitHub releases, so an offline user or a restrictive proxy gets a failed skill load. Pre-warming the managed interpreter during onboarding addresses most of that without bundling.

## Related

- `docs/architecture/agent-sandbox.md` — the real-binary escape hatches, of which uv/python is one
- `docs/findings/loopback-block-is-curl-only.md` — same shape: a guard applied at one shim rather than to the whole process tree
