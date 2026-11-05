import { type Draft } from "@/shared/drafts";
import { act, renderHook } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WORDS_SETTLE_MS } from "./settle-words";
import { draftsAtom, resetDrafts, updateDraftAtom } from "./store";
import { useComposerWords } from "./use-composer-words";

const store = getDefaultStore();
const ID = "d1";

const draft = (words: string): Draft => ({
  createdAt: 1,
  id: ID,
  updatedAt: 1,
  words,
});

/** A composer on a draft, in a window with focus, whose editor says what it was told. */
function composer(words = "") {
  resetDrafts([draft(words)]);
  store.sub(draftsAtom, () => undefined);
  const setEditor = vi.fn();
  const rendered = renderHook(() =>
    useComposerWords(
      { draftId: ID, scope: "draft" },
      { current: { setValue: setEditor } },
    ),
  );
  return { ...rendered, setEditor };
}

/** What another window wrote into the draft, as it reaches this one. */
function arrives(words: string) {
  act(() => {
    store.set(updateDraftAtom, {
      id: ID,
      update: (current) => ({ ...current, words }),
    });
  });
}

function type(typed: ReturnType<typeof composer>, words: string) {
  act(() => {
    typed.result.current.setValue(words);
  });
}

function settle() {
  act(() => {
    vi.advanceTimersByTime(WORDS_SETTLE_MS);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetDrafts();
});

describe("words from another window", () => {
  it("come into a window just brought to the front, so its next key adds to them", () => {
    const typed = composer("Plan");
    arrives("Plan the trip");
    expect(typed.setEditor).toHaveBeenCalledWith("Plan the trip");
  });

  it("leave a window being typed in as it is", () => {
    const typed = composer("Plan");
    type(typed, "Plan a");
    settle();
    arrives("Plan the trip");
    expect(typed.setEditor).not.toHaveBeenCalled();
    expect(typed.result.current.value).toBe("Plan a");
  });

  it("leave words still on their way into the draft as they are", () => {
    const typed = composer("Plan");
    type(typed, "Plan a");
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    arrives("Plan the trip");
    expect(typed.setEditor).not.toHaveBeenCalled();
  });

  it("come in again once the window has lost focus", () => {
    const typed = composer("Plan");
    type(typed, "Plan a");
    settle();
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    arrives("Plan the trip");
    expect(typed.setEditor).toHaveBeenCalledWith("Plan the trip");
  });
});
