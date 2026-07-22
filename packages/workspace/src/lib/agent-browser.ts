import { APP_NAME_SLUG } from "@instrument-org/shared";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { arch, platform } from "node:os";
import path from "node:path";

import { unpackAsarPath } from "./asar";

// In dev, electron-vite bakes in the absolute resolved bin/ directory since
// node_modules isn't alongside the output. In prod, it is null and we resolve
// at runtime via createRequire (node_modules is next to the bundle).
declare const __AGENT_BROWSER_BIN_DIR__: null | string;

const req = createRequire(import.meta.url);

// Via agent-browser/bin/agent-browser.js wrapper
function getBinaryName() {
  const userPlatform = platform();
  const cpuArch = arch();

  let osKey: string;
  switch (userPlatform) {
    case "darwin": {
      osKey = "darwin";
      break;
    }
    case "linux": {
      osKey = isMusl() ? "linux-musl" : "linux";
      break;
    }
    case "win32": {
      osKey = "win32";
      break;
    }
    default: {
      throw new Error(`Unsupported platform: ${userPlatform}`);
    }
  }

  let archKey: string;
  switch (cpuArch) {
    case "arm64": {
      archKey = userPlatform === "win32" ? "x64" : "arm64";
      break;
    }
    case "x64": {
      archKey = "x64";
      break;
    }
    default: {
      throw new Error(`Unsupported architecture: ${cpuArch}`);
    }
  }

  const ext = userPlatform === "win32" ? ".exe" : "";
  return `agent-browser-${osKey}-${archKey}${ext}`;
}

function isMusl() {
  if (platform() !== "linux") {
    return false;
  }
  try {
    const result = execSync("ldd --version 2>&1 || true", {
      encoding: "utf8",
    });
    return result.toLowerCase().includes("musl");
  } catch {
    return (
      existsSync("/lib/ld-musl-x86_64.so.1") ||
      existsSync("/lib/ld-musl-aarch64.so.1")
    );
  }
}

const binDir =
  __AGENT_BROWSER_BIN_DIR__ ??
  path.dirname(req.resolve("agent-browser/bin/agent-browser.js"));

export const AGENT_BROWSER_PATH = unpackAsarPath(
  path.join(binDir, getBinaryName()),
);

// Idle ms after which the agent-browser daemon self-terminates. Tuned to
// outlast a single agent-loop tool-call gap (a few seconds) but reap soon
// after the agent moves on. The view itself stays warm; only the daemon dies.
//
// The CLI hashes this (with a few other daemon options) into a per-session
// fingerprint and restarts the running daemon whenever an invocation's
// fingerprint differs from the one that started it. Every invocation for a
// session must pass the same value, so this lives here rather than at a single
// call site: a `close` that omitted it would replace the daemon it was trying
// to stop, stranding the original.
export const AGENT_BROWSER_IDLE_TIMEOUT_MS = "30000";

// Use the literal "/tmp" (not os.tmpdir() which expands to a long
// /var/folders/... path on macOS) so the socket path stays under the
// 103-byte Unix limit regardless of the user's home directory length.
// On Windows the daemon uses TCP, not Unix sockets, so there is no path
// length constraint - leave the env var unset and let the library use its
// own default.
export const AGENT_BROWSER_SOCKET_DIR =
  platform() === "win32"
    ? undefined
    : path.join("/tmp", `.${APP_NAME_SLUG}-browser`);
