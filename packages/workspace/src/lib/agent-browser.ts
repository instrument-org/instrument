import { APP_NAME_SLUG } from "@instrument-org/shared";
import { agentBrowserBinary } from "@instrument-org/shared/agent-browser-binary";
import ms from "ms";
import { createRequire } from "node:module";
import { arch, platform, tmpdir } from "node:os";
import path from "node:path";

import { unpackAsarPath } from "./asar";

// In dev, electron-vite bakes in agent-browser's absolute package folder since
// node_modules isn't alongside the output. In prod, it is null and we resolve
// at runtime via createRequire (node_modules is next to the bundle).
declare const __AGENT_BROWSER_DIR__: null | string;

const req = createRequire(import.meta.url);

// The platform package is one agent-browser depends on, so it is resolved from
// agent-browser's own folder: pnpm links it only there.
function resolveFromAgentBrowser(id: string) {
  const packageDir =
    __AGENT_BROWSER_DIR__ ??
    path.dirname(req.resolve("agent-browser/package.json"));
  return createRequire(path.join(packageDir, "package.json")).resolve(id);
}

/**
 * agent-browser's binary for a platform and architecture. `resolve` finds a
 * file of the one platform package that pair names, and is asked for no other.
 */
export function agentBrowserBinaryPath(
  platformName: string,
  archName: string,
  resolve: (id: string) => string,
) {
  const binary = agentBrowserBinary(platformName, archName);
  if (!binary) {
    throw new Error(
      `agent-browser has no build for ${platformName}-${archName}`,
    );
  }
  const manifest = resolve(`${binary.packageName}/package.json`);
  return path.join(path.dirname(manifest), binary.path);
}

let binaryPath: string | undefined;

/**
 * The binary this computer runs. It is found when a caller first runs the
 * program, so loading this module asks for no package: only the running
 * platform's is installed, and a module that loads this one may never run it.
 */
export function agentBrowserPath() {
  binaryPath ??= unpackAsarPath(
    agentBrowserBinaryPath(platform(), arch(), resolveFromAgentBrowser),
  );
  return binaryPath;
}

// Idle ms after which the agent-browser daemon self-terminates. The CLI counts
// this from the last command (each invocation re-arms the timer) and, on fire,
// closes the browser and drops the daemon's in-memory ref map. Snapshot refs
// (@eN) live only in that map, so if the daemon reaps in the gap between a
// `snapshot` and the `click @eN` that consumes its refs, the follow-up hits a
// fresh daemon with an empty map and fails "Unknown ref". This must therefore
// outlast an agent's think time between those two commands -- a slow model can
// exceed a minute -- while staying well under the workspace's own view reaper
// (AGENT_IDLE_TIMEOUT_MS, 1 hour). With the explicit `close --session` on view
// teardown as the primary reap, this is only a backstop; the view stays warm
// across a daemon restart, so only the ref map is lost.
//
// The CLI hashes this (with a few other daemon options) into a per-session
// fingerprint and restarts the running daemon whenever an invocation's
// fingerprint differs from the one that started it. Every invocation for a
// session must pass the same value, so this lives here rather than at a single
// call site: a `close` that omitted it would replace the daemon it was trying
// to stop, stranding the original.
export const AGENT_BROWSER_IDLE_TIMEOUT_MS = String(ms("5 minutes"));

/**
 * The folder every running app's socket folder is in.
 *
 * The literal "/tmp" (not os.tmpdir(), which expands to a long
 * /var/folders/... path on macOS) keeps a socket path under the 103-byte Unix
 * limit regardless of the user's home directory length. On Windows the daemon
 * listens on TCP and keeps only its pid, port and config files in the folder,
 * so no length limit applies and the folder goes in the temp directory.
 */
export const AGENT_BROWSER_SOCKET_ROOT = path.join(
  platform() === "win32" ? tmpdir() : "/tmp",
  `.${APP_NAME_SLUG}-browser`,
);

/**
 * The socket folder of the app process with this pid. A process's daemons are
 * all in its own folder, so whatever closes a whole folder of them
 * (`close --all` at quit, the launch sweep) reaches that process's daemons and
 * none of another app's running on the same machine. The folder's name says
 * whose it is: one whose pid is not running was left by a crash.
 */
export function agentBrowserSocketDir(pid: number) {
  return path.join(AGENT_BROWSER_SOCKET_ROOT, String(pid));
}

/**
 * This process's socket folder. Every CLI invocation for one of its sessions
 * names it, since the CLI looks for a session's daemon only there.
 */
export const AGENT_BROWSER_SOCKET_DIR = agentBrowserSocketDir(process.pid);

/** The daemon session a session's browser-free `read` runs under. */
export function readSessionName(sessionId: string) {
  return `${sessionId}-read`;
}
