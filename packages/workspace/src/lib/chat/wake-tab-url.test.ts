import { describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { ChatDirSchema } from "../../schemas/paths";
import { buildWorkspaceFsLayout } from "../workspace-fs-layout";
import { chatSpellingOfUrl } from "./wake";

const chatId = ChatIdSchema.parse("chat-tabs");
const chatRoot = "/work/chats/chat-tabs";

vi.mock(import("../session-layout"), async (importOriginal) => ({
  ...(await importOriginal()),
  sessionLayout: () =>
    Promise.resolve(
      buildWorkspaceFsLayout({ taskHostRoot: ChatDirSchema.parse(chatRoot) }),
    ),
}));

// The chat is told where a task's page is; a page in its folders keeps its
// address, and one outside them is named only as that.
describe("chatSpellingOfUrl", () => {
  it.each([
    ["https://example.com/a?b=1", "https://example.com/a?b=1"],
    [
      `file://${chatRoot}/work/report.html`,
      `file://${chatRoot}/work/report.html`,
    ],
    [
      "file:///Users/someone/secrets.txt",
      "file://<a file outside your folders>",
    ],
  ])("spells %s as %s", async (url, expected) => {
    expect(await chatSpellingOfUrl(url, chatId)).toBe(expected);
  });
});
