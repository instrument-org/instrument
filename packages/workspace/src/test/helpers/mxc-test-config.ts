import os from "node:os";
import path from "node:path";

import { AbsolutePathSchema } from "../../schemas/paths";

/**
 * On Windows, INSTRUMENT_TEST_MXC_EXEC names MXC's launcher so a suite runs
 * with native commands held by it (with INSTRUMENT_MXC=1 as well). The
 * sandbox keeps its verdict and requests beside uv's data, which a mock
 * config puts at a path with no drive, so a run held by MXC gets a real one.
 */
export function mxcTestConfig() {
  const exec = process.env.INSTRUMENT_TEST_MXC_EXEC;
  return exec
    ? {
        mxcExecPath: AbsolutePathSchema.parse(exec),
        uvDataDir: AbsolutePathSchema.parse(
          path.join(os.tmpdir(), `instrument-mxc-test-${process.pid}`, "uv"),
        ),
      }
    : {};
}
