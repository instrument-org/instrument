import { type PromptEditorRef } from "@/client/components/prompt-editor";
import { type ChatId } from "@instrument-org/workspace/client";
import { createStore } from "jotai";
import { describe, expect, it } from "vitest";

import {
  appendDictationToPromptAtom,
  draftKeyString,
  type PromptDraftKey,
  promptDraftRefAtom,
  releasePromptDraftRefAtom,
} from "./prompt-value";

const KEY: PromptDraftKey = {
  chatId: "2026-10-21-dishwashers" as ChatId,
  scope: "chat",
};

/** An editor that records the dictated words it was given. */
function editor() {
  const appended: string[] = [];
  const ref = {
    appendDictation: (text: string) => {
      appended.push(text);
    },
  } as unknown as PromptEditorRef; // only appendDictation is reached here
  return { appended, ref };
}

describe("the live composer for a draft shown in two tabs", () => {
  it("stays the other tab's when the first tab's composer goes away", () => {
    const store = createStore();
    const first = editor();
    const second = editor();
    store.set(promptDraftRefAtom(KEY), first.ref);
    store.set(promptDraftRefAtom(KEY), second.ref);

    store.set(releasePromptDraftRefAtom, {
      editor: first.ref,
      keyed: draftKeyString(KEY),
    });
    store.set(appendDictationToPromptAtom, {
      key: KEY,
      text: "and a quiet one",
    });

    expect(store.get(promptDraftRefAtom(KEY))).toBe(second.ref);
    expect(second.appended).toEqual(["and a quiet one"]);
  });

  it("is let go when the live composer goes away", () => {
    const store = createStore();
    const only = editor();
    store.set(promptDraftRefAtom(KEY), only.ref);

    store.set(releasePromptDraftRefAtom, {
      editor: only.ref,
      keyed: draftKeyString(KEY),
    });

    expect(store.get(promptDraftRefAtom(KEY))).toBeNull();
  });
});
