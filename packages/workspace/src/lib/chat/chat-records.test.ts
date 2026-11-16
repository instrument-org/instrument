import { describe, expect, it } from "vitest";

import { UNTITLED_CHAT_TITLE } from "../../constants";
import { StoreId } from "../../schemas/store-id";
import { ChatReads } from "../chat-reads";
import { chatRecords } from "../records/chat-records";
import { updateSessionTitle } from "../update-session-title";
import { ensureChat } from "./chat-records";

describe("ensureChat", () => {
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
});
