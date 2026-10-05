import {
  createCommandContext,
  EMPTY_BYTES,
  encodeUtf8ToBytes,
  InMemoryFs,
} from "just-bash";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfig } from "../../test/helpers/mock-task-config";
import { taskDir } from "../task-dir-utils";
import { createOsascriptCommand } from "./osascript";
import { taskLayout } from "../../test/helpers/task-layout";

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
  const command = createOsascriptCommand(taskId, taskLayout(taskId));

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

  it.each([
    ["-l", "JavaScript", "-e", "var re=/^a/"],
    ["-e", 'open location "https://x.com/?a=/b"'],
  ])(
    "runs a script whose text only looks like a path: %s %s",
    async (...args) => {
      const execa = await mockExeca();

      const result = await command.execute(args, mockCtx);

      expect(result.exitCode).toBe(0);
      expect(vi.mocked(execa)).toHaveBeenCalledWith(
        "/usr/bin/osascript",
        args,
        expect.anything(),
      );
    },
  );

  it("points a quoted task path in the script at the task folder", async () => {
    const execa = await mockExeca();

    await command.execute(
      ["-e", 'read POSIX file "/task/invite.ics"'],
      mockCtx,
    );

    expect(vi.mocked(execa)).toHaveBeenCalledWith(
      "/usr/bin/osascript",
      ["-e", `read POSIX file "${taskDir(taskId)}/invite.ics"`],
      expect.anything(),
    );
  });

  it("refuses a quoted attached-folder path in the script", async () => {
    const result = await command.execute(
      ["-e", 'read POSIX file "/mnt/Home/invite.ics"'],
      mockCtx,
    );

    expect(result.exitCode).toBe(1);
  });

  it("refuses a script file on a mount it cannot reach", async () => {
    const result = await command.execute(["/mnt/Home/script.scpt"], mockCtx);

    expect(result.exitCode).toBe(1);
  });
});
