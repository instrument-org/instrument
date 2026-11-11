import { storedWordsAtom, typedWordsAtom } from "@/client/atoms/prompt-value";
import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  bindNewChatBoxAtom,
  draftInNewChatBox,
  isNewChatEmptied,
  newChatBoxesAtom,
  pickNewChatProjectAtom,
} from "./new-chat-box";
import { WORDS_SETTLE_MS } from "./settle-words";
import { draftsAtom, resetDrafts } from "./store";

const TAB = "tab-1";
const KEY = { scope: "newChat" as const, tabId: TAB };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  resetDrafts();
});

/** A window with no drafts, listening to main as a mounted one does. */
function window() {
  resetDrafts([]);
  const store = createStore();
  store.sub(draftsAtom, () => undefined);
  const type = (words: string) => {
    store.set(typedWordsAtom, { key: KEY, words });
  };
  const settle = () => vi.advanceTimersByTime(WORDS_SETTLE_MS);
  const inBox = () =>
    draftInNewChatBox(store.get(draftsAtom), store.get(newChatBoxesAtom), TAB);
  return { inBox, settle, store, type };
}

describe("a new chat in the Chat screen", () => {
  it("makes nothing until words settle, then one draft it goes on writing into", () => {
    const { inBox, settle, store, type } = window();
    expect(inBox()).toBeUndefined();

    type("C");
    type("Compare");
    expect(store.get(draftsAtom)).toEqual([]);
    settle();
    const made = inBox();
    expect(made?.words).toBe("Compare");

    type("Compare our plans");
    settle();

    expect(store.get(draftsAtom).map((draft) => draft.id)).toEqual([made?.id]);
    expect(store.get(storedWordsAtom(KEY))).toBe("Compare our plans");
  });

  it("marks a draft it made as its own, and one the address names as not", () => {
    const { settle, store, type } = window();
    type("Hotels");
    settle();
    const made = store.get(newChatBoxesAtom)[TAB];
    expect(made?.isMadeHere).toBe(true);

    store.set(bindNewChatBoxAtom, { draftId: "from-the-address", tabId: TAB });

    expect(store.get(newChatBoxesAtom)[TAB]).toEqual({
      draftId: "from-the-address",
    });
  });

  it.each([
    ["another draft", "draft-b"],
    ["a blank new chat", null],
  ])(
    "keeps the last words typed when the box moves to %s before they settle",
    (_to, draftId) => {
      const { inBox, settle, store, type } = window();
      type("A first");
      settle();
      const left = inBox();
      type("A last words");

      store.set(bindNewChatBoxAtom, { draftId, tabId: TAB });
      settle();

      const drafts = store.get(draftsAtom);
      expect(drafts.find((draft) => draft.id === left?.id)?.words).toBe(
        "A last words",
      );
      expect(drafts.map((draft) => draft.id)).toEqual([left?.id]);
    },
  );

  it("files the draft under the project picked before there was one", () => {
    const { inBox, settle, store, type } = window();
    store.set(pickNewChatProjectAtom, { projectId: "travel", tabId: TAB });

    type("Hotels in Lisbon");
    settle();

    expect(inBox()).toMatchObject({
      projectId: "travel",
      projectSource: "chosen",
    });
  });

  it("keeps an emptied draft for the screen to judge, and starts over once let go of", () => {
    const { inBox, settle, store, type } = window();
    type("Hotels");
    settle();
    type("");
    settle();
    expect(inBox()?.words).toBe("");

    store.set(bindNewChatBoxAtom, { draftId: null, tabId: TAB });
    type("Flights");
    settle();

    expect(store.get(draftsAtom).map((draft) => draft.words)).toEqual([
      "",
      "Flights",
    ]);
  });
});

describe("whether a new chat was emptied", () => {
  /** A draft a paste just made: no words, its bytes not yet written into its folder. */
  const madeByPaste = { createdAt: 1, id: "d1", updatedAt: 1, words: "" };

  it.each([
    {
      expected: false,
      isBoxEmpty: false,
      why: "the box still shows the paste",
    },
    { expected: true, isBoxEmpty: true, why: "the box was emptied too" },
  ])(
    "is $expected for a draft with nothing yet when $why",
    ({ expected, isBoxEmpty }) => {
      expect(
        isNewChatEmptied(madeByPaste, { hasTabs: false, isBoxEmpty }),
      ).toBe(expected);
    },
  );
});
