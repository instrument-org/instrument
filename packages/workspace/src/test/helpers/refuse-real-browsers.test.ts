import { execFile, execFileSync, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { execa } from "execa";
import { describe, expect, it } from "vitest";

import { agentBrowserPath } from "../../lib/agent-browser";
import { browserLaunchedBy } from "./refuse-real-browsers";

describe("the test setup's guard on real browsers", () => {
  it("refuses the installed agent-browser, however it is started", async () => {
    expect(() => execFileSync(agentBrowserPath(), ["--version"])).toThrow(
      "opens a real browser",
    );
    expect(() =>
      spawnSync("/usr/bin/sandbox-exec", ["-p", "()", agentBrowserPath()]),
    ).toThrow("opens a real browser");
    await expect(execa(agentBrowserPath(), ["--version"])).rejects.toThrow(
      "opens a real browser",
    );
  });

  it.each([
    ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", []],
    [
      "/bin/sh",
      [
        "-c",
        "~/Library/Caches/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell --headless",
      ],
    ],
    [
      "C:/repo/node_modules/@agent-browser/cli-win32-x64-msvc/bin/agent-browser.exe",
      ["open"],
    ],
  ])("names %s %j as a browser", (file, args) => {
    expect(browserLaunchedBy(file, args)).toBeDefined();
  });

  it.each([
    ["/bin/sh", ["-c", "echo agent-browser-guide.ts"]],
    ["node", ["scripts/agent-browser-wait.ts"]],
    ["rg", ["agent-browser", "src"]],
    ["/tmp/workspace/runtime/bin/agent-browser", ["open"]],
  ])("lets %s %j run", (file, args) => {
    expect(browserLaunchedBy(file, args)).toBeUndefined();
  });

  it("keeps the promisified form of execFile, which resolves to its output", async () => {
    const { stdout } = await promisify(execFile)("/bin/echo", ["ok"]);
    expect(stdout).toBe("ok\n");
    expect(() =>
      promisify(execFile)(agentBrowserPath(), ["--version"]),
    ).toThrow("opens a real browser");
  });

  it("still starts other programs", () => {
    expect(execFileSync("/bin/echo", ["ok"], { encoding: "utf8" })).toBe(
      "ok\n",
    );
  });
});
