import os from "node:os";
import path from "node:path";
import { threadId } from "node:worker_threads";

/**
 * Where the mock workspace and its machine folder go: one folder for each
 * process and thread, which runs one test file at a time, so nothing a file
 * grants or writes is there for the next file or the next run. The test
 * setup removes it after each file.
 */
export const MOCK_WORKSPACE_ROOT = path.join(
  os.tmpdir(),
  `instrument-mock-workspace-${process.pid.toString()}-${threadId.toString()}`,
);
