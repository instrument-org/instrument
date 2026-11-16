import fs from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { type ChatId } from "../../schemas/chat-id";
import { AbsolutePathSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { ChatWrites } from "../chat-writes";
import { sessionOfChat } from "../record-folders";
import { recordChatFolderMoves } from "../retire-chats-folder/folder-moves";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { workspaceLayout } from "../workspace-layout";
import { ensureChat } from "./chat-records";
import { foldersChatWrote } from "./written-folders";

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

/** A chat whose shell calls created `files`, as the disk reported them. */
async function chatThatWrote(files: string[]): Promise<ChatId> {
  const chatId = await ensureChat(StoreId.newSessionId());
  const sessionId = sessionOfChat(chatId);
  if (sessionId === undefined) {
    throw new Error("The chat has no session");
  }
  const id = StoreId.newMessageId();
  const createdAt = new Date();
  const meta = { createdAt, id: StoreId.newPartId(), messageId: id, sessionId };
  const saved = await ChatWrites.saveMessageWithParts(
    {
      id,
      metadata: {
        createdAt,
        finishedAt: createdAt,
        finishReason: "stop",
        modelId: "test-model",
        providerId: "test-provider",
        sessionId,
      },
      parts: [
        {
          data: {
            apps: [],
            counts: [],
            files: files.map((file) => ({
              change: "created" as const,
              path: file,
              via: "disk" as const,
            })),
            hosts: [],
            settled: true,
            step: StoreId.newPartId(),
          },
          metadata: meta,
          type: "data-stepFacts",
        },
      ],
      role: "assistant",
    },
    chatId,
  );
  if (saved.isErr()) {
    throw saved.error;
  }
  return chatId;
}

async function put(relative: string) {
  const file = path.join(rootDir, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, "made");
  return file;
}

describe("foldersChatWrote", () => {
  it("names the folder in Files a shell call wrote into", async () => {
    const file = await put("Files/Kyoto trip/maps/day 1.png");
    const chatId = await chatThatWrote([file]);

    expect(await foldersChatWrote(chatId)).toEqual([
      path.join(rootDir, "Files", "Kyoto trip"),
    ]);
  });

  it("finds a file written in Chats/ in the folder of Files it moved to", async () => {
    const chatId = await chatThatWrote([
      path.join(rootDir, "Chats", "Lisbon trip", "plan.md"),
    ]);
    await put("Files/Lisbon trip/plan.md");
    await recordChatFolderMoves({
      device: getWorkspaceConfig().deviceId,
      devicesDir: workspaceLayout(rootDir).devicesDir,
      moves: [{ chat: chatId, from: "Lisbon trip", to: "Lisbon trip" }],
    });

    expect(await foldersChatWrote(chatId)).toEqual([
      path.join(rootDir, "Files", "Lisbon trip"),
    ]);
  });

  it("leaves out hidden folders and files that are gone", async () => {
    const hidden = await put(".instrument/scratch/notes.md");
    const chatId = await chatThatWrote([
      hidden,
      path.join(rootDir, "Files", "Gone", "a.md"),
    ]);

    expect(await foldersChatWrote(chatId)).toEqual([]);
  });
});
