# Loading a Python skill popped the macOS Command Line Tools installer

**Status:** resolved by the native sandbox closing the installer service, with `DEVELOPER_DIR` and a shell refusal in front of it; checked 2026-10-13. Recorded 2026-07-29.

## Context

A new user on 1.4.1 uploaded a spreadsheet as their first task and got a system dialog asking to install the command line developer tools. They had no idea what it was asking and no reason to trust it.

An earlier fix had aimed at exactly this and missed. It pointed `$CC`/`$CXX` at `/usr/bin/false` on the theory that a skill install falling back to a source compile would reach `/usr/bin/cc`, which is an xcode-select stub. That reasoning was sound but the premise was wrong, and the fix shipped in the release the user was running.

## What we found

**The trigger surface is 95 binaries, not four.** On macOS 27, 95 tools in `/usr/bin` are stubs: hard links of two small binaries (78 sharing `make`'s file, 16 sharing `xcodebuild`'s) plus `xcrun`. Each imports libxcselect's `xcselect_invoke_xcrun`, which resolves the active developer directory before doing anything else, and when nothing can be found asks the system to install the tools, putting up a modal dialog and blocking the caller until someone answers. `git`, `make`, `python3`, `pip3`, `install_name_tool`, `strip`, `ranlib`, `libtool`, `strings` and `xcrun` itself are all stubs. Apple documents most of them under FILES in `man xcode-select`, though the list there is incomplete: `cc`, `c++`, and `objdump` are stubs the man page omits. `$CC`/`$CXX` influence four of them.

Eleven more tools link libxcselect without being stubs: `atos`, `devicectl`, `filtercalltree`, `heap`, `kmutil`, `leaks`, `malloc_history`, `sample`, `stringdups`, `symbols` and `vmmap` import `xcselect_get_developer_dir_path` to look the directory up, and with no developer directory they run normally. `xcode-select` itself is not a stub either: `xcode-select -p` reports a missing directory as an error and exits 2, and only `--install` asks for the installer.

**What raises the dialog is a launchd service.** A stub with no developer directory looks up the Mach service `com.apple.dt.CommandLineTools.installondemand` (`/System/Library/LaunchAgents/com.apple.dt.CommandLineTools.installondemand.plist`, Aqua sessions only), which launches `Install Command Line Developer Tools.app`. When the lookup fails, the stub prints `xcode-select: error: No developer tools were found and no install could be requested (possibly because there is no active GUI session)` and exits 1.

**Nothing in the affected path compiles.** The `spreadsheet` skill locks `pandas`, `numpy`, and `openpyxl`, all of which have `cp312-macosx_11_0_arm64` wheels, and its JS side is a tarball dependency with no native addons. `$CC` was never read.

**The actual caller is uv, provisioning its managed interpreter.** `scripts/clt-shim-audit.ts` shadows every stub name with a logging pass-through and runs the real `load_skill` installs. One non-benign hit, on a cold cache:

```
install_name_tool (1x)
  from uv: install_name_tool -id .../cpython-3.12.12-macos-aarch64-none/lib/libpython3.12.dylib ...
xcode-select (1x) -- probe only, never prompts
  from node: xcode-select -p
```

uv relocates the standalone CPython's dylib install name after unpacking it. That happens on the first Python skill load in a fresh install, which is exactly when the user hit it. Sweeping all twelve installable registry skills produces the same single result.

## The fix

`DEVELOPER_DIR` is consulted ahead of the xcode-select link, and therefore ahead of the branch that offers to install. Pointing it at a path that does not exist stops resolution at the first step, so every stub fails with an ordinary error instead of prompting, whether it was invoked by bare name or absolute path, which is what `$CC` could not cover. Verified against `cc`, `git`, `python3`, and `make` on a machine with Xcode selected: all four report `xcrun: error: missing DEVELOPER_DIR path` rather than falling through.

`commandLineToolsEnv()` in `packages/workspace/src/lib/command-line-tools-env.ts` sets it when macOS has no usable developer directory. `applyCommandLineToolsEnv()` runs from Studio's `setup-environment.ts` so every descendant process inherits it, rather than each spawn site having to remember — the gap that let the first fix cover uv and pnpm while missing the class.

