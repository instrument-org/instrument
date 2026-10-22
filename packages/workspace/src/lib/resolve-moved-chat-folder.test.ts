import fs from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { type ChatId } from "../schemas/chat-id";
import { AbsolutePathSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { ensureChat } from "./chat/chat-records";
import { followTitle } from "./chat-folders/follow-title";
import { ChatWrites } from "./chat-writes";
import { currentEnvironment } from "./environment";
import { chatDir, chatOwnFolder, sessionOfChat } from "./record-folders";
import { resolveWorkspaceFilePaths } from "./resolve-workspace-file-path";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { shellPath } from "./workspace-fs-layout";

/**
 * A chat's folder follows its title, which settles after the first turn has
 * already written into the folder under the name it began with. The agent
 * names those files by the folder it was told, so the person's views find
 * them where the folder went.
 */

beforeEach(() => {
  // A workspace the person picked, which is where finished work goes.
  const config = getWorkspaceConfig();
  setWorkspaceConfig({
    ...config,
    outputDir: AbsolutePathSchema.parse(config.rootDir),
  });
});

/** A chat whose agent was told its folder as it is now. */
async function chatToldItsFolder(): Promise<{
  chatId: ChatId;
  folder: string;
}> {
  const chatId = await ensureChat(StoreId.newSessionId());
  const sessionId = sessionOfChat(chatId);
  const folder = chatOwnFolder(chatDir(chatId));
  if (sessionId === undefined || folder === undefined) {
    throw new Error("The chat has no session or folder");
  }
  const id = StoreId.newMessageId();
  const createdAt = new Date();
  await ChatWrites.saveMessageWithParts(
    {
      id,
      metadata: {
        agentName: "instrument",
        createdAt,
        environment: await currentEnvironment(chatId),
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
  return { chatId, folder };
}

async function hostPathOf(chatId: ChatId, filePath: string) {
  return (
    await resolveWorkspaceFilePaths({ chatId, filePaths: [filePath] })
  ).get(filePath);
}

describe("a file named in the chat's folder before it followed the title", () => {
  it("is found where the folder went", async () => {
    const { chatId, folder } = await chatToldItsFolder();
    await fs.writeFile(path.join(folder, "test.md"), "made in the first turn");
    const named = shellPath(path.join(folder, "test.md"));

    await followTitle(chatId, "Hello World");

    expect(path.basename(folder)).toBe("Untitled chat");
    expect(await hostPathOf(chatId, named)).toBe(
      path.join(path.dirname(folder), "Hello World", "test.md"),
    );
    expect(await hostPathOf(chatId, shellPath(folder))).toBe(
      path.join(path.dirname(folder), "Hello World"),
    );
  });

  it("is found where the folder went once another chat holds the old name", async () => {
    const { chatId, folder } = await chatToldItsFolder();
    await fs.writeFile(path.join(folder, "test.md"), "mine");
    await followTitle(chatId, "Say hello");
    const other = await chatToldItsFolder();
    await fs.writeFile(path.join(other.folder, "test.md"), "theirs");

    expect(other.folder).toBe(folder);
    expect(
      await hostPathOf(chatId, shellPath(path.join(folder, "test.md"))),
    ).toBe(path.join(path.dirname(folder), "Say hello", "test.md"));
    expect(
      await hostPathOf(other.chatId, shellPath(path.join(folder, "test.md"))),
    ).toBe(path.join(folder, "test.md"));
  });
});
