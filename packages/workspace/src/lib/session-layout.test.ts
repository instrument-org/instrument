import { describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../schemas/chat-id";
import { MountedFolder } from "../schemas/mounted-folder";
import {
  AbsolutePathSchema,
  ChatDirSchema,
  WorkDirSchema,
} from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { WINDOW_ID } from "../schemas/window-id";
import { getWorkspaceConfig } from "./workspace-config";
import { sessionLayout } from "./session-layout";

const chatId = ChatIdSchema.parse("reach");
const chatRoot = "/machine/work/reach";
const recordRoot = "/workspace/chats/reach";
const docs = "/Users/sam/Documents";
const CHAT_SESSION = StoreId.newSessionId();
const TASK_SESSION = StoreId.newSessionId();

vi.mock(import("./work-dir"), () => ({
  workDir: () => WorkDirSchema.parse(chatRoot),
}));
vi.mock(import("./record-folders"), async (importOriginal) => ({
  ...(await importOriginal()),
  chatDir: () => ChatDirSchema.parse(recordRoot),
}));
vi.mock(import("./chat/children"), async (importOriginal) => ({
  ...(await importOriginal()),
  sessionRole: (_chatId, sessionId) =>
    sessionId === CHAT_SESSION ? "chat" : "task",
}));
vi.mock(import("./permissions/chat-rules"), async (importOriginal) => ({
  ...(await importOriginal()),
  chatReach: (_chatId, sessionId, partId) =>
    Promise.resolve({
      folders: {
        docs: {
          access: "read-write",
          id: MountedFolder.IdSchema.parse("docs"),
          path: AbsolutePathSchema.parse(docs),
        },
      },
      rules: {
        ...(sessionId && { asker: { chatId, partId, sessionId } }),
        home: "/Users/sam",
        rules: [],
        withoutAsking: false,
      },
    }),
}));

// Every role works in the chat's work folder with its record folder, the
// chat's folders and skills; only the chat reaches its apps, and only a
// session asks.
describe("sessionLayout", () => {
  it.each([
    ["the chat's session", CHAT_SESSION, { apps: true, asks: true }],
    ["a task's session", TASK_SESSION, { apps: false, asks: true }],
    [
      "no session (a surface the person sees)",
      undefined,
      { apps: true, asks: false },
    ],
  ])("%s", async (_name, sessionId, expected) => {
    const layout = await sessionLayout({ chatId, sessionId });
    expect({
      apps: layout.apps?.hostRoot === getWorkspaceConfig().appsDir,
      asks: layout.rules.asker !== undefined,
    }).toEqual(expected);
    expect(layout.chat.hostRoot).toBe(chatRoot);
    expect(layout.record?.hostRoot).toBe(recordRoot);
    expect(layout.folders.map((folder) => folder.hostRoot)).toEqual([docs]);
    expect(layout.skills.length).toBeGreaterThan(0);
  });

  it("gives the window, which keeps no chat's records, none", async () => {
    const layout = await sessionLayout({ chatId: WINDOW_ID });
    expect(layout.record).toBeUndefined();
  });
});
