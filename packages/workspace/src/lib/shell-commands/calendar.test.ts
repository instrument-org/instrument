import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AbsolutePathSchema } from "../../schemas/paths";
import { TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfig } from "../../test/helpers/mock-task-config";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { createCalendarCommand } from "./calendar";

vi.mock("execa");

const ctx = createCommandContext({
  cwd: "/task",
  env: new Map<string, string>(),
  fs: new InMemoryFs(),
  stdin: EMPTY_BYTES,
});

describe("calendar", () => {
  const taskId = createMockTaskConfig(TaskIdSchema.parse("calendar-test"));
  const config = getWorkspaceConfig();

  afterEach(() => {
    setWorkspaceConfig(config);
    vi.resetAllMocks();
  });

  it("runs the bundled helper with the arguments as given", async () => {
    setWorkspaceConfig({
      ...config,
      eventKitBinPath: AbsolutePathSchema.parse("/app/bin/instrument-eventkit"),
    });
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({ all: "[]", exitCode: 0 } as never);

    const result = await createCalendarCommand(taskId).execute(
      ["events", "--from", "tomorrow"],
      ctx,
    );

    expect(result.exitCode).toBe(0);
    expect(vi.mocked(execa)).toHaveBeenCalledWith(
      "/app/bin/instrument-eventkit",
      ["events", "--from", "tomorrow"],
      expect.objectContaining({ stdin: "ignore" }),
    );
  });

  it("points at osascript in a build without the helper", async () => {
    const { eventKitBinPath: _absent, ...without } = config;
    setWorkspaceConfig(without);

    const result = await createCalendarCommand(taskId).execute(["events"], ctx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("use osascript");
  });
});
