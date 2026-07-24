import os from "node:os";
import path from "node:path";

import { createStubWorkspaceConfig } from "../../scripts/lib/stub-workspace-config";
import { setWorkspaceConfig } from "../lib/workspace-config";

// Install a workspace config for every test, the way the workspace machine does
// at boot in production. Without it, code that reads getWorkspaceConfig() would
// need an "if initialized" escape hatch just to survive tests. Tests that need
// specific paths override it (createMockTaskConfig).
setWorkspaceConfig(
  createStubWorkspaceConfig({
    tasksDir: path.join(os.tmpdir(), "instrument-workspace-test", "tasks"),
  }),
);
