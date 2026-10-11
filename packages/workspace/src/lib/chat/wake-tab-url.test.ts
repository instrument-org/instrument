import { describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { ChatDirSchema } from "../../schemas/paths";
import { buildWorkspaceFsLayout } from "../workspace-fs-layout";
import { chatSpellingOfUrl } from "./wake";

const chatId = ChatIdSchema.parse("chat-tabs");
const chatRoot = "/work/chats/chat-tabs";

vi.mock(import("../resolve-workspace-file-path"), async (importOriginal) => ({
  ...(await importOriginal()),
  taskFsLayout: () =>
    Promise.resolve(
      buildWorkspaceFsLayout({ taskHostRoot: ChatDirSchema.parse(chatRoot) }),
    ),
}));

// The chat is told where a task's page is; a page on this computer must reach
// it by the chat's own path, never by where it sits on disk.
describe("chatSpellingOfUrl", () => {
  it.each([
    ["https://example.com/a?b=1", "https://example.com/a?b=1"],
    [`file://${chatRoot}/work/report.html`, "file:///task/work/report.html"],
    [
      "file:///Users/someone/secrets.txt",
      "file://<a file outside your folders>",
    ],
  ])("spells %s as %s", async (url, expected) => {
    expect(await chatSpellingOfUrl(url, chatId)).toBe(expected);
  });
});
