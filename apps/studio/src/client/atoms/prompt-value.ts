import { type PromptEditorRef } from "@/client/components/prompt-editor";
import { type PromptInputDraft } from "@/client/components/prompt-input";
import {
  chatBoxesAtom,
  chatBoxWordsKey,
  keepChatBoxAtom,
  replyInBox,
} from "@/client/drafts/chat-box";
import { flushWords, settleWords } from "@/client/drafts/settle-words";
import { draftsAtom, updateDraftAtom } from "@/client/drafts/store";
import { type ChatId } from "@instrument-org/workspace/client";
import { appendDictatedText } from "@/client/lib/dictation-text";
import { dictatedToken } from "@instrument-org/shared/dictated-text";
import { atom } from "jotai";
import { atomFamily } from "jotai/utils";
import { isEqual } from "radashi";

// A composer writes into one of three things:
//  - chat: the reply in one chat's box, a draft of its own in Drafts (see
//    `chat-box.ts`), so a reply left half-typed is there on coming back,
//    survives a relaunch, and the inbox can say the chat has one.
//  - draft: a new chat's draft, whose words are the draft's own.
//  - transient: a composer that starts from a prefill and is meant to be thrown
//    away, like the one on a skill page. Nothing is shared or retained, so
//    walking away from the surface loses the words instead of carrying them to
//    the next skill and to the new-tab composer.
export type PromptDraftKey =
  | { draftId: string; scope: "draft" }
  | { id: string; scope: "transient" }
  | { chatId: ChatId; scope: "chat" };

/** One string per composer, for keying anything that has to re-key with what it writes into. */
export function draftKeyString(key: PromptDraftKey): string {
  switch (key.scope) {
    case "chat": {
      return chatBoxWordsKey(key.chatId);
    }
    case "draft": {
      return `draft:${key.draftId}`;
    }
    case "transient": {
      return `transient:${key.id}`;
    }
  }
}

// Transient words, discarded by the composer when it unmounts or re-keys.
const transientDraftFamily = atomFamily((_id: string) => atom(""));

/**
 * The words a composer's draft has, as last written: what a composer starts
 * from as it mounts, and what is added to when no composer is mounted. The
 * composer itself has what is being typed, which reaches this a beat later.
 */
export const storedWordsAtom = atomFamily(
  (key: PromptDraftKey) =>
    atom((get) => {
      switch (key.scope) {
        case "chat": {
          return (
            replyInBox(get(draftsAtom), get(chatBoxesAtom), key.chatId)
              ?.words ?? ""
          );
        }
        case "draft": {
          return (
            get(draftsAtom).find((draft) => draft.id === key.draftId)?.words ??
            ""
          );
        }
        case "transient": {
          return get(transientDraftFamily(key.id));
        }
      }
    }),
  isEqual,
);

/** Writes a composer's words into its draft now. */
const commitWordsAtom = atom(
  null,
  (_get, set, { key, words }: { key: PromptDraftKey; words: string }) => {
    switch (key.scope) {
      case "chat": {
        set(keepChatBoxAtom, { chatId: key.chatId, words });
        return;
      }
      case "draft": {
        set(updateDraftAtom, {
          id: key.draftId,
          update: (draft) => ({ ...draft, words }),
        });
        return;
      }
      case "transient": {
        set(transientDraftFamily(key.id), words);
        return;
      }
    }
  },
);

/**
 * What a composer was typed into: written into its draft once the typing
 * settles. A transient composer keeps nothing, so its words are set at once.
 */
export const typedWordsAtom = atom(
  null,
  (_get, set, { key, words }: { key: PromptDraftKey; words: string }) => {
    if (key.scope === "transient") {
      set(commitWordsAtom, { key, words });
      return;
    }
    settleWords(draftKeyString(key), () => {
      set(commitWordsAtom, { key, words });
    });
  },
);

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
  storedWordsAtom.remove({ id, scope: "transient" });
  promptDraftRefFamily.remove(draftKeyString({ id, scope: "transient" }));
}

/**
 * What each new chat's composer had besides its words when it was last put
 * away, by draft id: the files and folders it was given, put back when the
 * draft comes up again. In memory only, since bytes do not belong in storage.
 */
export const draftSnapshotsAtom = atom<Record<string, PromptInputDraft>>({});

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
      // when it comes back, once what was typed into it last is in them.
      flushWords(draftKeyString(key));
      const previous = get(storedWordsAtom(key)).trimEnd();
      set(commitWordsAtom, {
        key,
        words: (previous ? previous + " " : "") + text + " ",
      });
      return;
    }
    editor.focus();
    editor.insertText(text);
  },
);

/**
 * Dictated words for a draft: at the end, after a space on its last line,
 * whether or not its composer is still up. A composer that
 * went away while the words were being transcribed gets them in its stored
 * value, which is what it is built from when it comes back.
 */
export const appendDictationToPromptAtom = atom(
  null,
  (get, set, { key, text }: { key: PromptDraftKey; text: string }) => {
    const editor = get(promptDraftRefAtom(key));
    if (editor) {
      editor.appendDictation(text);
      return;
    }
    // Marked as dictated, as the composer marks them, so the model still
    // hears they were spoken once the draft comes back.
    flushWords(draftKeyString(key));
    set(commitWordsAtom, {
      key,
      words: appendDictatedText(
        get(storedWordsAtom(key)),
        dictatedToken(text.trim()),
      ),
    });
  },
);
