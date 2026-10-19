import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { StoreId } from "../../schemas/store-id";
import { readChatRecord } from "../chat-record";
import { chatDir } from "../record-folders";
import { getWorkspaceConfig } from "../workspace-config";
import { ensureChat } from "./chat-records";

/** Where the person's own folder for a chat is, by the name it was given. */
function chatsFolder(name: string): string {
  return path.join(getWorkspaceConfig().rootDir, "Chats", name);
}

describe("ensureChat", () => {
  it("gives a new chat the folder the person sees, named for its first words", async () => {
    const chatId = await ensureChat(
      StoreId.newSessionId(),
      "Find a quiet dishwasher",
    );

    // Made at once rather than at the end of the turn: the agent's finished
    // work and what was pasted into the draft both land in it before the
    // first command runs.
    await expect(
      fs
        .stat(chatsFolder("Find a quiet dishwasher"))
        .then((at) => at.isDirectory()),
    ).resolves.toBe(true);
    const record = await readChatRecord(chatDir(chatId));
    expect(record.settings?.folder).toBe("Find a quiet dishwasher");
  });

  it("numbers the folder of a second chat opening with the same words", async () => {
    await ensureChat(StoreId.newSessionId(), "Check the weather");
    const second = await ensureChat(
      StoreId.newSessionId(),
      "Check the weather",
    );

    const record = await readChatRecord(chatDir(second));
    expect(record.settings?.folder).toBe("Check the weather 2");
  });

  it("takes a dollar sign out of the name, which the shell would expand", async () => {
    const chatId = await ensureChat(
      StoreId.newSessionId(),
      "Quiet dishwashers under $900",
    );

    const record = await readChatRecord(chatDir(chatId));
    expect(record.settings?.folder).toBe("Quiet dishwashers under 900");
  });
});
