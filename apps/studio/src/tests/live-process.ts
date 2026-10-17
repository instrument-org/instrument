import { type ChildProcess, spawn } from "node:child_process";

/**
 * A live process running this program, for a test that needs the pid of a
 * process holding something open.
 *
 * `process.ppid` does not stand in for one. An open mark counts a pid only
 * while the process at it runs this app's program, by the name of its
 * executable, and the parent of a test run is whatever started it: a shell,
 * pnpm, or turbo under the full gate, none of which share this program's
 * name. A test that marks its parent pid therefore passes when run one way
 * and fails when run another.
 */
export function startLiveProcess(): { pid: number; stop: () => void } {
  const child: ChildProcess = spawn(
    process.execPath,
    ["-e", "setTimeout(() => {}, 30_000)"],
    { stdio: "ignore" },
  );
  const { pid } = child;
  if (pid === undefined) {
    throw new Error("could not start a stand-in process");
  }
  return {
    pid,
    stop: () => {
      child.kill();
    },
  };
}
