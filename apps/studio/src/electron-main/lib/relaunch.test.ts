import { execFile, spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { relaunchApp, restartCommand } from "./relaunch";

const app = vi.hoisted(() => ({ isPackaged: true, quit: vi.fn() }));
vi.mock("electron", () => ({ app }));
vi.mock("./quit", () => ({ requestQuitApproval: vi.fn(async () => true) }));
const deferInstallOnQuit = vi.hoisted(() => vi.fn());
vi.mock("./update", () => ({ deferInstallOnQuit }));

// The restart's own shell must not start during a test; the programs a test
// runs itself go through.
const startsRestart = vi.hoisted(() => ({ value: false }));
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>) =>
      startsRestart.value ? { unref: vi.fn() } : actual.spawn(...args),
  };
});

describe("relaunchApp on Linux", () => {
  const platform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: platform });
    vi.unstubAllEnvs();
    startsRestart.value = false;
    vi.clearAllMocks();
  });

  it.each([
    ["an AppImage", "/home/me/Instrument.AppImage", 1],
    ["a package", undefined, 0],
  ])(
    "leaves a staged update for a later quit only for %s",
    async (_build, appImage, deferred) => {
      Object.defineProperty(process, "platform", { value: "linux" });
      vi.stubEnv("APPIMAGE", appImage);
      startsRestart.value = true;
      await expect(relaunchApp({ beforeRestart: vi.fn() })).resolves.toBe(
        "relaunching",
      );
      expect(deferInstallOnQuit).toHaveBeenCalledTimes(deferred);
      expect(app.quit).toHaveBeenCalledOnce();
    },
  );
});

describe.skipIf(process.platform === "win32")("restartCommand", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "relaunch-"));
  const planted = path.join(dir, "planted");
  // A `sleep` first on PATH, as a program could leave in the runtime
  // folder's bin/ where nothing holds it.
  writeFileSync(
    path.join(dir, "sleep"),
    `#!/bin/sh\ntouch '${planted}'\nexec /bin/sleep "$@"\n`,
  );
  chmodSync(path.join(dir, "sleep"), 0o755);

  afterAll(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  it.each([
    ["bash", true],
    ["sh", false],
  ])(
    "waits under %s with the system's sleep, then starts the app",
    async (_shell, bash) => {
      const running = spawn("/bin/sleep", ["0.3"]);
      const exited = new Promise((resolve) => running.once("exit", resolve));
      const { args, file } = restartCommand({
        argv: ["started", "again"],
        bash,
        executable: "/bin/echo",
        pid: running.pid ?? 0,
      });
      const restarted = await promisify(execFile)(file, args, {
        env: { PATH: `${dir}:${process.env.PATH ?? ""}` },
      });
      await exited;
      expect(restarted.stdout).toBe("started again\n");
      expect(existsSync(planted)).toBe(false);
    },
  );
});
