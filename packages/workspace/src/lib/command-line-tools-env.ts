import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";

// macOS ships 95 binaries in /usr/bin -- `cc`, `git`, `make`, `python3`,
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

/**
 * The launchd service a stub asks to show the installer. The native sandbox
 * closes it, so a stub run with the guard scrubbed from its environment
 * (`env -i`, a script that builds its own) still cannot raise the dialog.
 */
export const COMMAND_LINE_TOOLS_INSTALLER =
  "com.apple.dt.CommandLineTools.installondemand";

/**
 * The symbol a stub calls to hand itself to the developer directory's real
 * tool. Every stub imports it, so its name is in the binary; the real tools
 * that link libxcselect only to look the directory up (`leaks`, `heap`,
 * `kmutil`) import something else and never ask for an install.
 */
const STUB_MARKER = "xcselect_invoke_xcrun";

/** Stubs are a few hundred kilobytes; a larger file is not read. */
const STUB_MAX_BYTES = 4 * 1024 * 1024;

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
  const configured = process.env.DEVELOPER_DIR;
  // The guard itself, set on this process by applyCommandLineToolsEnv, is a
  // decision already made rather than a toolchain someone chose: the overlay
  // stays whole, so a spawn site that builds its env from scratch still gets it.
  if (configured === MISSING_DEVELOPER_DIR) {
    return guard();
  }
  // An explicitly configured toolchain outranks the guard, both because it is a
  // deliberate choice and because overwriting it would break a working setup.
  if (configured) {
    return {};
  }
  if (hasDeveloperDirectory()) {
    return {};
  }
  return guard();
}

function guard() {
  const cc = process.env.CC;
  return {
    DEVELOPER_DIR: MISSING_DEVELOPER_DIR,
    ...(cc && cc !== NOOP_COMPILER
      ? {}
      : { CC: NOOP_COMPILER, CXX: NOOP_COMPILER }),
  };
}

function hasDeveloperDirectory(): boolean {
  if (cachedDeveloperDirectory === undefined) {
    try {
      cachedDeveloperDirectory = developerDirectoryExists(
        execFileSync("xcode-select", ["-p"], {
          encoding: "utf8",
          env: probeEnv(),
        }),
      );
    } catch {
      cachedDeveloperDirectory = false;
    }
  }
  return cachedDeveloperDirectory;
}

// The exit status alone is not enough: xcode-select reports the path it was
// pointed at, which outlives the Xcode.app or CommandLineTools directory a
// macOS upgrade or an uninstall removed. The stubs resolve the directory
// itself, so that is what has to be checked.
function developerDirectoryExists(printed: string) {
  const developerDir = printed.trim();
  return developerDir !== "" && fs.existsSync(developerDir);
}

/**
 * The environment the probe runs in. `xcode-select -p` prints `DEVELOPER_DIR`
 * when it is set, so with the guard on this process it would answer for the
 * guard rather than the disk.
 */
function probeEnv() {
  const env = { ...process.env };
  delete env.DEVELOPER_DIR;
  return env;
}

/**
 * Whether this Mac has no developer tools, so a stub would ask to install
 * them: the guard is what {@link commandLineToolsEnv} decided on. False off
 * macOS and wherever a toolchain is configured or installed.
 */
export function commandLineToolsMissing(): boolean {
  return commandLineToolsEnv().DEVELOPER_DIR === MISSING_DEVELOPER_DIR;
}

/**
 * Who else holds the guard: in the bash worker, the main thread, whose
 * `process.env` is its own, and whose spawns (a skill's install) keep the
 * guard until told.
 */
let toolsArrived: () => void = () => {};

/** Sets who is told once a recheck finds the tools installed. */
export function setCommandLineToolsArrivedForwarder(forward: () => void) {
  toolsArrived = forward;
}

/**
 * Asks again whether the tools are installed, for a Mac that had none when the
 * probe first ran: the person may have installed them since. Once they are
 * there, the guard comes off this process, so every later spawn reaches the
 * tools without a restart, and whoever else holds it is told. Resolves
 * whether they are still missing.
 */
export async function recheckCommandLineTools(): Promise<boolean> {
  if (!commandLineToolsMissing()) {
    return false;
  }
  let installed = false;
  try {
    const { stdout } = await promisify(execFile)("xcode-select", ["-p"], {
      encoding: "utf8",
      env: probeEnv(),
    });
    installed = developerDirectoryExists(stdout);
  } catch {
    installed = false;
  }
  if (!installed) {
    return true;
  }
  cachedDeveloperDirectory = true;
  if (process.env.DEVELOPER_DIR === MISSING_DEVELOPER_DIR) {
    delete process.env.DEVELOPER_DIR;
  }
  if (process.env.CC === NOOP_COMPILER) {
    delete process.env.CC;
  }
  if (process.env.CXX === NOOP_COMPILER) {
    delete process.env.CXX;
  }
  toolsArrived();
  return false;
}

const stubs = new Map<string, boolean>();

/**
 * Whether the file at `hostPath` is one of the xcode-select stubs, read off
 * the binary itself, so a macOS release that adds or drops one needs no list.
 * Remembered per path for the life of the process: the stubs live on the
 * system volume, which changes only with a macOS update and a restart.
 */
export async function isCommandLineToolsStub(
  hostPath: string,
): Promise<boolean> {
  const known = stubs.get(hostPath);
  if (known !== undefined) {
    return known;
  }
  let stub = false;
  try {
    const { size } = await fs.promises.stat(hostPath);
    stub =
      size <= STUB_MAX_BYTES &&
      (await fs.promises.readFile(hostPath)).includes(STUB_MARKER);
  } catch {
    stub = false;
  }
  stubs.set(hostPath, stub);
  return stub;
}

const INSTALL_ADVICE =
  "Ask the person whether they want to install them (they run `xcode-select --install` in Terminal), and run the command again once they have.";

/** What the agent is told in place of running a stub, named by its file name. */
export function commandLineToolsRefusal(command: string): string {
  const name = command.split("/").at(-1) ?? command;
  return `${name} needs Apple's Command Line Tools, which aren't installed on this Mac. ${INSTALL_ADVICE}\n`;
}

/**
 * The note for a command that failed on the guard after the person installed
 * the tools: the recheck lifted it, so running the command again works.
 */
export const COMMAND_LINE_TOOLS_ARRIVED =
  "Apple's Command Line Tools are installed now, so run the command again.\n";

/**
 * The note for a command whose own program reached a stub that failed: the
 * guard's error, or the stub's report that the closed installer service could
 * not be asked. Undefined for output that shows neither.
 */
export function commandLineToolsNote(output: string): string | undefined {
  return output.includes(MISSING_DEVELOPER_DIR) ||
    output.includes("no install could be requested")
    ? `A program this command started needs Apple's Command Line Tools, which aren't installed on this Mac. ${INSTALL_ADVICE}\n`
    : undefined;
}
