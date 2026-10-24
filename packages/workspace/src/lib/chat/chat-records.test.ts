import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { UNTITLED_CHAT_TITLE } from "../../constants";
import { StoreId } from "../../schemas/store-id";
import { ChatReads } from "../chat-reads";
import { chatFolderNames } from "../chat-folders/own-folder";
import { chatRecords } from "../records/chat-records";
import { updateSessionTitle } from "../update-session-title";
import { getWorkspaceConfig } from "../workspace-config";
import { ensureChat } from "./chat-records";

/** The name this computer recorded for a chat's folder. */
function folderOf(chatId: string): string | undefined {
  return chatFolderNames(getWorkspaceConfig().workspaceMachineDir).get(chatId);
}

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
    expect(folderOf(chatId)).toBe("Find a quiet dishwasher");
  });

  it.each([
    {
      case: "its opening words",
      firstWords:
        "Find a quiet dishwasher under 900 dollars that fits a narrow kitchen",
      startedAs: "Find a quiet dishwasher under 900 dollars that…",
    },
    {
      case: "the placeholder with no words",
      firstWords: "",
      startedAs: UNTITLED_CHAT_TITLE,
    },
  ])(
    "starts a new chat's session as $case, which still reads as untitled so naming runs",
    async ({ firstWords, startedAs }) => {
      const sessionId = StoreId.newSessionId();
      const chatId = await ensureChat(sessionId, firstWords);

      const read = await chatRecords().read(chatId);
      expect(read.chat.sessions.map((session) => session.startedAs)).toEqual([
        startedAs,
      ]);
      const session = await ChatReads.session({ chatId, sessionId });
      expect(session._unsafeUnwrap().title).toBe(UNTITLED_CHAT_TITLE);
      await expect(
        updateSessionTitle({ chatId, sessionId, title: "Dishwasher picks" }),
      ).resolves.toBe(true);
    },
  );

  it("numbers the folder of a second chat opening with the same words", async () => {
    await ensureChat(StoreId.newSessionId(), "Check the weather");
    const second = await ensureChat(
      StoreId.newSessionId(),
      "Check the weather",
    );

    expect(folderOf(second)).toBe("Check the weather 2");
  });

  it("takes a dollar sign out of the name, which the shell would expand", async () => {
    const chatId = await ensureChat(
      StoreId.newSessionId(),
      "Quiet dishwashers under $900",
    );

    expect(folderOf(chatId)).toBe("Quiet dishwashers under 900");
  });
});
