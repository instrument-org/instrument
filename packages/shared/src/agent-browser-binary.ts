/**
 * Where agent-browser's native binary is for a platform and architecture: the
 * per-platform package it publishes as an optional dependency (installed only
 * where its `os`, `cpu` and `libc` match) and the program's path inside it.
 * The runtime resolver and the packaging check both read this, so the binary
 * a build ships is the one the app looks for.
 *
 * Linux takes the glibc build, since Electron itself needs glibc. Windows on
 * Arm runs the x64 build under emulation, as agent-browser publishes no Arm
 * build for it.
 */
export function agentBrowserBinary(
  platform: string,
  arch: string,
): undefined | { packageName: string; path: string } {
  if (arch !== "arm64" && arch !== "x64") {
    return;
  }
  switch (platform) {
    case "darwin": {
      return {
        packageName: `@agent-browser/cli-darwin-${arch}`,
        path: "bin/agent-browser",
      };
    }
    case "linux": {
      return {
        packageName: `@agent-browser/cli-linux-${arch}-gnu`,
        path: "bin/agent-browser",
      };
    }
    case "win32": {
      return {
        packageName: "@agent-browser/cli-win32-x64-msvc",
        path: "bin/agent-browser.exe",
      };
    }
    default: {
      return;
    }
  }
}
