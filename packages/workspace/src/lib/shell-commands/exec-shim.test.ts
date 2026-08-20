import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as setTimeoutPromise } from "node:timers/promises";
import { describe, expect, it } from "vitest";

import { execShim, shimOutput } from "./exec-shim";
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

describe("shimOutput", () => {
  it("substitutes a diagnostic when the cwd does not exist", async () => {
    const result = await execShim(process.execPath, ["-e", ""], {
      cwd: "/no/such/directory",
    });

    expect(result.all).toBe("");
    expect(result.exitCode).toBeUndefined();

    const output = shimOutput(result, "node");
    expect(output).toContain("node could not start.");
    expect(output).toContain("/no/such/directory");
  });

  // execa opens shortMessage with the resolved binary path, which for the
  // bundled git and ffmpeg is a real path inside the installed app bundle that
  // no other sandbox output would ever show.
  it("never leaks the resolved binary path", async () => {
    const result = await execShim(process.execPath, ["-e", ""], {
      cwd: "/no/such/directory",
    });

    const output = shimOutput(result, "node");
    expect(output).not.toContain(process.execPath);
    expect(output).not.toContain("Command failed with");
  });

  it("substitutes a diagnostic when the binary is missing", async () => {
    const result = await execShim("instrument-no-such-binary", [], {});

    expect(shimOutput(result, "nope")).toContain("ENOENT");
  });

  // rg reports no matches this way, and git diff --quiet reports a difference
  // this way. Both are answers, not failures, so neither may grow a diagnostic.
  it("leaves empty output alone when the process ran and exited non-zero", async () => {
    const result = await runNode("process.exit(1)");

    expect(result.exitCode).toBe(1);
    expect(shimOutput(result, "rg")).toBe("");
  });

  it("passes successful output through unchanged", async () => {
    const result = await runNode("console.log('ok')");

    expect(shimOutput(result, "node")).toBe("ok\n");
  });
});

function processExists(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
