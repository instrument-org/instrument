import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as setTimeoutPromise } from "node:timers/promises";
import { describe, expect, it } from "vitest";

import { execShim } from "./exec-shim";
import { withShellOutputSink } from "./output-sink";

const runNode = (code: string) => execShim(process.execPath, ["-e", code], {});

describe("execShim", () => {
  // execa strips a trailing newline by default. The interpreter concatenates
  // each command's output into one buffer, so losing it silently runs one
  // command's last line into the next command's first.
  it("keeps the trailing newline", async () => {
    const result = await runNode("console.log('a')");
    expect(result.all).toBe("a\n");
  });

  it("keeps every trailing newline, not just the last", async () => {
    const result = await runNode("process.stdout.write('a\\n\\n\\n')");
    expect(result.all).toBe("a\n\n\n");
  });

  it("merges stderr into the returned output", async () => {
    const result = await runNode(
      "process.stdout.write('out\\n'); process.stderr.write('err\\n')",
    );
    expect(result.all).toContain("out");
    expect(result.all).toContain("err");
  });

  it("reports a non-zero exit as a code rather than throwing", async () => {
    const result = await runNode("process.exit(3)");
    expect(result.exitCode).toBe(3);
  });

  it.runIf(process.platform !== "win32")(
    "stops descendants when a streamed command is cancelled",
    async () => {
      const testDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "exec-shim-tree-"),
      );
      const pidFile = path.join(testDir, "child.pid");
      const controller = new AbortController();
      let childPid: number | undefined;

      try {
        const running = withShellOutputSink(
          () => {
            return;
          },
          () =>
            execShim(
              process.execPath,
              [
                "-e",
                [
                  "const { spawn } = require('node:child_process');",
                  "const fs = require('node:fs');",
                  "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
                  `fs.writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));`,
                  "setInterval(() => {}, 1000);",
                ].join(""),
              ],
              { cancelSignal: controller.signal },
            ),
        );

        for (let attempt = 0; attempt < 100; attempt++) {
          const value = await fs.readFile(pidFile, "utf8").catch(() => "");
          if (value) {
            childPid = Number(value);
            break;
          }
          await setTimeoutPromise(20);
        }
        expect(childPid).toBeTypeOf("number");

        controller.abort();
        await running;

        expect(childPid === undefined || !processExists(childPid)).toBe(true);
      } finally {
        if (childPid !== undefined && processExists(childPid)) {
          process.kill(childPid, "SIGKILL");
        }
        await fs.rm(testDir, { force: true, recursive: true });
      }
    },
  );
});

function processExists(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
