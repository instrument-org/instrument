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
import { afterAll, describe, expect, it, vi } from "vitest";

import { restartCommand } from "./relaunch";

vi.mock("electron", () => ({ app: {} }));
vi.mock("./quit", () => ({ requestQuitApproval: vi.fn() }));

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
