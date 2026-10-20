import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { CHATS_FOLDER_NAME } from "../../constants";
import { StoreId } from "../../schemas/store-id";
import { ensureChat } from "../chat/chat-records";
import { renameChat } from "../chat/chats";
import { getWorkspaceConfig } from "../workspace-config";
import { followTitle } from "./follow-title";
import { chatFolderNames } from "./own-folder";
import { rewriteChatFolder } from "./write-chat-folder";

/** A gate the next read of a chat's records waits at, once. */
const held = vi.hoisted(() => ({
  gate: undefined as Promise<void> | undefined,
  reached: false,
}));

vi.mock(import("../records/fold-folder"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    foldChatInFolder: async (dir: string) => {
      const gate = held.gate;
      if (gate) {
        held.gate = undefined;
        held.reached = true;
        await gate;
      }
      return original.foldChatInFolder(dir);
    },
  };
});

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

  it("renames a folder to its title's new capitals on a disk that ignores case", async (context) => {
    const chatId = await ensureChat(StoreId.newSessionId(), "Dinner plans");
    const folder = path.join(chatsFolder(), "Dinner plans");
    const ignoresCase = await fs
      .stat(path.join(chatsFolder(), "DINNER PLANS"))
      .then(
        (found) => found.isDirectory(),
        () => false,
      );
    if (!ignoresCase) {
      await fs.rm(folder, { recursive: true });
      context.skip();
    }

    await followTitle(chatId, "Dinner Plans");

    const names = await fs.readdir(chatsFolder());
    expect(names).toContain("Dinner Plans");
    expect(names).not.toContain("Dinner plans");
    expect(names).not.toContain("Dinner Plans 2");
    expect(folderOf(chatId)).toBe("Dinner Plans");
  });

  it("moves the folder once when the turn's own write is under way", async () => {
    const chatId = await ensureChat(StoreId.newSessionId(), "Long wait");
    await renameChat(chatId, "Long wait renamed");
    // The turn's end has read where the folder is and is reading the
    // records when the title is followed.
    let release = () => {};
    held.gate = new Promise((resolve) => {
      release = resolve;
    });
    held.reached = false;
    const written = rewriteChatFolder(chatId);
    await vi.waitFor(() => {
      expect(held.reached).toBe(true);
    });
    const followed = followTitle(chatId, "Long wait renamed");
    // Long enough for a rename that does not wait on the write to land.
    await new Promise((resolve) => setTimeout(resolve, 200));
    release();
    await Promise.all([written, followed]);

    expect(
      (await fs.readdir(chatsFolder())).filter((name) =>
        name.startsWith("Long wait"),
      ),
    ).toEqual(["Long wait renamed"]);
    expect(folderOf(chatId)).toBe("Long wait renamed");
  });

  it("says nothing and throws nothing for a chat with no folder recorded", async () => {
    await expect(
      followTitle("not-a-chat" as never, "Anything"),
    ).resolves.toBeUndefined();
  });
});