Inheriting it is not automatic everywhere. uv and the shell's native commands are spawned with an env built from an allowlist (`inheritedEnv` in `native-env.ts`), so `DEVELOPER_DIR` has to be on that list, and `commandLineToolsEnv()` keeps returning the guard when the variable it finds on the process is its own. When neither held, a macOS 27 VM without the tools showed the installer on a chat's first `python3`, from uv's `install_name_tool` call.

The probe behind it checks that the directory `xcode-select -p` prints still exists. Exit status alone reports a path that outlives the `Xcode.app` or `CommandLineTools` directory a macOS upgrade or an uninstall removed, and the stubs resolve the directory itself.

uv treats the relocation as best-effort: with `DEVELOPER_DIR` poisoned it fails, uv continues, and the interpreter runs. Every registry skill still installs.

### A variable is not a boundary

`DEVELOPER_DIR` is only an environment variable, and a child that clears its environment drops it. On the macOS 27 VM without the tools, with the guard in every env we build, two probes still raised the dialog: Python's `subprocess.run(['/usr/bin/git', '--version'], env={})` and the real `/usr/bin/env -i /usr/bin/make --version`. Three layers now sit on top of the guard:

- **The native sandbox closes the installer service.** `seatbeltProfile` (`native-sandbox.ts`) denies `mach-lookup` of `com.apple.dt.CommandLineTools.installondemand` (`COMMAND_LINE_TOOLS_INSTALLER`), so every native command and everything it starts, env-scrubbed or not, gets the stub's "no install could be requested" error instead of the dialog. It is in every profile, tools or not: a Mac with the tools never asks, and `xcode-select --install` belongs in the person's Terminal. Checked on a Mac with Xcode by hiding the developer directories from a stub with `file-read*` denies: with the service closed every one of the 95 stubs, run through `env -i`, printed that error and exited 1, and a `bootstrap_look_up` of the service returns 1100 inside the profile and 0 outside it. `runUvCommand`, which installs skills and makes venvs outside the rules, runs under a profile that closes only that service (`withInstallerClosed`).
- **The shell refuses a stub.** On a Mac without the tools, a program the shell would run by PATH or by path (`make`, `/usr/bin/python3`, `xcrun`, `env make`) that `isCommandLineToolsStub` takes for a stub is not run: the agent reads `<name> needs Apple's Command Line Tools, which aren't installed on this Mac. Ask the person whether they want to install them (they run \`xcode-select --install\` in Terminal), and run the command again once they have.` with status 127, and `which` says the same. `command -v` and `type` still name the stub's path, since just-bash answers them from the same resolver and telling them apart needs a change to the just-bash patch. The test reads the binary: a stub imports `xcselect_invoke_xcrun`, so no list has to keep up with macOS. The `python3`, `git` and `node` the agent runs by name are the chat's virtualenv, dugite's git and Electron, never the stubs.
- **A stub a program reached is explained.** When a native command fails and its output carries the guard's path or the "no install could be requested" line, `execShim` appends the same advice, so a `pip install` that fell back to compiling says why.

**Detecting and re-detecting.** The probe runs `xcode-select -p` once at startup, before the guard is set, and checks that the directory it prints exists; `xcode-select -p` never asks for an install (it is not a stub; with no directory it exits 2). It runs again, with the guard taken out of its env (`xcode-select -p` prints `DEVELOPER_DIR` when it is set), whenever a stub is about to be refused or a command failed on one (`recheckCommandLineTools`). Once the tools are there it lifts the guard from the process, so the next spawn reaches them without a restart, and the command runs (or, for a failed one, the agent is told to run it again). Nothing is probed while nobody reaches for a stub.

**What the sandbox does not cover.** Local MCP servers (`apps/mcp/local-server.ts`) run outside it, since a server that drives Chromium sandboxes itself and Seatbelt does not nest; they get the guard in their env, after the manifest's own `env` so an app cannot replace it, and nothing stops a child of one that clears its env. `osascript` scripts that tell an allowed app run unwrapped with the guard in their env; `do shell script` is refused in them, so reaching a stub with its env cleared takes deliberately disguised code. A script that has Terminal run a command, and a Shortcuts "Run Shell Script" action, run in those apps with their own env. Studio's own spawns (`open`, `du`, `xattr`, fixed osascript, the Claude Code CLI) reach no stub and inherit the guard.

## Checking it

