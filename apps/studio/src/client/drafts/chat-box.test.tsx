import {
  appendToPromptAtom,
  storedWordsAtom,
  typedWordsAtom,
} from "@/client/atoms/prompt-value";
import { type Draft, repliesOf } from "@/shared/drafts";
import { type ChatId } from "@instrument-org/workspace/client";
import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  beginReplySendAtom,
  chatBoxesAtom,
  otherRepliesOf,
  failReplySendAtom,
  replyInBox,
  swapInReplyAtom,
  takeBackReplyAtom,
  takeUpArrivedReplyAtom,
  takeUpBoxAtom,
} from "./chat-box";
import { WORDS_SETTLE_MS } from "./settle-words";
import {
  applyDraftOpsAtom,
  claimDraftAtom,
  draftsAtom,
  resetDrafts,
} from "./store";

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
      send: { chatId: CHAT, stage: "sending" },
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
    expect(replies()[0]?.send).toEqual({ chatId: CHAT, stage: "sending" });
  });

  it("is no reply once it lands, and what was typed while it was in flight is a reply of its own", async () => {
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

    // The message route marks it sent as the message is written.
    await store.set(applyDraftOpsAtom, [
      { id: sending.draftId, messageId: "m1", type: "sent" },
    ]);

    expect(
      repliesOf(store.get(draftsAtom), CHAT).map((draft) => draft.words),
    ).toEqual(["One more thing"]);
    expect(
      replies().find((draft) => draft.id === sending.draftId)?.send,
    ).toEqual({ chatId: CHAT, messageId: "m1", stage: "sent" });
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

    store.set(failReplySendAtom, { chatId: CHAT, draftId: sending.draftId });
    // The composer puts the words back.
    type("Thanks");
    settle();

    expect(replies()).toHaveLength(1);
    expect(replies()[0]?.send).toBeUndefined();
    expect(inBox()?.id).toBe(sending?.draftId);
  });

  it("keeps what was typed since the press, not yet written, when it fails", () => {
    const { replies, settle, store, type } = window();
    type("Thanks");
    settle();
    const sending = store.set(beginReplySendAtom, {
      chatId: CHAT,
      words: "Thanks",
    });
    type("");
    type("One more");

    store.set(failReplySendAtom, { chatId: CHAT, draftId: sending.draftId });
    settle();

    expect(
      replies()
        .map((draft) => draft.words)
        .toSorted(),
    ).toEqual(["One more", "Thanks"]);
  });

  it("sends a reply made for words typed faster than they settle into one", () => {
    const { replies, store, type } = window();
    type("Quick");
    const sending = store.set(beginReplySendAtom, {
      chatId: CHAT,
      words: "Quick",
    });
    vi.runAllTimers();
    expect(replies()).toMatchObject([
      {
        id: sending.draftId,
        send: { chatId: CHAT, stage: "sending" },
        words: "Quick",
      },
    ]);
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

describe("a box opened on a chat", () => {
  it("writes into the reply it showed, not one that arrived after", () => {
    const { replies, settle, store, type } = window([reply("mine", 1, "one")]);
    store.set(takeUpBoxAtom, CHAT);
    // Another window's reply, newer than the one this box shows.
    resetDrafts([reply("mine", 1, "one"), reply("theirs", 2, "two")]);
    type("one, and more");
    settle();

    expect(
      Object.fromEntries(replies().map((draft) => [draft.id, draft.words])),
    ).toEqual({ mine: "one, and more", theirs: "two" });
  });

  it("writes a reply of its own where it showed none", () => {
    const { replies, settle, store, type } = window();
    store.set(takeUpBoxAtom, CHAT);
    resetDrafts([reply("theirs", 2, "two")]);
    type("mine");
    settle();

    expect(
      replies()
        .map((draft) => draft.words)
        .toSorted(),
    ).toEqual(["mine", "two"]);
  });

  it("takes up a reply another window started while it wrote into none", () => {
    const { inBox, replies, settle, store, type } = window();
    store.set(takeUpBoxAtom, CHAT);
    resetDrafts([reply("theirs", 2, "two")]);

    const taken = store.set(takeUpArrivedReplyAtom, {
      chatId: CHAT,
      known: new Set<string>(),
    });
    type("two, and mine");
    settle();

    expect(taken?.id).toBe("theirs");
    expect(inBox()?.id).toBe("theirs");
    expect(replies().map((draft) => draft.words)).toEqual(["two, and mine"]);
  });

  it("leaves a reply it has already seen waiting beside it", () => {
    const { inBox, store } = window([reply("aside", 1, "later")]);
    store.set(chatBoxesAtom, { [CHAT]: null });

    expect(
      store.set(takeUpArrivedReplyAtom, {
        chatId: CHAT,
        known: new Set(["aside"]),
      }),
    ).toBeUndefined();
    expect(inBox()).toBeUndefined();
  });

  it("takes up nothing while it writes into a reply of its own", () => {
    const { inBox, store } = window([reply("mine", 1, "one")]);
    store.set(takeUpBoxAtom, CHAT);
    resetDrafts([reply("mine", 1, "one"), reply("theirs", 2, "two")]);

    store.set(takeUpArrivedReplyAtom, {
      chatId: CHAT,
      known: new Set<string>(),
    });

    expect(inBox()?.id).toBe("mine");
  });

  it("adds to what was typed into it last, written or not, when nothing shows it", () => {
    const { settle, store, type } = window();
    type("Look at");
    store.set(appendToPromptAtom, {
      key: { chatId: CHAT, scope: "chat" },
      update: "notes.md",
    });
    settle();

    expect(store.get(storedWordsAtom({ chatId: CHAT, scope: "chat" }))).toBe(
      "Look at notes.md ",
    );
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

describe("a reply whose message a Stop took back", () => {
  /** A reply sent from the box, its message written, as main has it then. */
  async function sent(store: ReturnType<typeof window>["store"]) {
    const { draftId } = store.set(beginReplySendAtom, {
      chatId: CHAT,
      words: "Which is quietest?",
    });
    await store.set(applyDraftOpsAtom, [
      {
        id: draftId,
        set: {
          attached: [{ kind: "folder", path: "/Files/Trip" }],
          context: [{ kind: "link", url: "https://example.com/" }],
        },
        type: "update",
      },
      { id: draftId, messageId: "m1", type: "sent" },
    ]);
    return draftId;
  }

  it("goes back in the box it was sent from, exactly as it was", async () => {
    const { inBox, store, type } = window();
    type("Which is quietest?");
    const draftId = await sent(store);

    const taken = store.set(takeBackReplyAtom, {
      chatId: CHAT,
      draftId,
      isBoxEmpty: true,
    });

    expect(taken?.inBox).toBe(true);
    expect(inBox()).toMatchObject({
      attached: [{ kind: "folder", path: "/Files/Trip" }],
      context: [{ kind: "link", url: "https://example.com/" }],
      id: draftId,
      words: "Which is quietest?",
    });
    expect(inBox()?.send).toBeUndefined();
  });

  it("waits beside a box something was typed into since", async () => {
    const { inBox, settle, store, type } = window();
    type("Which is quietest?");
    const draftId = await sent(store);
    type("Actually, the cheapest");
    settle();

    const taken = store.set(takeBackReplyAtom, {
      chatId: CHAT,
      draftId,
      isBoxEmpty: false,
    });

    expect(taken?.inBox).toBe(false);
    expect(inBox()?.words).toBe("Actually, the cheapest");
    expect(
      repliesOf(store.get(draftsAtom), CHAT)
        .map((draft) => draft.words)
        .toSorted(),
    ).toEqual(["Actually, the cheapest", "Which is quietest?"]);
  });

  it("makes a chat's opening draft one of its replies", async () => {
    const { inBox, store } = window([
      { createdAt: 1, id: "opening", updatedAt: 1, words: "hi" },
    ]);
    await store.set(claimDraftAtom, {
      chatId: CHAT,
      id: "opening",
      words: "hi",
    });

    store.set(takeBackReplyAtom, {
      chatId: CHAT,
      draftId: "opening",
      isBoxEmpty: true,
    });

    expect(inBox()).toMatchObject({ chatId: CHAT, id: "opening" });
  });
});
