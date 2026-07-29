# Loading a Python skill popped the macOS Command Line Tools installer

**Status:** resolved by `DEVELOPER_DIR`. Recorded 2026-07-29. Last updated 2026-07-29.

## Context

A new user on 1.4.1 uploaded a spreadsheet as their first task and got a system dialog asking to install the command line developer tools. They had no idea what it was asking and no reason to trust it.

An earlier fix had aimed at exactly this and missed. It pointed `$CC`/`$CXX` at `/usr/bin/false` on the theory that a skill install falling back to a source compile would reach `/usr/bin/cc`, which is an xcode-select stub. That reasoning was sound but the premise was wrong, and the fix shipped in the release the user was running.

## What we found

**The trigger surface is ~110 binaries, not four.** Every tool in `/usr/bin` that links `libxcselect.dylib` is a stub: it resolves the active developer directory before doing anything else, and when nothing can be found it asks the system to install the tools, putting up a modal dialog and blocking the caller until someone answers. `git`, `make`, `python3`, `pip3`, `install_name_tool`, `strip`, `ranlib`, `libtool`, and `strings` are all stubs. Apple documents most of them under FILES in `man xcode-select`, though the list there is incomplete — `cc`, `c++`, `objdump`, and `heap` are stubs the man page omits. `$CC`/`$CXX` influence four of them.

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

`DEVELOPER_DIR` is consulted ahead of the xcode-select link, and therefore ahead of the branch that offers to install. Pointing it at a path that does not exist stops resolution at the first step, so every stub fails with an ordinary error instead of prompting — regardless of whether it was invoked by bare name or absolute path, which is what `$CC` could not cover. Verified against `cc`, `git`, `python3`, and `make` on a machine with Xcode selected: all four report `xcrun: error: missing DEVELOPER_DIR path` rather than falling through.

`commandLineToolsEnv()` in `packages/workspace/src/lib/command-line-tools-env.ts` sets it when macOS has no usable developer directory. `applyCommandLineToolsEnv()` runs from Studio's `setup-environment.ts` so every descendant process inherits it, rather than each spawn site having to remember — the gap that let the first fix cover uv and pnpm while missing the class.

The probe behind it checks that the directory `xcode-select -p` prints still exists. Exit status alone reports a path that outlives the `Xcode.app` or `CommandLineTools` directory a macOS upgrade or an uninstall removed, and the stubs resolve the directory itself.

uv treats the relocation as best-effort: with `DEVELOPER_DIR` poisoned it fails, uv continues, and the interpreter runs. Every registry skill still installs.

## Checking it

`scripts/clt-shim-audit.ts` runs on an ordinary Mac with the tools present, where no dialog can appear, and asserts the useful invariant instead: nothing we spawn reaches a stub.

```bash
cd packages/workspace
pnpm --silent script:clt-shim-audit -- --skill spreadsheet
pnpm --silent script:clt-shim-audit -- --mode guarded
```

- `shadow` shadows PATH with logging stubs that pass through to the real binary, so the install completes and the log names every stub reached.
- `developer-dir` poisons `DEVELOPER_DIR` directly, catching absolute-path invocations that PATH shadowing cannot see, and shows whether the flow survives without a toolchain.
- `guarded` makes `xcode-select -p` fail the way it does on a machine that has never installed the tools, so the product's own probe decides — the end-to-end check that the guard engages.

`guarded` reports what the product chose on its own, then the install result:

```
guard engaged: DEVELOPER_DIR=/nonexistent/instrument-command-line-tools-not-installed CC=/usr/bin/false CXX=/usr/bin/false
spreadsheet
  pnpm install: ok
  uv install:   success
  interpreter:  runs (3.12.12)
```

`guarded` has to run alone: the probe caches for the life of the process, so the first pass decides what later passes see.

`CLT_SHIM_NAMES` in `scripts/lib/clt-shims.ts` is the committed stub list, and `findUnlistedHostShims()` re-derives it from the running OS so a macOS release that adds one surfaces as a warning rather than a silent gap.

## What is still open

Nobody has watched this on a Mac that has never installed the Command Line Tools. What is established is that resolution terminates at `DEVELOPER_DIR` before reaching the install request, and that the guard engages and costs nothing. A VM without the tools is what would settle it.

The `shadow` pass is not wired into CI. Turning it into an assertion — fail when any non-benign stub is reached — is the natural next step, and it needs no special machine.

We also have no measure of how many users have no developer tools at all, so the population this protects is unknown.

## Why not bundle Python instead

Shipping our own CPython would remove today's single trigger and leave the class intact: `uv pip install` still runs for every Python skill, and any package without a matching wheel builds from source and reaches `cc`, `make`, `ar`, and `ranlib`. The guard would still be wanted afterward. Against that sit five platform builds to keep patched, signing a Python framework through notarization, tens of megabytes on every download including users who never touch Python, and a CPython CVE becoming an app release rather than a version bump. `MANAGED_PYTHON_VERSION` is also deliberately pinned to 3.12 because newer interpreters outrun the scientific wheel ecosystem, and uv keeps the option of provisioning a different version per skill.

The real argument for bundling is unrelated to this dialog: the first Python skill needs a download from GitHub releases, so an offline user or a restrictive proxy gets a failed skill load. Pre-warming the managed interpreter during onboarding addresses most of that without bundling.

## Related

- `docs/architecture/agent-sandbox.md` — the real-binary escape hatches, of which uv/python is one
- `docs/findings/loopback-block-is-curl-only.md` — same shape: a guard applied at one shim rather than to the whole process tree
