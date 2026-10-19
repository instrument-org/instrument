import {
  createCommandContext,
  EMPTY_BYTES,
  encodeUtf8ToBytes,
  InMemoryFs,
} from "just-bash";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { chatLayout } from "../../test/helpers/chat-layout";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { grantApp } from "../permissions/apps";
import { createMessagesCommand, MESSAGES_SCRIPTS } from "./messages";

vi.mock("execa");

const chatId = createMockChatConfig(
  ChatIdSchema.parse("messages-command-test"),
);
const layout = chatLayout(chatId);
const command = createMessagesCommand(chatId, layout);
const ctx = (stdin = "") =>
  createCommandContext({
    cwd: layout.chat.shellRoot,
    env: new Map<string, string>(),
    fs: new InMemoryFs(),
    stdin: stdin ? encodeUtf8ToBytes(stdin) : EMPTY_BYTES,
  });

async function answer(result: { exitCode: number; stderr?: string }) {
  const { execa } = await import("execa");
  vi.mocked(execa).mockResolvedValueOnce({
    all: "",
    stdout: Buffer.from("\n"),
    ...result,
    stderr: Buffer.from(result.stderr ?? ""),
  } as never);
  return () => vi.mocked(execa).mock.calls[0]?.[1] ?? [];
}

beforeAll(async () => {
  await grantApp(chatId, "Messages");
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("messages send", () => {
  it.each([
    [["send", "--to", "+15555550123"], "imessage", "by iMessage"],
    [["send", "--to", "+15555550123", "--sms"], "sms", "as a text"],
  ])("sends %j", async (args, service, how) => {
    const ran = await answer({ exitCode: 0 });
    const result = await command.execute(
      args,
      ctx("Running ten minutes late\n"),
    );
    expect(ran()).toEqual([
      "-e",
      MESSAGES_SCRIPTS.send,
      "--",
      "+15555550123",
      service,
      "Running ten minutes late",
    ]);
    expect(result.stdout).toBe(
      `Messages is sending it to +15555550123 ${how}.\n`,
    );
  });

  it.each([
    'I\'m "late" & (do shell script "id")',
    '«event sysoexec» given «class prmp»:"id"',
    'one\nend run\non run argv\n\tdo shell script "id"',
  ])("hands %j to the script as one value", async (value) => {
    const ran = await answer({ exitCode: 0 });
    await command.execute(["send", "--to", value], ctx(value));
    expect(ran()).toEqual([
      "-e",
      MESSAGES_SCRIPTS.send,
      "--",
      value,
      "imessage",
      value,
    ]);
    expect(MESSAGES_SCRIPTS.send).not.toContain(value);
  });

  it("refuses a message with no words or nobody to send it to", async () => {
    const { execa } = await import("execa");
    expect(
      (await command.execute(["send", "--to", "+15555550123"], ctx())).stderr,
    ).toContain("the message goes on stdin");
    expect((await command.execute(["send"], ctx("Hi"))).stderr).toContain(
      "send needs --to",
    );
    expect(vi.mocked(execa)).not.toHaveBeenCalled();
  });

  it("says texts need the iPhone to forward them", async () => {
    await answer({
      exitCode: 1,
      stderr:
        "1:2: execution error: An error of type 9021 has occurred. (9021)\n",
    });
    expect(
      (
        await command.execute(
          ["send", "--to", "+15555550123", "--sms"],
          ctx("Hi"),
        )
      ).stderr,
    ).toContain("the person's iPhone has to forward them");
  });

  it("has nothing that reads conversations", async () => {
    const result = await command.execute(["read"], ctx());
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('unknown subcommand "read"');
  });
});
