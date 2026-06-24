import path from "node:path";
import { describe, expect, it } from "vitest";

import { TaskIdSchema } from "../schemas/task-id";
import { createMockTaskConfig } from "../test/helpers/mock-task-config";
import { taskVenvDir, taskVenvPython, uvSubprocessEnv } from "./uv";

const isWindows = process.platform === "win32";
const taskId = createMockTaskConfig(TaskIdSchema.parse("test"));

describe("taskVenvDir", () => {
  it("resolves to work/.venv under the task dir", () => {
    expect(taskVenvDir(taskId).replaceAll("\\", "/")).toBe(
      "/tmp/workspace/tasks/test/work/.venv",
    );
  });
});

describe("taskVenvPython", () => {
  it("points at the venv interpreter for the platform layout", () => {
    const expected = isWindows
      ? "tasks/test/work/.venv/Scripts/python.exe"
      : "tasks/test/work/.venv/bin/python";
    expect(taskVenvPython(taskId).replaceAll("\\", "/")).toContain(expected);
  });
});

describe("uvSubprocessEnv", () => {
  const env = uvSubprocessEnv({ taskId });

  it("isolates uv's cache/python/tool dirs under uvDataDir", () => {
    expect(env.UV_CACHE_DIR).toBe(path.join("/tmp/workspace/uv-data", "cache"));
    expect(env.UV_PYTHON_INSTALL_DIR).toBe(
      path.join("/tmp/workspace/uv-data", "python"),
    );
    expect(env.UV_TOOL_DIR).toBe(path.join("/tmp/workspace/uv-data", "tools"));
  });

  it("pins uv to managed Python and ignores host config", () => {
    expect(env.UV_NO_CONFIG).toBe("1");
    expect(env.UV_PYTHON_PREFERENCE).toBe("only-managed");
    expect(env.UV_PYTHON_DOWNLOADS).toBe("automatic");
  });

  it("points VIRTUAL_ENV at the task venv", () => {
    expect(env.VIRTUAL_ENV).toBe(taskVenvDir(taskId));
  });

  it("prepends the uv binary dir and venv bin dir to PATH", () => {
    const dirs = (env.PATH ?? "").split(path.delimiter);
    expect(dirs[0]).toBe(path.dirname("/tmp/uv"));
    expect(dirs[1]).toContain(path.join("work", ".venv"));
  });
});
