import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as setTimeoutPromise } from "node:timers/promises";
import { describe, expect, it } from "vitest";

import {
  execShim,
  mapStreams,
  openRefusalNote,
  selfSandboxNote,
  setuidRefusalNote,
  shimOutput,
  signalRefusalNote,
} from "./exec-shim";
import { withShellOutputSink } from "./output-sink";

const runNode = (code: string) => execShim(process.execPath, ["-e", code], {});

describe("execShim", () => {
  // execa strips a trailing newline by default. The interpreter concatenates
  // each command's output into one buffer, so losing it silently runs one
  // command's last line into the next command's first.
  it("keeps the trailing newline", async () => {
    const result = await runNode("console.log('a')");
    expect(result.stdout).toBe("a\n");
  });

  it("keeps every trailing newline, not just the last", async () => {
    const result = await runNode("process.stdout.write('a\\n\\n\\n')");
    expect(result.stdout).toBe("a\n\n\n");
  });

  // The whole point of the split: a redirection can only mean what it says if
  // the two streams arrive apart. Merged, `cmd > file` buries the diagnostic in
  // the file and `2>/dev/null` has nothing to silence.
  it("keeps stderr out of stdout", async () => {
    const result = await runNode(
      "process.stdout.write('out\\n'); process.stderr.write('err\\n')",
    );
    expect(result.stdout).toBe("out\n");
    expect(result.stderr).toBe("err\n");
  });

  // A sink reads a tee of the merged stream rather than taking the stream over,
  // so a watched command is still buffered and still reports its streams apart.
  // Reading the same stream execa is consuming would have forced a choice
  // between the live view and the redirection.
  it("feeds a sink the merged stream and still returns the split ones", async () => {
    const seen: string[] = [];
    const result = await withShellOutputSink(
      (text) => {
        seen.push(text);
      },
      () =>
        execShim(
          process.execPath,
          [
            "-e",
            "process.stdout.write('out\\n');process.stderr.write('err\\n')",
          ],
          {},
        ),
    );

    expect(result.stdout).toBe("out\n");
    expect(result.stderr).toBe("err\n");
    expect(seen.join("")).toContain("out\n");
    expect(seen.join("")).toContain("err\n");
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

describe("signalRefusalNote", () => {
  it.each([
    ["/bin/kill", "kill: 611: Operation not permitted", true],
    [
      "/usr/bin/pkill",
      "pkill: signaling pid 611: Operation not permitted",
      true,
    ],
    [
      "/usr/bin/killall",
      "killall: warning: kill -term 611: Operation not permitted",
      true,
    ],
    ["/bin/kill", "kill: 611: bad argument", false],
    ["/bin/cat", "cat: x: Operation not permitted", false],
  ])("%s with %s", (file, stderr, noted) => {
    expect(signalRefusalNote(file, stderr) !== undefined).toBe(noted);
  });

  it("says where the agent's own processes are stopped", () => {
    expect(
      signalRefusalNote("/usr/bin/pkill", "Operation not permitted"),
    ).toMatchInlineSnapshot(
      `"pkill reaches only processes started in this same command. Stop one you started earlier with the shell's \`kill <pid>\` or \`kill bg_1\`; any other process belongs to the person."`,
    );
  });
});

describe.runIf(process.platform === "darwin")("selfSandboxNote", () => {
  it.each([
    [
      "/usr/bin/qlmanage",
      "sandbox initialization failed: Operation not permitted",
      true,
    ],
    ["/usr/bin/log", "log: Cannot run while sandboxed", true],
    [
      "/usr/bin/python3",
      "sandbox initialization failed: Operation not permitted",
      true,
    ],
    ["/bin/cat", "cat: x: Operation not permitted", false],
  ])("%s with %s", (file, output, noted) => {
    expect(selfSandboxNote(file, output) !== undefined).toBe(noted);
  });

  it("says the program can't run here and to use another", () => {
    expect(
      selfSandboxNote("/usr/bin/log", "log: Cannot run while sandboxed"),
    ).toMatchInlineSnapshot(
      `"\`log\` (or a program it started) can't run here: it won't run inside another sandbox, and every command here runs in one, so trying again or asking the person won't help. Use another program for the same work."`,
    );
  });
});

describe.runIf(process.platform === "darwin")("openRefusalNote", () => {
  it.each([
    [
      "/usr/bin/open",
      "_LSOpenURLsWithCompletionHandler() failed with error -54 for the file /tmp/a.txt.",
      true,
    ],
    ["/usr/bin/open", "The file /tmp/b.txt does not exist.", false],
    ["/bin/cat", "_LSOpenURLsWithCompletionHandler() failed", false],
  ])("%s with %s", (file, output, noted) => {
    expect(openRefusalNote(file, output) !== undefined).toBe(noted);
  });

  it("points at the chat's tabs", () => {
    expect(
      openRefusalNote(
        "/usr/bin/open",
        "_LSOpenURLsWithCompletionHandler() failed with error -54",
      ),
    ).toMatchInlineSnapshot(
      `"\`open\` can't start apps from here. To show the person a file, folder or page, use \`instrument tab open <path or url>\`."`,
    );
  });
});

describe.runIf(process.platform === "linux")("Linux refusal notes", () => {
  it.each([
    [
      "/usr/bin/bwrap",
      "bwrap: No permissions to create a new namespace, likely because the kernel does not allow non-privileged user namespaces.",
      true,
    ],
    [
      "/usr/bin/snap",
      "snap-confine has elevated permissions and is not confined but should be. Refusing to continue to avoid permission escalation attacks",
      true,
    ],
    ["/bin/cat", "cat: x: Operation not permitted", false],
  ])("selfSandboxNote: %s with %s", (file, output, noted) => {
    expect(selfSandboxNote(file, output) !== undefined).toBe(noted);
  });

  it.each([
    ["/usr/bin/xdg-open", true],
    ["/usr/bin/open", false],
  ])("openRefusalNote: %s", (file, noted) => {
    expect(
      openRefusalNote(
        file,
        "/usr/bin/xdg-open: 882: www-browser: not found",
      ) !== undefined,
    ).toBe(noted);
  });
});

describe.runIf(process.platform === "darwin")("setuidRefusalNote", () => {
  it("says a program can't start ps, and that the shell can", () => {
    expect(
      setuidRefusalNote(
        "/bin/ps",
        "instrument-seatbelt: /bin/ps: Operation not permitted",
      ),
    ).toMatchInlineSnapshot(
      `"\`ps\` can't run here: it runs as another user, which the sandbox refuses. Run \`ps\` as a shell command of its own (\`ps aux | grep node\`), where it lists every process; a program or script can't start it."`,
    );
  });

  it("leaves a program that runs as its caller to the path refusal", () => {
    expect(
      setuidRefusalNote(
        "/bin/cat",
        "instrument-seatbelt: /bin/cat: Operation not permitted",
      ),
    ).toBeUndefined();
  });
});

describe("shimOutput", () => {
  it("substitutes a diagnostic when the cwd does not exist", async () => {
    const result = await execShim(process.execPath, ["-e", ""], {
      cwd: "/no/such/directory",
    });

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBeUndefined();

    const output = shimOutput(result, "node");
    expect(output.stderr).toContain("node could not start.");
    expect(output.stderr).toContain(path.resolve("/no/such/directory"));
    expect(output.stdout).toBe("");
  });

  // execa opens shortMessage with the resolved binary path, which for the
  // bundled git and ffmpeg is a real path inside the installed app bundle that
  // no other sandbox output would ever show.
  it("never leaks the resolved binary path", async () => {
    const result = await execShim(process.execPath, ["-e", ""], {
      cwd: "/no/such/directory",
    });

    const output = shimOutput(result, "node");
    expect(output.stderr).not.toContain(process.execPath);
    expect(output.stderr).not.toContain("Command failed with");
  });

  it("substitutes a diagnostic when the binary is missing", async () => {
    const result = await execShim("instrument-no-such-binary", [], {});

    // On Windows execa runs a command it finds nowhere through cmd.exe,
    // which says so itself.
    expect(shimOutput(result, "nope").stderr).toMatch(
      process.platform === "win32" ? /is not recognized/ : /ENOENT/,
    );
  });

  // rg reports no matches this way, and git diff --quiet reports a difference
  // this way. Both are answers, not failures, so neither may grow a diagnostic.
  it("leaves empty output alone when the process ran and exited non-zero", async () => {
    const result = await runNode("process.exit(1)");

    expect(result.exitCode).toBe(1);
    expect(shimOutput(result, "rg")).toEqual({ stderr: "", stdout: "" });
  });

  it("passes successful output through unchanged", async () => {
    const result = await runNode("console.log('ok')");

    expect(shimOutput(result, "node")).toEqual({ stderr: "", stdout: "ok\n" });
  });

  // A process that wrote only to stderr and then failed to report an exit code
  // still has something to say, so the diagnostic must not displace it.
  it("keeps real stderr rather than substituting a diagnostic", () => {
    const output = shimOutput(
      { exitCode: undefined, stderr: "real trouble\n", stdout: "" },
      "node",
    );

    expect(output.stderr).toBe("real trouble\n");
  });
});

describe("mapStreams", () => {
  it("applies the transform to both streams", () => {
    expect(
      mapStreams({ stderr: "b", stdout: "a" }, (text) => text.toUpperCase()),
    ).toEqual({ stderr: "B", stdout: "A" });
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
