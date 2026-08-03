import {
  type CommandContext,
  EMPTY_BYTES,
  encodeUtf8ToBytes,
  InMemoryFs,
} from "just-bash";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfig } from "../../test/helpers/mock-task-config";
import { createFfprobeCommand } from "./ffprobe";

vi.mock("execa");

const mockCtx: CommandContext = {
  cwd: "/task",
  env: new Map<string, string>(),
  fs: new InMemoryFs(),
  stdin: EMPTY_BYTES,
};

async function mockExeca() {
  const { execa } = await import("execa");
  vi.mocked(execa).mockResolvedValueOnce({ all: "", exitCode: 0 } as never);
  return execa;
}

describe("ffprobeCommand", () => {
  const taskId = createMockTaskConfig(TaskIdSchema.parse("test"));
  const command = createFfprobeCommand(taskId);

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("forwards piped bytes so a pipe:0 input reads them", async () => {
    const execa = await mockExeca();
    const data = "    fake media bytes";

    await command.execute(["-show_format", "pipe:0"], {
      ...mockCtx,
      stdin: encodeUtf8ToBytes(data),
    });

    expect(vi.mocked(execa)).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(["pipe:0"]),
      expect.objectContaining({ input: Buffer.from(data) }),
    );
  });

  it("ignores stdin when nothing is piped", async () => {
    const execa = await mockExeca();

    await command.execute(["-show_format", "attachments/in.mp4"], mockCtx);

    expect(vi.mocked(execa)).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ stdin: "ignore" }),
    );
  });
});
