import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AbsolutePathSchema } from "../../schemas/paths";
import { TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfig } from "../../test/helpers/mock-task-config";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import {
  CALENDAR_COMMAND,
  CONTACTS_COMMAND,
  createMacHelperCommand,
} from "./mac-helper";

vi.mock("execa");

const ctx = createCommandContext({
  cwd: "/task",
  env: new Map<string, string>(),
  fs: new InMemoryFs(),
  stdin: EMPTY_BYTES,
});

describe("mac helper commands", () => {
  const taskId = createMockTaskConfig(TaskIdSchema.parse("calendar-test"));
  const config = getWorkspaceConfig();

  afterEach(() => {
    setWorkspaceConfig(config);
    vi.resetAllMocks();
  });

  it("runs the bundled helper with the arguments as given", async () => {
    setWorkspaceConfig({
      ...config,
      macHelperBinPath: AbsolutePathSchema.parse("/app/bin/instrument-mac"),
    });
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({ all: "[]", exitCode: 0 } as never);

    const result = await createMacHelperCommand(
      CALENDAR_COMMAND,
      taskId,
    ).execute(["events", "--from", "tomorrow"], ctx);

    expect(result.exitCode).toBe(0);
    expect(vi.mocked(execa)).toHaveBeenCalledWith(
      "/app/bin/instrument-mac",
      ["events", "--from", "tomorrow"],
      expect.objectContaining({ stdin: "ignore" }),
    );
  });

  it("asks the helper for contacts under its own subcommand", async () => {
    setWorkspaceConfig({
      ...config,
      macHelperBinPath: AbsolutePathSchema.parse("/app/bin/instrument-mac"),
    });
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({ all: "[]", exitCode: 0 } as never);

    await createMacHelperCommand(CONTACTS_COMMAND, taskId).execute(
      ["--search", "neil"],
      ctx,
    );

    expect(vi.mocked(execa)).toHaveBeenCalledWith(
      "/app/bin/instrument-mac",
      ["contacts", "--search", "neil"],
      expect.anything(),
    );
  });

  it("points at osascript in a build without the helper", async () => {
    const { macHelperBinPath: _absent, ...without } = config;
    setWorkspaceConfig(without);

    const result = await createMacHelperCommand(
      CALENDAR_COMMAND,
      taskId,
    ).execute(["events"], ctx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("use osascript");
  });
});
