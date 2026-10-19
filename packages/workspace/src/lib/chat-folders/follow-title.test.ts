import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { CHATS_FOLDER_NAME } from "../../constants";
import { StoreId } from "../../schemas/store-id";
import { ensureChat } from "../chat/chat-records";
import { getWorkspaceConfig } from "../workspace-config";
import { followTitle } from "./follow-title";
import { chatFolderNames } from "./own-folder";

function chatsFolder(): string {
  return path.join(getWorkspaceConfig().rootDir, CHATS_FOLDER_NAME);
}

function folderOf(chatId: string): string | undefined {
  return chatFolderNames(getWorkspaceConfig().workspaceMachineDir).get(chatId);
}

describe("followTitle", () => {
  it("moves the folder to the settled title and records where it went", async () => {
    const chatId = await ensureChat(
      StoreId.newSessionId(),
      "Find a dishwasher",
    );
    await fs.writeFile(
      path.join(chatsFolder(), "Find a dishwasher", "made.txt"),
      "a file the agent wrote",
    );

    await followTitle(chatId, "Quiet dishwashers under 900");

    expect((await fs.readdir(chatsFolder())).toSorted()).toEqual([
      "Quiet dishwashers under 900",
    ]);
    // What the chat made travels with the folder, in one operation.
    await expect(
      fs.readFile(
        path.join(chatsFolder(), "Quiet dishwashers under 900", "made.txt"),
        "utf8",
      ),
    ).resolves.toBe("a file the agent wrote");
    expect(folderOf(chatId)).toBe("Quiet dishwashers under 900");
  });

  it("leaves a chat alone when the person took its folder away", async () => {
    const chatId = await ensureChat(
      StoreId.newSessionId(),
      "Check the weather",
    );
    await fs.rm(path.join(chatsFolder(), "Check the weather"), {
      recursive: true,
    });

    await followTitle(chatId, "Friday's weather");

    // Nothing is made in its place here: the chat's next change does that.
    expect(await fs.readdir(chatsFolder())).not.toContain("Friday's weather");
    expect(folderOf(chatId)).toBe("Check the weather");
  });

  it("says nothing and throws nothing for a chat with no folder recorded", async () => {
    await expect(
      followTitle("not-a-chat" as never, "Anything"),
    ).resolves.toBeUndefined();
  });
});
