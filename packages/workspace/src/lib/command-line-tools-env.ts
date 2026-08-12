import { execFileSync } from "node:child_process";
import fs from "node:fs";

// macOS ships ~110 binaries in /usr/bin -- `cc`, `git`, `make`, `python3`,
// `install_name_tool`, `strip`, `ranlib`, and the rest -- as xcode-select stubs
// rather than real tools. Each one resolves the active developer directory
// before doing anything else, and on a machine that has never installed the
// Command Line Tools that lookup ends by asking the system to install them:
// a modal dialog appears and the calling process blocks until someone answers.
// A tool call that reaches one simply hangs, in front of a user who has no idea
// what they are being asked.
//
// The lookup order is DEVELOPER_DIR, then the xcode-select link, then the
// defaults, and only then the installer. Pointing DEVELOPER_DIR at a path that
// does not exist stops it at the first step, so every stub fails immediately
// with an ordinary error instead of prompting. One variable covers all of them,
// however they were invoked -- by bare name or absolute path -- which $CC alone
// cannot do: it reaches only the four compiler stubs.
//
// Nothing the app ships needs Xcode. Python and Node dependencies install from
// prebuilt wheels and binaries, and `scripts/clt-shim-audit.ts` reports which
// stubs a real skill install reaches (today: uv relocating the managed
// interpreter's libpython with install_name_tool, which it treats as
// best-effort and continues without).

/**
 * Written to be legible in a support log: the path is reported verbatim by the
 * stubs ("missing DEVELOPER_DIR path: ..."), and that text reaches the agent's
 * tool output.
 */
export const MISSING_DEVELOPER_DIR =
  "/nonexistent/instrument-command-line-tools-not-installed";

/** A real binary that fails, so an unexpected compile ends rather than prompts. */
const NOOP_COMPILER = "/usr/bin/false";

// Probed once per process. `xcode-select -p` reports a missing developer
// directory as an ordinary error rather than offering to install one, so it is
// the one stub that is safe to run.
let cachedDeveloperDirectory: boolean | undefined;

/**
 * Mutates `process.env` so every process this one spawns inherits the guard,
 * including ones that never pass through {@link commandLineToolsEnv}: user app
 * dev servers, the real-binary escape hatches, and whatever gets added next.
 * Call once during startup. No-op when a developer directory is available.
 */
export function applyCommandLineToolsEnv() {
  Object.assign(process.env, commandLineToolsEnv());
}

/**
 * Env overlay that keeps the macOS Command Line Tools stubs from launching
 * their installer dialog. Returns `{}` (no override) on non-macOS hosts, when
 * `$DEVELOPER_DIR` is already set, or when a developer directory is available.
 */
export function commandLineToolsEnv(): Record<string, string> {
  if (process.platform !== "darwin") {
    return {};
  }
  // An explicitly configured toolchain outranks the guard, both because it is a
  // deliberate choice and because overwriting it would break a working setup.
  if (process.env.DEVELOPER_DIR) {
    return {};
  }
  if (hasDeveloperDirectory()) {
    return {};
  }
  return {
    DEVELOPER_DIR: MISSING_DEVELOPER_DIR,
    ...(process.env.CC ? {} : { CC: NOOP_COMPILER, CXX: NOOP_COMPILER }),
  };
}

function hasDeveloperDirectory(): boolean {
  if (cachedDeveloperDirectory === undefined) {
    try {
      const developerDir = execFileSync("xcode-select", ["-p"], {
        encoding: "utf8",
      }).trim();
      // The exit status alone is not enough: xcode-select reports the path it
      // was pointed at, which outlives the Xcode.app or CommandLineTools
      // directory a macOS upgrade or an uninstall removed. The stubs resolve
      // the directory itself, so that is what has to be checked.
      cachedDeveloperDirectory =
        developerDir !== "" && fs.existsSync(developerDir);
    } catch {
      cachedDeveloperDirectory = false;
    }
  }
  return cachedDeveloperDirectory;
}
