import { type ChatId } from "@instrument-org/workspace/client";
import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  chatDraftWordsAtom,
  type Draft,
  draftsAtom,
  draftWordsAtom,
  forgetChatDraftWords,
  forgetDraftWords,
  holdDraftWhileSending,
  replyDraftOf,
  replyDraftsOf,
  swapInReplyDraftAtom,
} from "./window";

const DRAFT: Draft = { createdAt: 0, id: "d1", updatedAt: 0, words: "kept" };
const CHAT = "2026-10-14-a-chat" as ChatId;

describe("a draft's words", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    forgetDraftWords(DRAFT.id);
    vi.useRealTimers();
  });

  it("start as the record's, and reach the record a beat after they are typed", () => {
    const store = createStore();
    store.set(draftsAtom, [DRAFT]);
    expect(store.get(draftWordsAtom(DRAFT.id))).toBe("kept");
    store.set(draftWordsAtom(DRAFT.id), "kept and more");
    expect(store.get(draftWordsAtom(DRAFT.id))).toBe("kept and more");
    expect(store.get(draftsAtom)[0]?.words).toBe("kept");
    vi.advanceTimersByTime(300);
    expect(store.get(draftsAtom)[0]?.words).toBe("kept and more");
  });

  it("are let go with the draft, writing nothing after", () => {
    const store = createStore();
    store.set(draftsAtom, [DRAFT]);
    store.set(draftWordsAtom(DRAFT.id), "thrown away");
    forgetDraftWords(DRAFT.id);
    vi.advanceTimersByTime(300);
    expect(store.get(draftsAtom)[0]?.words).toBe("kept");
  });
});

describe("the words in a chat's own box", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    forgetChatDraftWords(CHAT);
    vi.useRealTimers();
  });

  it("make a draft for the chat once the typing settles", () => {
    const store = createStore();
    store.set(chatDraftWordsAtom(CHAT), "Thanks, that worked");

    expect(store.get(chatDraftWordsAtom(CHAT))).toBe("Thanks, that worked");
    expect(store.get(draftsAtom)).toEqual([]);
    vi.advanceTimersByTime(300);

    expect(store.get(draftsAtom)).toMatchObject([
      { chatId: CHAT, words: "Thanks, that worked" },
    ]);
  });

  it("write one draft however much is typed before the typing settles", () => {
    const store = createStore();
    for (const words of ["T", "Th", "Thanks"]) {
      store.set(chatDraftWordsAtom(CHAT), words);
      vi.advanceTimersByTime(100);
    }
    vi.advanceTimersByTime(300);

    expect(store.get(draftsAtom)).toMatchObject([
      { chatId: CHAT, words: "Thanks" },
    ]);
  });

  it("write nothing for a box nobody typed in", () => {
    const store = createStore();
    store.set(chatDraftWordsAtom(CHAT), "   ");
    vi.advanceTimersByTime(300);

    expect(store.get(draftsAtom)).toEqual([]);
  });

  it("take the draft away when the box is emptied", () => {
    const store = createStore();
    store.set(chatDraftWordsAtom(CHAT), "Thanks");
    vi.advanceTimersByTime(300);
    store.set(chatDraftWordsAtom(CHAT), "");
    vi.advanceTimersByTime(300);

    expect(store.get(draftsAtom)).toEqual([]);
  });

  it("keep an emptied draft that holds something that was pasted in", () => {
    const store = createStore();
    store.set(chatDraftWordsAtom(CHAT), "Thanks");
    vi.advanceTimersByTime(300);
    store.set(draftsAtom, (current) =>
      current.map((draft) => ({
        ...draft,
        attached: [{ kind: "folder" as const, path: "/Users/me/Trips" }],
      })),
    );
    store.set(chatDraftWordsAtom(CHAT), "");
    vi.advanceTimersByTime(300);

    expect(store.get(draftsAtom)).toMatchObject([{ chatId: CHAT, words: "" }]);
  });

  it("hold the draft through a send, so the emptied box never reaches it", () => {
    const store = createStore();
    store.set(chatDraftWordsAtom(CHAT), "Thanks");
    vi.advanceTimersByTime(300);
    const sent = store.get(draftsAtom)[0]?.id ?? "";

    // What a submit does: hold the draft, then empty the box.
    const letGo = holdDraftWhileSending(sent);
    store.set(chatDraftWordsAtom(CHAT), "");
    vi.advanceTimersByTime(300);
    expect(store.get(draftsAtom)).toMatchObject([{ id: sent }]);

    // A send that failed puts the words back into the draft they came from.
    letGo();
    store.set(chatDraftWordsAtom(CHAT), "Thanks");
    vi.advanceTimersByTime(300);
    expect(store.get(draftsAtom)).toMatchObject([
      { id: sent, words: "Thanks" },
    ]);
  });

  it("read the newest of a chat's drafts, of several waiting", () => {
    const drafts: Draft[] = [
      { chatId: CHAT, createdAt: 1, id: "first", updatedAt: 1, words: "one" },
      { chatId: CHAT, createdAt: 2, id: "second", updatedAt: 9, words: "two" },
      { createdAt: 3, id: "new-chat", updatedAt: 99, words: "elsewhere" },
    ];
    const store = createStore();
    store.set(draftsAtom, drafts);

    expect(replyDraftOf(drafts, CHAT)?.id).toBe("second");
    expect(store.get(chatDraftWordsAtom(CHAT))).toBe("two");
  });
});

