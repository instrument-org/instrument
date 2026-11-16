import fs from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { type ChatId } from "../schemas/chat-id";
import { AbsolutePathSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { ensureChat } from "./chat/chat-records";
import { ChatWrites } from "./chat-writes";
import { currentEnvironment } from "./environment";
import { sessionOfChat } from "./record-folders";
import { recordChatFolderMoves } from "./retire-chats-folder/folder-moves";
import { resolveWorkspaceFilePaths } from "./resolve-workspace-file-path";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { shellPath } from "./workspace-fs-layout";
import { workspaceLayout } from "./workspace-layout";

/**
 * Earlier builds kept each chat's work in `Chats/<title>/`, which a launch
 * empties into `Files/<title>/`. A chat's messages still name its files in
 * `Chats/`, under the name its folder had when the agent wrote them, so the
 * person's views find them where the folder went.
 */

let rootDir: string;

beforeEach(() => {
  // A workspace the person picked, which is where finished work goes.
  const config = getWorkspaceConfig();
  rootDir = config.rootDir;
  setWorkspaceConfig({
    ...config,
    outputDir: AbsolutePathSchema.parse(config.rootDir),
  });
});

/** A chat whose agent was told `Chats/<told>/` as its output folder. */
async function chatTold(told: string): Promise<ChatId> {
  const chatId = await ensureChat(StoreId.newSessionId());
  const sessionId = sessionOfChat(chatId);
  if (sessionId === undefined) {
    throw new Error("The chat has no session");
  }
  const id = StoreId.newMessageId();
  const createdAt = new Date();
  await ChatWrites.saveMessageWithParts(
    {
      id,
      metadata: {
        agentName: "instrument",
        createdAt,
        environment: {
          ...(await currentEnvironment(chatId)),
          outputFolder: shellPath(path.join(rootDir, "Chats", told)),
        },
        realRole: "user",
        sessionId,
      },
      parts: [
        {
          metadata: {
            createdAt,
            id: StoreId.newPartId(),
            messageId: id,
            sessionId,
          },
          state: "done",
          text: "<system_info>…</system_info>",
          type: "text",
        },
      ],
      role: "session-context",
    },
    chatId,
  );
  return chatId;
}

/** Puts a file where `Chats/<name>/` went, and records the move. */
async function movedToFiles(name: string, chat: ChatId | undefined) {
  await fs.mkdir(path.join(rootDir, "Files", name), { recursive: true });
  await fs.writeFile(path.join(rootDir, "Files", name, "test.md"), "made");
  await recordChatFolderMoves({
    device: getWorkspaceConfig().deviceId,
    devicesDir: workspaceLayout(rootDir).devicesDir,
    moves: [{ ...(chat !== undefined && { chat }), from: name, to: name }],
  });
}

async function hostPathOf(chatId: ChatId, filePath: string) {
  return (
    await resolveWorkspaceFilePaths({ chatId, filePaths: [filePath] })
  ).get(filePath);
}

describe("a file named in a folder moved out of Chats/", () => {
  it("is found where the folder went", async () => {
    const chatId = await chatTold("Hello World");
    await movedToFiles("Hello World", chatId);

    expect(
      await hostPathOf(
        chatId,
        shellPath(path.join(rootDir, "Chats", "Hello World", "test.md")),
      ),
    ).toBe(path.join(rootDir, "Files", "Hello World", "test.md"));
  });

  it("is found where the folder went when kept by its place in the workspace", async () => {
    const chatId = await chatTold("Hello World");
    await movedToFiles("Hello World", chatId);

    expect(
      await hostPathOf(chatId, "workspace:/Chats/Hello World/test.md"),
    ).toBe(path.join(rootDir, "Files", "Hello World", "test.md"));
  });

  it("is found under the name the chat's folder had before its title settled", async () => {
    const chatId = await chatTold("Untitled chat");
    await movedToFiles("Say hello", chatId);

    expect(
      await hostPathOf(
        chatId,
        shellPath(path.join(rootDir, "Chats", "Untitled chat", "test.md")),
      ),
    ).toBe(path.join(rootDir, "Files", "Say hello", "test.md"));
  });

  it("is another chat's first name only for that chat", async () => {
    const mine = await chatTold("Untitled chat");
    await movedToFiles("Say hello", mine);
    const theirs = await chatTold("Untitled chat");
    const named = shellPath(
      path.join(rootDir, "Chats", "Untitled chat", "test.md"),
    );

    expect(await hostPathOf(theirs, named)).toBe(
      path.join(rootDir, "Chats", "Untitled chat", "test.md"),
    );
  });
});
