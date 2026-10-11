import {
  createCommandContext,
  EMPTY_BYTES,
  encodeUtf8ToBytes,
  InMemoryFs,
} from "just-bash";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { createPythonNativeCommand, importedModules } from "./python";
import { taskLayout } from "../../test/helpers/task-layout";

vi.mock("execa");
vi.mock("./uv", () => ({
  ensureTaskVenv: vi.fn(),
}));

const realFs = new InMemoryFs();

describe("python-native", () => {
  const chatId = createMockChatConfig(ChatIdSchema.parse("test"));
  const layout = taskLayout(chatId);
  const command = createPythonNativeCommand(chatId, layout);
  const taskPath = layout.task.mountPoint;
  const mockCtx = createCommandContext({
    cwd: taskPath,
    env: new Map<string, string>(),
    fs: realFs,
    stdin: EMPTY_BYTES,
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("passes -c code with a real path through unchanged", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    } as never);
    const code = `open("${taskPath}/attachments/chart.svg")`;

    await command.execute(["-c", code], mockCtx);

    const calledArgs = vi.mocked(execa).mock.calls.at(-1)?.[1];
    expect(calledArgs).toEqual(["-c", code]);
  });

  it("passes a heredoc program on stdin through unchanged", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    } as never);
    const program = `print(open("${taskPath}/work/data.csv").read())`;

    await command.execute([], {
      ...mockCtx,
      stdin: encodeUtf8ToBytes(program),
    });

    expect(vi.mocked(execa)).toHaveBeenCalledWith(
      expect.any(String),
      [],
      expect.objectContaining({ input: Buffer.from(program) }),
    );
  });

  it("leaves stdin alone when a script file argument is present", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    } as never);

    const data = 'rows mentioning "/x" are data, not code';
    await command.execute(["work/script.py"], {
      ...mockCtx,
      stdin: encodeUtf8ToBytes(data),
    });

    expect(vi.mocked(execa)).toHaveBeenCalledWith(
      expect.any(String),
      ["work/script.py"],
      expect.objectContaining({ input: Buffer.from(data) }),
    );
  });

  it("forwards non-ASCII stdin bytes unchanged", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    } as never);

    await command.execute([], {
      ...mockCtx,
      stdin: encodeUtf8ToBytes("print('café → déjà')"),
    });

    expect(vi.mocked(execa)).toHaveBeenCalledWith(
      expect.any(String),
      [],
      expect.objectContaining({
        input: Buffer.from("print('café → déjà')", "utf8"),
      }),
    );
  });
});

describe("importedModules", () => {
  it("reads the top-level module of each import, and none from a relative one", () => {
    expect(
      importedModules(
        [
          "import numpy as np, os",
          "from PIL import Image",
          "  from faster_whisper.transcribe import WhisperModel",
          "from . import helper",
          "from .local import thing",
          "# import commented",
          "x = 1; import json",
        ].join("\n"),
      ),
    ).toEqual(["numpy", "os", "PIL", "faster_whisper"]);
  });
});