describe("a chat with several replies waiting", () => {
  const WAITING: Draft[] = [
    { chatId: CHAT, createdAt: 1, id: "first", updatedAt: 1, words: "one" },
    { chatId: CHAT, createdAt: 2, id: "second", updatedAt: 2, words: "two" },
    { chatId: CHAT, createdAt: 3, id: "third", updatedAt: 3, words: "three" },
    { createdAt: 4, id: "new-chat", updatedAt: 99, words: "elsewhere" },
  ];

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    forgetChatDraftWords(CHAT);
    vi.useRealTimers();
  });

  it("lists its replies with the one in its box first", () => {
    expect(replyDraftsOf(WAITING, CHAT).map((draft) => draft.id)).toEqual([
      "third",
      "second",
      "first",
    ]);
  });

  it("puts the reply picked in the box", () => {
    const store = createStore();
    store.set(draftsAtom, WAITING);

    const picked = store.set(swapInReplyDraftAtom, {
      chatId: CHAT,
      draftId: "first",
    });

    expect(picked?.words).toBe("one");
    expect(replyDraftOf(store.get(draftsAtom), CHAT)?.id).toBe("first");
    expect(store.get(chatDraftWordsAtom(CHAT))).toBe("one");
  });

  it("keeps the words typed into the one leaving, where they belong", () => {
    const store = createStore();
    store.set(draftsAtom, WAITING);
    // Typed a moment ago, so its write to the record is still pending.
    store.set(chatDraftWordsAtom(CHAT), "three, and more");

    store.set(swapInReplyDraftAtom, { chatId: CHAT, draftId: "first" });
    vi.advanceTimersByTime(300);

    expect(wordsOf(store.get(draftsAtom))).toEqual({
      first: "one",
      "new-chat": "elsewhere",
      second: "two",
      third: "three, and more",
    });
  });

  it("is left as it is by picking the one already in the box", () => {
    const store = createStore();
    store.set(draftsAtom, WAITING);

    const picked = store.set(swapInReplyDraftAtom, {
      chatId: CHAT,
      draftId: "third",
    });

    expect(picked?.id).toBe("third");
    expect(store.get(draftsAtom)).toEqual(WAITING);
  });
});

function wordsOf(drafts: Draft[]): Record<string, string> {
  return Object.fromEntries(drafts.map((draft) => [draft.id, draft.words]));
}
