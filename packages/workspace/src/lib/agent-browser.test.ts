import { APP_NAME_SLUG } from "@instrument-org/shared";
import { platform, tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { StoreId } from "../schemas/store-id";
import {
  AGENT_BROWSER_SOCKET_DIR,
  AGENT_BROWSER_SOCKET_ROOT,
  agentBrowserBinaryPath,
  agentBrowserPath,
  agentBrowserSocketDir,
  readSessionName,
} from "./agent-browser";

const isWindows = platform() === "win32";

describe("the agent-browser socket folder", () => {
  it("is this process's own, named for its pid", () => {
    expect(AGENT_BROWSER_SOCKET_DIR).toBe(
      path.join(AGENT_BROWSER_SOCKET_ROOT, String(process.pid)),
    );
  });

  it("differs between two app processes", () => {
    expect(agentBrowserSocketDir(4101)).not.toBe(agentBrowserSocketDir(4102));
    expect(path.dirname(agentBrowserSocketDir(4101))).toBe(
      AGENT_BROWSER_SOCKET_ROOT,
    );
  });

  it.runIf(isWindows)("is in the temp directory on Windows", () => {
    expect(AGENT_BROWSER_SOCKET_ROOT).toBe(
      path.join(tmpdir(), `.${APP_NAME_SLUG}-browser`),
    );
  });

  // The unix socket path limit is 103 bytes on macOS and 107 on Linux, so the
  // folders are in /tmp rather than `os.tmpdir()`, which on macOS is a long
  // per-user path.
  it.skipIf(isWindows)(
    "is in /tmp and keeps a session's longest socket path under the 103-byte limit",
    () => {
      expect(AGENT_BROWSER_SOCKET_ROOT).toBe(
        path.join("/tmp", `.${APP_NAME_SLUG}-browser`),
      );
      // Linux's largest pid, the longest a folder's name gets.
      const socketPath = path.join(
        agentBrowserSocketDir(4_194_304),
        `${readSessionName(StoreId.newSessionId())}.sock`,
      );
      expect(Buffer.byteLength(socketPath)).toBeLessThanOrEqual(103);
    },
  );
});

describe("agentBrowserBinaryPath", () => {
  // Only the running platform's package is installed, so asking for any
  // other one throws wherever this runs.
  it.each([
    ["darwin", "arm64", "@agent-browser/cli-darwin-arm64", "agent-browser"],
    ["darwin", "x64", "@agent-browser/cli-darwin-x64", "agent-browser"],
    ["linux", "arm64", "@agent-browser/cli-linux-arm64-gnu", "agent-browser"],
    ["linux", "x64", "@agent-browser/cli-linux-x64-gnu", "agent-browser"],
    [
      "win32",
      "arm64",
      "@agent-browser/cli-win32-x64-msvc",
      "agent-browser.exe",
    ],
    ["win32", "x64", "@agent-browser/cli-win32-x64-msvc", "agent-browser.exe"],
  ])(
    "asks only for the %s-%s package",
    (platformName, archName, packageName, program) => {
      const asked: string[] = [];
      const binary = agentBrowserBinaryPath(platformName, archName, (id) => {
        asked.push(id);
        return path.join("/packages", id);
      });
      expect(asked).toEqual([`${packageName}/package.json`]);
      expect(binary).toBe(path.join("/packages", packageName, "bin", program));
    },
  );

  it("names the platform it has no build for", () => {
    expect(() =>
      agentBrowserBinaryPath("freebsd", "x64", () => {
        throw new Error("asked for a package");
      }),
    ).toThrow("agent-browser has no build for freebsd-x64");
  });
});

describe("agentBrowserPath", () => {
  it("is the installed binary for this computer", () => {
    expect(path.basename(agentBrowserPath())).toBe(
      isWindows ? "agent-browser.exe" : "agent-browser",
    );
  });

  // A test that builds another platform's menus or paths loads this module
  // under that platform's name, where the package it names is not installed.
  it("asks for no package while the module loads", async () => {
    const real = process.platform;
    Object.defineProperty(process, "platform", {
      value: real === "darwin" ? "linux" : "darwin",
    });
    vi.resetModules();
    try {
      await expect(import("./agent-browser")).resolves.toBeDefined();
    } finally {
      Object.defineProperty(process, "platform", { value: real });
    }
  });
});
