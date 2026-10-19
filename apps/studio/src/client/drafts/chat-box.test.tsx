import { typedWordsAtom } from "@/client/atoms/prompt-value";
import { type Draft } from "@/shared/drafts";
import { type ChatId } from "@instrument-org/workspace/client";
import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  beginReplySendAtom,
  chatBoxesAtom,
  otherRepliesOf,
  replyInBox,
  settleReplySendAtom,
  swapInReplyAtom,
} from "./chat-box";
import { WORDS_SETTLE_MS } from "./settle-words";
import { claimDraftAtom, draftsAtom, resetDrafts } from "./store";

const CHAT = "2026-10-19-dishwashers" as ChatId;

const reply = (id: string, updatedAt: number, words: string): Draft => ({
  chatId: CHAT,
  createdAt: updatedAt,
  id,
  updatedAt,
  words,
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  resetDrafts();
});

/** A window over these drafts, listening to main as a mounted one does. */
function window(drafts: Draft[] = []) {
  resetDrafts(drafts);
  const store = createStore();
  store.sub(draftsAtom, () => undefined);
  const type = (words: string) => {
    store.set(typedWordsAtom, { key: { chatId: CHAT, scope: "chat" }, words });
  };
  const settle = () => vi.advanceTimersByTime(WORDS_SETTLE_MS);
  const replies = () =>
    store.get(draftsAtom).filter((draft) => draft.chatId === CHAT);
  const inBox = () =>
    replyInBox(store.get(draftsAtom), store.get(chatBoxesAtom), CHAT);
  return { inBox, replies, settle, store, type };
}

describe("the words in a chat's box", () => {
  it("make one reply once the typing settles, however much is typed before", () => {
    const { replies, settle, type } = window();
    type("T");
    type("Th");
    type("Thanks");
    expect(replies()).toEqual([]);

    settle();

    expect(replies().map((draft) => draft.words)).toEqual(["Thanks"]);
  });

  it("write nothing for a box nobody typed in", () => {
    const { replies, settle } = window();
    settle();
    expect(replies()).toEqual([]);
  });

  it("take the reply away when the box is emptied, so the next words start another", () => {
    const { inBox, replies, settle, store, type } = window();
    type("Thanks");
    settle();
    type("");
    settle();

    expect(replies()).toEqual([]);
    expect(store.get(chatBoxesAtom)[CHAT]).toBeNull();
    expect(inBox()).toBeUndefined();
  });

  it("keep an emptied reply that has something attached", () => {
    const attached: Draft = {
      ...reply("r", 1, "see this"),
      attached: [{ kind: "folder", path: "/Users/sam/Trip" }],
    };
    const { replies, settle, type } = window([attached]);
    type("");
    settle();

    expect(replies().map((draft) => draft.id)).toEqual(["r"]);
  });

  it("read the newest of the chat's replies where the box has taken none up", () => {
    const { inBox } = window([reply("old", 1, "one"), reply("new", 2, "two")]);
    expect(inBox()?.id).toBe("new");
  });
});

