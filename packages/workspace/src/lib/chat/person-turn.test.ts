import { okAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { type SessionMessage } from "../../schemas/session/message";
import { StoreId } from "../../schemas/store-id";
import { ChatReads } from "../chat-reads";
import { isPersonsTurn } from "./person-turn";

const working = vi.hoisted(() => ({ value: true }));
vi.mock(import("./activity"), async (importOriginal) => ({
  ...(await importOriginal()),
  isWorking: () => working.value,
}));

const chatId = ChatIdSchema.parse("persons-turn");
const sessionId = StoreId.newSessionId();

const message = (role: "assistant" | "user", ...parts: unknown[]) =>
  // Only what the check reads of a message.
  ({
    id: StoreId.newMessageId(),
    parts,
    role,
  }) as unknown as SessionMessage.WithParts;
const ASK = message("user", {
  text: "Open this in a new window",
  type: "text",
});
const REPLY = message("assistant", { text: "Looking.", type: "text" });
const WAKE = message("user", { data: {}, type: "data-taskEvent" });

beforeEach(() => {
  working.value = true;
});

describe("isPersonsTurn", () => {
  it.each([
    ["their message being answered", [ASK, REPLY], true, true],
    ["a wake since theirs", [ASK, REPLY, WAKE], true, false],
    ["their message since a wake", [WAKE, REPLY, ASK], true, true],
    ["a turn that has ended", [ASK, REPLY], false, false],
    ["nothing said", [], true, false],
  ])("%s", async (_case, history, isAtWork, expected) => {
    working.value = isAtWork;
    vi.spyOn(ChatReads, "history").mockReturnValue(okAsync(history));
    expect(await isPersonsTurn(chatId, sessionId)).toBe(expected);
  });
});
