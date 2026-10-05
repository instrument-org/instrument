import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type Draft,
  draftsAtom,
  draftWordsAtom,
  forgetDraftWords,
} from "./window";

const DRAFT: Draft = { createdAt: 0, id: "d1", updatedAt: 0, words: "kept" };

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
