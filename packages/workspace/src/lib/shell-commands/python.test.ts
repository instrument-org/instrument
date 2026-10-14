import {
  createCommandContext,
  EMPTY_BYTES,
  encodeUtf8ToBytes,
  InMemoryFs,
} from "just-bash";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { createPythonCommand } from "./python";
import { chatLayout } from "../../test/helpers/chat-layout";

vi.mock("execa");
vi.mock("./uv", () => ({
  ensureVenvForCommand: vi.fn(),
}));

const realFs = new InMemoryFs();

describe("python", () => {
  const chatId = createMockChatConfig(ChatIdSchema.parse("test"));
  const layout = chatLayout(chatId);
  const command = createPythonCommand(chatId, layout);
  const chatRoot = layout.chat.shellRoot;
  const mockCtx = createCommandContext({
    cwd: chatRoot,
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
    const code = `open("${chatRoot}/attachments/chart.svg")`;

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
    const program = `print(open("${chatRoot}/work/data.csv").read())`;

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
