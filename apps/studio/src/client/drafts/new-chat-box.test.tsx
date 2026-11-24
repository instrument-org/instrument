import { storedWordsAtom, typedWordsAtom } from "@/client/atoms/prompt-value";
import {
  deleteGroupTabRouter,
  setGroupTabRouter,
} from "@/client/lib/group-tab-router-registry";
import { type TabRouter } from "@/client/lib/tab-router";
import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  bindNewChatBoxAtom,
  closingNewChat,
  draftInNewChatBox,
  dropNewChatWordsAtom,
  isNewChatEmptied,
  newChatBoxesAtom,
  pickedNewChatProject,
  pickNewChatProjectAtom,
  settleMadeDraft,
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

  it("writes words typed a moment before the screen goes, and names the draft they made", () => {
    const { inBox, store, type } = window();
    expect(settleMadeDraft(store, TAB)).toBeUndefined();

    type("Before the switch");
    const made = settleMadeDraft(store, TAB);

    expect(made).toBe(inBox()?.id);
    expect(inBox()?.words).toBe("Before the switch");
  });

  it("names the draft in the tab's address in the step that makes it", () => {
    const { inBox, store, type } = window();
    const replace = vi.fn();
    // Only the history is read: a whole router would load the route tree.
    setGroupTabRouter(TAB, { history: { replace } } as unknown as TabRouter);
    try {
      type("Quit right after this");
      expect(replace).not.toHaveBeenCalled();
      settleMadeDraft(store, TAB);
      expect(replace.mock.calls).toEqual([[`/chats?draft=${inBox()?.id}`]]);
    } finally {
      deleteGroupTabRouter(TAB);
    }
  });

  it("names no draft the box took up from the address", () => {
    const { store } = window();
    store.set(bindNewChatBoxAtom, { draftId: "from-the-address", tabId: TAB });
    expect(settleMadeDraft(store, TAB)).toBeUndefined();
  });

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

  it("keeps the picked project once words make the draft", () => {
    const { inBox, settle, store, type } = window();
    store.set(pickNewChatProjectAtom, { projectId: "travel", tabId: TAB });
    const picked = () =>
      pickedNewChatProject(inBox(), store.get(newChatBoxesAtom)[TAB]);
    expect(picked()).toBe("travel");

    type("Hotels");
    settle();
    type("Hotels in Lisbon");
    settle();

    expect(picked()).toBe("travel");
  });

  it("counts a project the model suggested as not picked", () => {
    expect(
      pickedNewChatProject(
        {
          createdAt: 0,
          id: "d",
          projectId: "travel",
          projectSource: "suggested",
          updatedAt: 0,
          words: "Hotels in Lisbon",
        },
        { draftId: "d" },
      ),
    ).toBeUndefined();
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

describe("a new chat's tab as it closes", () => {
  const draft = (id: string, words: string) => ({
    createdAt: 1,
    id,
    updatedAt: 1,
    words,
  });
  const drafts = [draft("kept", "Hotels in Lisbon"), draft("emptied", "")];

  it.each([
    {
      boxes: {},
      expected: { href: "/chats?draft=kept" },
      href: "/chats?draft=kept",
      why: "a draft with words keeps its address",
    },
    {
      boxes: { [TAB]: { draftId: "kept" } },
      expected: { href: "/chats?draft=kept" },
      href: "/chats",
      why: "the draft its box writes into is named where the address has none",
    },
    {
      boxes: { [TAB]: { draftId: "emptied" } },
      expected: { emptied: "emptied", href: "/chats" },
      href: "/chats?draft=emptied",
      why: "an emptied draft is thrown away and the tab closes blank",
    },
    {
      boxes: {},
      expected: { href: "/chats" },
      href: "/chats?draft=gone",
      why: "a draft already gone leaves a blank tab",
    },
    {
      boxes: {},
      expected: { href: "/chats" },
      href: "/chats",
      why: "a new tab with no draft closes as it is",
    },
    {
      boxes: { [TAB]: { draftId: "emptied" } },
      expected: { href: "/settings" },
      href: "/settings",
      why: "a tab that is no new chat closes as it is",
    },
  ])("$why", ({ boxes, expected, href }) => {
    expect(closingNewChat({ boxes, drafts }, { href, tabId: TAB })).toEqual(
      expected,
    );
  });

  it("keeps the draft words settling as it closes just made", () => {
    expect(
      closingNewChat(
        { boxes: {}, drafts },
        { href: "/chats", made: "kept", tabId: TAB },
      ),
    ).toEqual({ href: "/chats?draft=kept" });
  });
});

describe("words that open a place", () => {
  it.each([true, false])(
    "leave no draft, and keep the project (settled: %s)",
    (isSettled) => {
      const { inBox, settle, store, type } = window();
      type("example.com");
      if (isSettled) {
        settle();
        expect(inBox()).toBeDefined();
      }

      store.set(dropNewChatWordsAtom, { projectId: "home", tabId: TAB });
      settle();

      expect(settleMadeDraft(store, TAB)).toBeUndefined();
      expect(store.get(draftsAtom)).toEqual([]);
      expect(store.get(newChatBoxesAtom)[TAB]).toEqual({
        draftId: null,
        projectId: "home",
      });
    },
  );
});
