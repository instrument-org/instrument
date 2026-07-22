import { execFileSync } from "node:child_process";

// On macOS, /usr/bin/cc, /usr/bin/clang, and /usr/bin/gcc are xcode-select
// shims. On a machine that has never installed the Command Line Tools, invoking
// one does not fail: it pops a blocking system dialog asking to install the
// tools and hangs the calling process until the user answers. An install that
// compiles a native extension (a Python C extension under uv, a node-gyp addon
// under pnpm) reaches this shim and freezes the tool call behind the dialog.
//
// Everything the app ships installs from prebuilt wheels/binaries, so a source
// compile only happens for an unexpected/unsupported dependency. We point $CC
// and $CXX at a real no-op binary so that compile fails immediately with an
// ordinary error instead of prompting. Pure-Python and pure-JS builds never
// read $CC and are unaffected (e.g. openai-whisper's dist still builds).
const NOOP_COMPILER = "/usr/bin/false";

// Probed once per process. `xcode-select -p` prints the active developer
// directory and exits 0 when the tools are installed; it never shows the
// installer dialog (only the /usr/bin compiler shims do), so it is a safe probe.
let cachedHasCommandLineTools: boolean | undefined;

/**
 * Env overlay that neutralizes the host C/C++ compiler when it would launch the
 * macOS Command Line Tools installer dialog. Returns `{}` (no override) on
 * non-macOS hosts, when a toolchain is explicitly configured via `$CC`, or when
 * the Command Line Tools are already installed.
 */
export function hostCompilerEnv(): Record<string, string> {
  if (process.platform !== "darwin") {
    return {};
  }
  if (process.env.CC) {
    return {};
  }
  if (hasCommandLineTools()) {
    return {};
  }
  return { CC: NOOP_COMPILER, CXX: NOOP_COMPILER };
}

function hasCommandLineTools(): boolean {
  if (cachedHasCommandLineTools === undefined) {
    try {
      execFileSync("xcode-select", ["-p"], { stdio: "ignore" });
      cachedHasCommandLineTools = true;
    } catch {
      cachedHasCommandLineTools = false;
    }
  }
  return cachedHasCommandLineTools;
}
