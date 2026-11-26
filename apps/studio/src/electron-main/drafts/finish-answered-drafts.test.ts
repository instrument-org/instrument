import { type Draft } from "@/shared/drafts";
import {
  type ChatId,
  type DraftMessage,
  StoreId,
} from "@instrument-org/workspace/electron";
import { describe, expect, it, vi } from "vitest";

import { settleAfterTurn, type TurnEnd } from "./finish-answered-drafts";

vi.mock("../lib/electron-logger", () => ({
  logger: { scope: () => ({ error: vi.fn(), warn: vi.fn() }) },
}));

const CHAT = "2026-11-26-quiet-dishwashers" as ChatId;
const OWN = StoreId.newSessionId();
const TASK = StoreId.newSessionId();

const sent = (id: string, chatId = CHAT): Draft => ({
  createdAt: 1,
  id,
  send: { chatId, messageId: `m-${id}`, stage: "sent" },
  updatedAt: 1,
  words: "Which is quietest?",
});

const ended = (more: Partial<TurnEnd> = {}): TurnEnd => ({
  id: CHAT,
  sessionId: OWN,
  ...more,
});

const standing = (isUnanswered: boolean, sessionId = OWN): DraftMessage => ({
  isUnanswered,
  sessionId,
});

describe("a turn's end", () => {
  it.each<[string, TurnEnd, DraftMessage | undefined, string | undefined]>([
    [
      "finishes a draft its message's turn answered",
      ended(),
      standing(false),
      "finish",
    ],
    [
      "finishes a draft whose turn ended unanswered, with no take-back asked",
      ended(),
      standing(true),
      "finish",
    ],
    [
      "finishes a draft a plain Stop ended",
      ended({ notice: {} }),
      standing(true),
      "finish",
    ],
    [
      "leaves a draft a Stop is taking back to the take-back",
      ended({ notice: { takesBack: true } }),
      standing(true),
      undefined,
    ],
    [
      "finishes a draft a take-back Stop reached once answered",
      ended({ notice: { takesBack: true } }),
      standing(false),
      "finish",
    ],
    [
      "leaves a draft whose message is in another session's turn",
      ended({ sessionId: TASK }),
      standing(true),
      undefined,
    ],
    [
      "gives back a draft whose message was taken back",
      ended(),
      undefined,
      "release",
    ],
  ])("%s", (_name, turn, message, op) => {
    const messages = new Map(message === undefined ? [] : [["a", message]]);
    expect(settleAfterTurn([sent("a")], turn, messages)).toEqual(
      op === undefined ? [] : [{ id: "a", type: op }],
    );
  });

  it("touches no draft that is not sent into that chat", () => {
    const elsewhere = sent("b", "2026-11-26-taxes" as ChatId);
    const writing: Draft = { ...sent("c"), send: undefined };
    const sending: Draft = {
      ...sent("d"),
      send: { chatId: CHAT, stage: "sending" },
    };
    expect(
      settleAfterTurn([elsewhere, writing, sending], ended(), new Map()),
    ).toEqual([]);
  });
});
