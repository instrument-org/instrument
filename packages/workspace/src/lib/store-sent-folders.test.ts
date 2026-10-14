import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

import { AbsolutePathSchema } from "../schemas/paths";
import { type SessionMessage } from "../schemas/session/message";
import { StoreId } from "../schemas/store-id";
import { ChatIdSchema } from "../schemas/chat-id";
import { createMockChatConfig } from "../test/helpers/mock-chat-config";
import { recordMovedPaths } from "./moved-paths";
import { Store } from "./store";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

vi.mock(import("./session-store-storage"));

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

it("reads a folder a message sent back where a move took it", async () => {
  const chatId = createMockChatConfig(ChatIdSchema.parse("sent-folders"));
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "sent-folders-")),
  );
  roots.push(root);
  const machineDir = path.join(root, "machine");
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    workspaceMachineDir: AbsolutePathSchema.parse(machineDir),
  });
  fs.mkdirSync(path.join(root, "picked", "Sales"), { recursive: true });
  recordMovedPaths(machineDir, [
    { from: path.join(root, "workspace"), to: path.join(root, "picked") },
  ]);
  const sessionId = StoreId.newSessionId();
  const messageId = StoreId.newMessageId();
  await Store.saveSession(
    { createdAt: new Date(), id: sessionId, title: "Sent folders" },
    chatId,
  );
  await Store.saveMessageWithParts(
    {
      id: messageId,
      metadata: { createdAt: new Date(), sessionId },
      parts: [
        {
          data: {
            files: [],
            folders: [
              { path: path.join(root, "workspace", "Sales") },
              { path: path.join(root, "elsewhere") },
            ],
          },
          metadata: {
            createdAt: new Date(),
            id: StoreId.newPartId(),
            messageId,
            sessionId,
          },
          type: "data-attachments",
        },
      ],
      role: "user",
    } satisfies SessionMessage.UserWithParts,
    chatId,
  );

  const [message] = (
    await Store.getMessagesWithParts({ chatId, sessionId })
  )._unsafeUnwrap();
  const [part] = message?.parts ?? [];

  expect(part?.type === "data-attachments" && part.data.folders).toEqual([
    { path: path.join(root, "picked", "Sales") },
    { path: path.join(root, "elsewhere") },
  ]);
});
