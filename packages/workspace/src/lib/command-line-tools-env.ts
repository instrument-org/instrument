import { execFileSync } from "node:child_process";
import fs from "node:fs";

// macOS ships 95 binaries in /usr/bin -- `cc`, `git`, `make`, `python3`,
// `install_name_tool`, `strip`, `ranlib`, and the rest -- as xcode-select stubs
// rather than real tools. Each one resolves the active developer directory
// before doing anything else, and on a machine that has never installed the
// Command Line Tools that lookup ends by asking a launchd service to install
// them: a dialog the person has no reason to trust appears, and the stub
// exits 1.
//
// Every command the agent runs is under a native sandbox profile that closes
// that service (native-sandbox/seatbelt.ts), so a stub there prints that no install
// could be requested and exits, whatever its environment, and the shell adds
// {@link commandLineToolsNote}. What runs outside the sandbox and may reach a
// stub is a local MCP server, which gets {@link commandLineToolsEnv}: the
// lookup order is DEVELOPER_DIR, then the xcode-select link, then the
// defaults, and only then the installer, so a DEVELOPER_DIR that does not
// exist stops it at the first step.
//
// Nothing the app ships needs Xcode. Python and Node dependencies install from
// prebuilt wheels and binaries, and `scripts/clt-shim-audit.ts` reports which
// stubs a real skill install reaches (today: uv relocating the managed
// interpreter's libpython with install_name_tool, which it treats as
// best-effort and continues without).

/**
 * Written to be legible in a support log: the path is reported verbatim by the
 * stubs ("missing DEVELOPER_DIR path: ...").
 */
const MISSING_DEVELOPER_DIR =
  "/nonexistent/instrument-command-line-tools-not-installed";

/**
 * The launchd service a stub asks to show the installer. The native sandbox
 * closes it, so a stub cannot raise the dialog from inside, however it was
 * started.
 */
export const COMMAND_LINE_TOOLS_INSTALLER =
  "com.apple.dt.CommandLineTools.installondemand";

// Remembered once found: tools that are there stay for the life of the
// process. A Mac without them is asked again each time, so tools the person
// installs since are reached without a restart.
let developerDirectoryFound = false;

/**
 * Env overlay that keeps the macOS Command Line Tools stubs from launching
 * their installer dialog, for a process the native sandbox cannot hold.
 * Returns `{}` (no override) on non-macOS hosts, when `$DEVELOPER_DIR` is
 * already set, or when a developer directory is available.
 */
export function commandLineToolsEnv(): Record<string, string> {
  // An explicitly configured toolchain outranks the guard, both because it is
  // a deliberate choice and because overwriting it would break a working
  // setup.
  if (
    process.platform !== "darwin" ||
    process.env.DEVELOPER_DIR ||
    hasDeveloperDirectory()
  ) {
    return {};
  }
  return { DEVELOPER_DIR: MISSING_DEVELOPER_DIR };
}

// `xcode-select -p` reports a missing developer directory as an ordinary
// error rather than offering to install one, so it is the one stub that is
// safe to run. Its exit status alone is not enough: it reports the path it
// was pointed at, which outlives the Xcode.app or CommandLineTools directory
// a macOS upgrade or an uninstall removed. The stubs resolve the directory
// itself, so that is what has to be checked.
function hasDeveloperDirectory(): boolean {
  if (!developerDirectoryFound) {
    try {
      const developerDir = execFileSync("xcode-select", ["-p"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      developerDirectoryFound =
        developerDir !== "" && fs.existsSync(developerDir);
    } catch {
      developerDirectoryFound = false;
    }
  }
  return developerDirectoryFound;
}

/**
 * The note for a command that reached a stub on a Mac without the tools: the
 * stub's report that the installer service the sandbox closes could not be
 * asked, which does not say what to do. Undefined for output without it.
 */
export function commandLineToolsNote(output: string): string | undefined {
  return output.includes("no install could be requested")
    ? "This command, or a program it started, needs Apple's Command Line Tools, which aren't installed on this Mac. Ask the person whether they want to install them (they run `xcode-select --install` in Terminal), and run the command again once they have.\n"
    : undefined;
}
