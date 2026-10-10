import { describe, expect, it, vi } from "vitest";

import { TaskDirSchema } from "../../schemas/paths";
import { TaskIdSchema } from "../../schemas/task-id";
import { buildWorkspaceFsLayout } from "../workspace-fs-layout";
import { chatSpellingOfUrl } from "./wake";

const chatId = TaskIdSchema.parse("chat-tabs");
const taskId = TaskIdSchema.parse("task-tabs");
const taskRoot = "/work/chats/chat-tabs/tasks/task-tabs";

vi.mock(import("../resolve-workspace-file-path"), async (importOriginal) => ({
  ...(await importOriginal()),
  taskFsLayout: () =>
    Promise.resolve(
      buildWorkspaceFsLayout({ taskHostRoot: TaskDirSchema.parse(taskRoot) }),
    ),
}));
vi.mock(import("./folder-reach"), () => ({
  folderReach: () => Promise.resolve({}),
}));

// The chat is told where a task's page is; a page on this computer must reach
// it by the chat's own path, never by where it sits on disk.
describe("chatSpellingOfUrl", () => {
  it.each([
    ["https://example.com/a?b=1", "https://example.com/a?b=1"],
    [
      `file://${taskRoot}/work/report.html`,
      `file:///tasks/${taskId}/work/report.html`,
    ],
    [
      "file:///Users/someone/secrets.txt",
      "file://<a file outside your folders>",
    ],
  ])("spells %s as %s", async (url, expected) => {
    expect(await chatSpellingOfUrl(url, { chatId, taskId })).toBe(expected);
  });
});