describe("a reply's send", () => {
  it("claims the reply, so it is neither in the box nor waiting while it is on its way", () => {
    const { inBox, replies, settle, store, type } = window();
    type("Thanks");
    settle();

    const sending = store.set(beginReplySendAtom, {
      chatId: CHAT,
      words: "Thanks, that worked",
    });

    expect(sending?.draftId).toBe(replies()[0]?.id);
    expect(replies()[0]).toMatchObject({
      sendingTo: CHAT,
      words: "Thanks, that worked",
    });
    expect(inBox()).toBeUndefined();
    expect(otherRepliesOf(store.get(draftsAtom), {}, CHAT)).toEqual([]);
  });

  it("drops words still waiting to be written, which go with the send", () => {
    const { replies, settle, store, type } = window();
    type("Thanks");
    settle();
    type("Thanks, that worked");

    store.set(beginReplySendAtom, {
      chatId: CHAT,
      words: "Thanks, that worked",
    });
    // The box empties on submit.
    type("");
    settle();

    expect(replies()).toHaveLength(1);
    expect(replies()[0]?.sendingTo).toBe(CHAT);
  });

  it("is gone once it lands, and what was typed while it was in flight is a reply of its own", () => {
    const { replies, settle, store, type } = window();
    type("Thanks");
    settle();
    const sending = store.set(beginReplySendAtom, {
      chatId: CHAT,
      words: "Thanks",
    });
    type("");
    type("One more thing");
    settle();

    store.set(settleReplySendAtom, {
      chatId: CHAT,
      draftId: sending?.draftId ?? "",
      ok: true,
    });

    expect(replies().map((draft) => draft.words)).toEqual(["One more thing"]);
  });

  it("is the person's again where it fails, back in the box it left", () => {
    const { inBox, replies, settle, store, type } = window();
    type("Thanks");
    settle();
    const sending = store.set(beginReplySendAtom, {
      chatId: CHAT,
      words: "Thanks",
    });
    type("");
    settle();

    store.set(settleReplySendAtom, {
      chatId: CHAT,
      draftId: sending?.draftId ?? "",
      ok: false,
    });
    // The composer puts the words back.
    type("Thanks");
    settle();

    expect(replies()).toHaveLength(1);
    expect(replies()[0]?.sendingTo).toBeUndefined();
    expect(inBox()?.id).toBe(sending?.draftId);
  });

  it("sends no draft from a box whose words had not settled into one", () => {
    const { replies, store, type } = window();
    type("Quick");
    expect(
      store.set(beginReplySendAtom, { chatId: CHAT, words: "Quick" }),
    ).toBe(undefined);
    vi.runAllTimers();
    expect(replies()).toEqual([]);
  });

  // The inbox once marked a chat just started from a draft as having a
  // reply waiting: the draft named the chat as it was sent, and a draft
  // naming a chat was what made a reply.
  it("of a new chat's draft makes no reply of it in that chat", async () => {
    const { inBox, store } = window([
      {
        createdAt: 1,
        id: "new chat",
        updatedAt: 1,
        words: "what's my latest tweet",
      },
    ]);

    await store.set(claimDraftAtom, {
      chatId: CHAT,
      id: "new chat",
      words: "what's my latest tweet",
    });

    expect(inBox()).toBeUndefined();
    expect(otherRepliesOf(store.get(draftsAtom), {}, CHAT)).toEqual([]);
  });
});

describe("a chat with several replies waiting", () => {
  const waiting = () => [
    reply("first", 1, "one"),
    reply("second", 2, "two"),
    reply("third", 3, "three"),
  ];

  it("lists the replies its box is not writing into, newest first", () => {
    const { store } = window(waiting());
    expect(
      otherRepliesOf(store.get(draftsAtom), {}, CHAT).map((draft) => draft.id),
    ).toEqual(["second", "first"]);
  });

  it("lists every one where its box is writing into none", () => {
    const { store } = window(waiting());
    expect(
      otherRepliesOf(store.get(draftsAtom), { [CHAT]: null }, CHAT).map(
        (draft) => draft.id,
      ),
    ).toEqual(["third", "second", "first"]);
  });

  it("puts the reply picked in the box, the words in the box staying with the one leaving", () => {
    const { inBox, replies, store } = window(waiting());

    const picked = store.set(swapInReplyAtom, {
      chatId: CHAT,
      draftId: "first",
      words: "three, edited",
    });

    expect(picked?.id).toBe("first");
    expect(inBox()?.id).toBe("first");
    const third = replies().find((draft) => draft.id === "third");
    // Keeping its stamp, so a launch reads the one picked as the newest.
    expect(third).toMatchObject({ updatedAt: 3, words: "three, edited" });
    expect(
      replies().find((draft) => draft.id === "first")?.updatedAt,
    ).toBeGreaterThan(3);
  });

  it("keeps words typed into an emptied box as a reply of their own when another is picked", () => {
    const { replies, store } = window(waiting());
    store.set(chatBoxesAtom, { [CHAT]: null });

    store.set(swapInReplyAtom, {
      chatId: CHAT,
      draftId: "first",
      words: "a fourth",
    });

    expect(replies().map((draft) => draft.words)).toContain("a fourth");
    expect(replies()).toHaveLength(4);
  });

  it("is left as it is by picking the one already in the box", () => {
    const { replies, store } = window(waiting());
    const before = replies();

    expect(
      store.set(swapInReplyAtom, { chatId: CHAT, draftId: "third", words: "x" })
        ?.id,
    ).toBe("third");
    expect(replies()).toEqual(before);
  });

  it("writes into nothing once its box is emptied, leaving the others alone", () => {
    const { replies, settle, type } = window(waiting());
    type("");
    settle();
    type("a new one");
    settle();

    expect(replies().map((draft) => draft.words)).toEqual([
      "one",
      "two",
      "a new one",
    ]);
  });
});
