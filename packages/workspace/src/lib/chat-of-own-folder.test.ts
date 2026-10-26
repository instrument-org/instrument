import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { StoreId } from "../schemas/store-id";
import { ensureChat } from "./chat/chat-records";
import { rewriteChatFolder } from "./chat-folders/write-chat-folder";
import { chatDir, chatOfOwnFolder, chatOwnFolder } from "./record-folders";

/**
 * Files asks before trashing a chat's own folder, so the folder has to be
 * told apart from a copy of it and from any other folder under `Chats/`.
 */

async function chatWithItsFolder() {
  const chatId = await ensureChat(StoreId.newSessionId());
  await rewriteChatFolder(chatId);
  const folder = chatOwnFolder(chatDir(chatId));
  if (folder === undefined) {
    throw new Error("The chat has no folder");
  }
  return { chatId, folder };
}

describe("chatOfOwnFolder", () => {
  it("names the chat whose own folder it is", async () => {
    const { chatId, folder } = await chatWithItsFolder();

    expect(chatOfOwnFolder(folder)).toBe(chatId);
  });

  it("names no chat for a copy of its folder", async () => {
    const { folder } = await chatWithItsFolder();
    const copy = `${folder} copy`;
    await fs.cp(folder, copy, { recursive: true });

    expect(chatOfOwnFolder(copy)).toBeUndefined();
  });

  it("names no chat for a folder of the person's own beside it", async () => {
    const { folder } = await chatWithItsFolder();
    const theirs = path.join(path.dirname(folder), "Notes");
    await fs.mkdir(theirs, { recursive: true });

    expect(chatOfOwnFolder(theirs)).toBeUndefined();
  });
});
