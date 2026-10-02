import { type PromptEditorRef } from "@/client/components/prompt-editor";
import { type StoreId } from "@instrument-org/workspace/client";
import { atom } from "jotai";
import { atomFamily } from "jotai/utils";

// A prompt draft is scoped one of two ways:
//  - chat: the reply in one chat of the window's, kept in memory for the
//    window's life so a reply left half-typed is there on coming back, and so
//    the inbox can say the chat has one.
//  - transient: a composer that starts from a prefill and is meant to be thrown
//    away, like the one on a skill page. Nothing is shared or retained, so
//    walking away from the surface loses the draft instead of carrying it to
//    the next skill and to the new-tab composer.
export type PromptDraftKey =
  | { id: string; scope: "transient" }
  | { scope: "chat"; sessionId: StoreId.Session };

/** One string per draft, for keying anything that has to re-key with the scope. */
export function draftKeyString(key: PromptDraftKey): string {
  switch (key.scope) {
    case "chat": {
      return `chat:${key.sessionId}`;
    }
    case "transient": {
      return `transient:${key.id}`;
    }
  }
}

// Transient drafts, discarded by the composer when it unmounts or re-keys.
const transientDraftFamily = atomFamily((_id: string) => atom(""));

// Chat replies, one per chat, kept as long as the window is: read by the
// chat's composer and by its row in the inbox alike, so the atom for a
// chat is always the same one, whether or not its composer is mounted.
const chatDraftFamily = atomFamily((_sessionId: StoreId.Session) => atom(""));

/** The value atom for a draft, resolving to the right backing store per scope. */
export function promptDraftAtom(key: PromptDraftKey) {
  switch (key.scope) {
    case "chat": {
      return chatDraftFamily(key.sessionId);
    }
    case "transient": {
      return transientDraftFamily(key.id);
    }
  }
}

// The live composer for a draft, so an imperative write targets the right
// editor even with several prompt surfaces mounted across tabs.
const promptDraftRefFamily = atomFamily((_key: string) =>
  atom<null | PromptEditorRef>(null),
);

export function promptDraftRefAtom(key: PromptDraftKey) {
  return promptDraftRefFamily(draftKeyString(key));
}

/** Drop a transient draft so re-opening the surface starts from its prefill. */
export function removeTransientDraft(id: string) {
  transientDraftFamily.remove(id);
  promptDraftRefFamily.remove(draftKeyString({ id, scope: "transient" }));
}

/**
 * Add something to a draft from outside the composer: a file path, a folder.
 *
 * It lands at the caret, so clicking "add to chat" mid-sentence puts the path
 * where the user is looking instead of at the end. The editor owns the document
 * and reports the result back through `onChange`, so there is nothing to write
 * here and nothing to wait a frame for.
 */
export const appendToPromptAtom = atom(
  null,
  (get, set, { key, update }: { key: PromptDraftKey; update: string }) => {
    const editor = get(promptDraftRefAtom(key));
    const text = update.trim();
    if (!editor) {
      // No composer mounted for the draft, so no caret to aim at: it goes on
      // the end of the stored words, which is what the composer is built from
      // when it comes back.
      const valueAtom = promptDraftAtom(key);
      const previous = get(valueAtom).trimEnd();
      set(valueAtom, (previous ? previous + " " : "") + text + " ");
      return;
    }
    editor.focus();
    editor.insertText(text);
  },
);
