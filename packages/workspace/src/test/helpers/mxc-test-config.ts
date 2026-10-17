import os from "node:os";
import path from "node:path";

import { AbsolutePathSchema } from "../../schemas/paths";

/**
 * Where a run held by MXC keeps the app's data: under `AppData\Roaming`, as
 * the app's own folder is, so the data folder is closed with the runtime
 * folder and the work folders inside it. Made per process, and removed with
 * the test setup's own folders.
 */
export function mxcTestDataDir(): string | undefined {
  return process.env.INSTRUMENT_TEST_MXC_EXEC
    ? path.join(
        process.env.APPDATA ?? os.tmpdir(),
        `instrument-mxc-test-${process.pid}`,
      )
    : undefined;
}

/**
 * On Windows, INSTRUMENT_TEST_MXC_EXEC names MXC's launcher so a suite runs
 * with native commands held by it (with INSTRUMENT_MXC=1 as well). The
 * sandbox keeps its verdict and requests in the runtime folder, which a mock
 * config puts at a path with no drive, so a run held by MXC gets a real one,
 * laid out as the app lays out its data folder.
 */
export function mxcTestConfig() {
  const exec = process.env.INSTRUMENT_TEST_MXC_EXEC;
  const data = mxcTestDataDir();
  if (!exec || !data) {
    return {};
  }
  const workspaceMachine = path.join(data, "workspaces-data", "test");
  return {
    machineDir: AbsolutePathSchema.parse(data),
    mxcExecPath: AbsolutePathSchema.parse(exec),
    runtimeDir: AbsolutePathSchema.parse(path.join(data, "runtime")),
    workFoldersDir: AbsolutePathSchema.parse(
      path.join(workspaceMachine, "work"),
    ),
    workspaceMachineDir: AbsolutePathSchema.parse(workspaceMachine),
  };
}
