import os from "node:os";
import path from "node:path";

import { AbsolutePathSchema } from "../../schemas/paths";
import { homeDataLayout } from "../../lib/workspace-layout";

/** The name a run held by MXC goes by in the folders it makes. */
function mxcTestName(): string {
  return `instrument-mxc-test-${process.pid}`;
}

/**
 * Where a run held by MXC keeps the app's data: under `AppData\Roaming`, as
 * the app's own folder is, so the data folder is closed with the runtime
 * folder inside it. Made per process, and removed with the test setup's own
 * folders.
 */
export function mxcTestDataDir(): string | undefined {
  return process.env.INSTRUMENT_TEST_MXC_EXEC
    ? path.join(process.env.APPDATA ?? os.tmpdir(), mxcTestName())
    : undefined;
}

/**
 * Where a run held by MXC makes its chats' work folders: its own folder in
 * `~/.instrument/work/`, as the app's are. Removed with the test setup's own
 * folders.
 */
export function mxcTestWorkFoldersDir(): string | undefined {
  return process.env.INSTRUMENT_TEST_MXC_EXEC
    ? path.join(homeDataLayout(os.homedir()).workDir, mxcTestName())
    : undefined;
}

/**
 * On Windows, INSTRUMENT_TEST_MXC_EXEC names MXC's launcher so a suite runs
 * with native commands held by it (unless INSTRUMENT_MXC=0). The
 * sandbox keeps its verdict and requests in the runtime folder, which a mock
 * config puts at a path with no drive, so a run held by MXC gets a real one,
 * laid out as the app lays out its data folder and its work folders.
 */
export function mxcTestConfig() {
  const exec = process.env.INSTRUMENT_TEST_MXC_EXEC;
  const data = mxcTestDataDir();
  const work = mxcTestWorkFoldersDir();
  if (!exec || !data || !work) {
    return {};
  }
  return {
    userDataDir: AbsolutePathSchema.parse(data),
    mxcExecPath: AbsolutePathSchema.parse(exec),
    runtimeDir: AbsolutePathSchema.parse(path.join(data, "runtime")),
    workFoldersDir: AbsolutePathSchema.parse(work),
    workspaceMachineDir: AbsolutePathSchema.parse(
      path.join(data, "machine", "test"),
    ),
  };
}