`scripts/clt-shim-audit.ts` runs on an ordinary Mac with the tools present, where no dialog can appear, and asserts the useful invariant instead: nothing we spawn reaches a stub.

```bash
cd packages/workspace
pnpm --silent script:clt-shim-audit -- --skill spreadsheet
pnpm --silent script:clt-shim-audit -- --mode guarded
```

- `shadow` shadows PATH with logging stubs that pass through to the real binary, so the install completes and the log names every stub reached.
- `developer-dir` poisons `DEVELOPER_DIR` directly, catching absolute-path invocations that PATH shadowing cannot see, and shows whether the flow survives without a toolchain.
- `guarded` makes `xcode-select -p` fail the way it does on a machine that has never installed the tools, so the product's own probe decides, sets the guard on the audit's process as Studio does, and fails if any stub the install or a `make` run through `execShim` reaches arrives without it: the end-to-end check that the guard engages and survives each spawn site's env. It then runs a real chat shell and fails unless `make`, `/usr/bin/make`, `xcrun --find clang`, `env make` and `which make` are refused without reaching a stub, and unless a Python the shell starts is refused the installer service. That last check is skipped where the service is not reachable outside the sandbox either, as on a CI runner with no GUI session.

`guarded` reports what the product chose on its own, then the install result:

```
guard engaged: DEVELOPER_DIR=/nonexistent/instrument-command-line-tools-not-installed CC=/usr/bin/false CXX=/usr/bin/false
spreadsheet
  pnpm install: ok
  uv install:   success
  interpreter:  runs (3.12.12)
```

`guarded` has to run alone: the probe caches for the life of the process, so the first pass decides what later passes see.

The `shadow` and `guarded` passes run on the macOS leg of `smoke-test.yml`. Both exit non-zero on a failed install, an interpreter that cannot run, or a stub outside `EXPECTED_SHIMS` — a name no previous run reached is a new way for the dialog to appear, so it fails rather than scrolling past in a log. `guarded` additionally fails if the guard does not engage.

`CLT_SHIM_NAMES` in `scripts/lib/clt-shims.ts` is the committed stub list, and `compareHostShims()` re-derives it from the running OS with `isCommandLineToolsStub`: a stub the list lacks is a warning, and a listed stub the test no longer recognizes fails every pass, since the shell would then run it.

## What is still open

On the macOS VM without the tools, the guard alone held for every stub reached with the env we build, by name, by path, through `xcrun`, the shell's `env`, and an `osascript` `do shell script`, and failed for a child that cleared its env. The installer service being closed inside the profile is verified on a Mac with the tools by hiding its developer directories; the same two probes on the VM are what settle it there.

The reporter's screenshot names `install_name_tool` in the dialog title, which confirms the caller the audit identified rather than leaving it inferred. The VM's dialog on a chat's first `python3` came the same way: the shell's `python3` is the chat's virtualenv, which uv makes by provisioning its managed CPython and relocating it with `install_name_tool` by bare name; the bundled uv names no `/usr/bin/python3`, and with `UV_PYTHON_PREFERENCE=only-managed` it runs no system interpreter. A cold-cache shadow pass logs `install_name_tool` from uv and no `python3`.

We have no measure of how many users have no developer tools at all, so the size of the population this protects is unknown.

## Why not bundle Python instead

Shipping our own CPython would remove today's single trigger and leave the class intact: `uv pip install` still runs for every Python skill, and any package without a matching wheel builds from source and reaches `cc`, `make`, `ar`, and `ranlib`. The guard would still be wanted afterward. Against that sit five platform builds to keep patched, signing a Python framework through notarization, tens of megabytes on every download including users who never touch Python, and a CPython CVE becoming an app release rather than a version bump. `MANAGED_PYTHON_VERSION` is also deliberately pinned to 3.12 because newer interpreters outrun the scientific wheel ecosystem, and uv keeps the option of provisioning a different version per skill.

The real argument for bundling is unrelated to this dialog: the first Python skill needs a download from GitHub releases, so an offline user or a restrictive proxy gets a failed skill load. Pre-warming the managed interpreter during onboarding addresses most of that without bundling.

## Related

- `docs/architecture/agent-sandbox.md` — the real-binary escape hatches, of which uv/python is one
- `docs/findings/loopback-block-is-curl-only.md` — same shape: a guard applied at one shim rather than to the whole process tree
