import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Blocks this thread, which a test holding a mark cannot do by awaiting. */
function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** The name the system gives the program a process runs, as the app reads it. */
function programOf(pid: number): string | undefined {
  try {
    switch (process.platform) {
      case "linux":
        return fs.readFileSync(`/proc/${pid.toString()}/comm`, "utf8").trim();
      case "win32":
        return undefined;
      default:
        return path
          .basename(
            execFileSync("ps", ["-p", pid.toString(), "-o", "comm="], {
              encoding: "utf8",
            }),
          )
          .trim();
    }
  } catch {
    return undefined;
  }
}

/**
 * A live process running this program, for a test that needs the pid of a
 * process holding something open.
 *
 * `process.ppid` does not stand in for one. An open mark counts a pid only
 * while the process at it runs this app's program, by the name of its
 * executable, and the parent of a test run is whatever started it: node when
 * a file is run on its own, turbo under the full gate. So a test that marks
 * its parent pid passes when run one way and fails when run another.
 *
 * The process has run before this returns, since until it has, the system can
 * still answer for the one that spawned it. Where the name the system gives
 * it is not this program's, that is said here rather than left to look like
 * the mark being ignored.
 */
export function startLiveProcess(): { pid: number; stop: () => void } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "live-process-"));
  const running = path.join(home, "running");
  const child = spawn(
    process.execPath,
    [
      "-e",
      `require("node:fs").writeFileSync(${JSON.stringify(running)}, "");
       setTimeout(() => {}, 30_000);`,
    ],
    { stdio: "ignore" },
  );
  const stop = () => {
    child.kill();
    fs.rmSync(home, { force: true, recursive: true });
  };
  const { pid } = child;
  if (pid === undefined) {
    stop();
    throw new Error("could not start a stand-in process");
  }
  const until = Date.now() + 10_000;
  while (!fs.existsSync(running)) {
    if (Date.now() > until) {
      stop();
      throw new Error("a stand-in process was started and never ran");
    }
    pause(10);
  }
  const program = programOf(pid);
  const own = path.basename(process.execPath);
  // The kernel keeps a process's name to its first 15 bytes on Linux, as the
  // app's own check allows for.
  const expected =
    process.platform === "linux"
      ? Buffer.from(own).subarray(0, 15).toString()
      : own;
  if (program !== undefined && program !== expected) {
    stop();
    throw new Error(
      `a stand-in process at ${pid.toString()} runs ${program}, which is not this program (${own}), so a mark naming it would not count`,
    );
  }
  return { pid, stop };
}
