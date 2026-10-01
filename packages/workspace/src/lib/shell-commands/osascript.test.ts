import {
  createCommandContext,
  EMPTY_BYTES,
  encodeUtf8ToBytes,
  InMemoryFs,
} from "just-bash";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfig } from "../../test/helpers/mock-task-config";
import { createOsascriptCommand } from "./osascript";

vi.mock("execa");

const mockCtx = createCommandContext({
  cwd: "/task",
  env: new Map<string, string>(),
  fs: new InMemoryFs(),
  stdin: EMPTY_BYTES,
});

async function mockExeca() {
  const { execa } = await import("execa");
  vi.mocked(execa).mockResolvedValueOnce({ all: "", exitCode: 0 } as never);
  return execa;
}

describe("osascriptCommand", () => {
  const taskId = createMockTaskConfig(TaskIdSchema.parse("test"));
  const command = createOsascriptCommand(taskId);

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("runs the system osascript with the script as given", async () => {
    const execa = await mockExeca();
    const script = 'tell application "Reminders" to count reminders';

    await command.execute(["-e", script], mockCtx);

    expect(vi.mocked(execa)).toHaveBeenCalledWith(
      "/usr/bin/osascript",
      ["-e", script],
      expect.objectContaining({ stdin: "ignore" }),
    );
  });

  it("forwards a piped script", async () => {
    const execa = await mockExeca();
    const script = "return 1 + 1";

    await command.execute(["-"], {
      ...mockCtx,
      stdin: encodeUtf8ToBytes(script),
    });

    expect(vi.mocked(execa)).toHaveBeenCalledWith(
      "/usr/bin/osascript",
      ["-"],
      expect.objectContaining({ input: Buffer.from(script) }),
    );
  });

  it("refuses a script file on a mount it cannot reach", async () => {
    const result = await command.execute(["/mnt/Home/script.scpt"], mockCtx);

    expect(result.exitCode).toBe(1);
  });
});
