import { type PromptInputDraft } from "@/client/components/prompt-input";
import { type TabId } from "@/shared/tabs";
import { type ChatId } from "@instrument-org/workspace/client";
import { atom, type SetStateAction } from "jotai";
import { atomFamily } from "jotai/utils";
import { ulid } from "ulid";

import { keptAtom } from "@/client/lib/kept-state";
import { DRAFTS_KEY } from "@/shared/kept-state";

/** A file or folder on this computer picked to go with a draft, by its path. */
export interface ChosenItem {
  kind: "file" | "folder";
  path: string;
}

/**
 * A file or folder given to a draft's composer, by its path on disk: what of
 * the composer outlasts the app. Bytes pasted in with no file behind them
 * are written to the draft's own folder first, and kept by that path.
 */
export type DraftAttachment =
  | { kind: "file"; mimeType: string; name: string; path: string; size: number }
  | { kind: "folder"; path: string };

/**
 * A chat not yet started: its words and the topic it will be filed under.
 * What it has gathered (sites, files, folders) is its tab group, kept with
 * the window's tabs under the draft's group key; what its composer holds
 * besides the words is kept in memory beside it, and the part of that with
 * a place on disk in `attached`.
 */
export interface Draft {
  /** What the composer was given that has a place on disk, so it comes back after a relaunch. */
  attached?: DraftAttachment[];
  /**
   * The chat a reply is for. A chat may have several, ready to be sent one
   * after another, and the newest is the one in its box. Absent on a draft
   * that opens a chat of its own, which is what tells the two apart.
   */
  chatId?: ChatId;
  /**
   * Files and folders the person opened the draft on by name, from a menu or
   * a button over them: held for the chat whatever the window moves on to,
   * until the person leaves one out.
   */
  chosen?: ChosenItem[];
  createdAt: number;
  id: string;
  /**
   * The thing the draft was opened over, when the window stood in a place
   * with a tab up: that tab, by its group and id. A pointer rather than a
   * copy or a tab of the draft's own, so the draft says what the screen
   * already gives it and the chat is told about it as it starts. A folder,
   * file, or app's front on one of the window's own tabs is that tab, by its
   * id. A chat on screen is the chat, whether or not its pane is open: what
   * is in it is the chat's, so the draft names the chat and nothing in it.
   */
  included?:
    | { appTabId: TabId }
    | { chat: ChatId }
    | { group: string; tabId: string };
  /** The chips the person left out of the draft, by their keys (see `ContextItem`). */
  leftOut?: string[];
  topicId?: string;
  /**
   * Who settled the topic: the person, by picking or clearing one, or the
   * decision model, from what the draft says. Absent while neither has, which
   * is the only time a draft is filed on its own.
   */
  topicSource?: "chosen" | "suggested";
  updatedAt: number;
  words: string;
}

/** The group key a draft's tabs are kept under. */
export function draftGroupOf(draftId: string): string {
  return `draft:${draftId}`;
}

/** The draft a group key names, if it names one. */
export function draftOfGroup(group: string | undefined): string | undefined {
  return group?.startsWith("draft:") ? group.slice("draft:".length) : undefined;
}

/**
 * Every draft not yet started, newest last, kept across launches as a folder
 * each in the workspace's `drafts/`: a draft put away is still in Drafts, and
 * one whose folder is deleted is gone.
 */
export const draftsAtom = keptAtom<Draft[]>("drafts", DRAFTS_KEY, []);

/** How long a draft's words are left alone before its record is written. */
const DRAFT_WORDS_SETTLE_MS = 300;

/** Each draft's pending write of its words to its record. */
const draftWordsWrites = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * A draft's words: the one place they are typed into and read from, by the
 * composer, its bar, the Drafts list and the send alike. They start as the
 * record's (a draft made with words in it, or one kept past a launch), and
 * what is typed is written back to the record a beat later rather than on
 * every key: writing the record lays the whole window out again, transcripts
 * and all, and that on each keystroke is felt in the keys.
 */
export const draftWordsAtom = atomFamily((draftId: string) => {
  const typed = atom<null | string>(null);
  const words = atom(
    (get) =>
      get(typed) ??
      get(draftsAtom).find((draft) => draft.id === draftId)?.words ??
      "",
    (get, set, update: SetStateAction<string>) => {
      const next = typeof update === "function" ? update(get(words)) : update;
      set(typed, next);
      clearTimeout(draftWordsWrites.get(draftId));
      draftWordsWrites.set(
        draftId,
        setTimeout(() => {
          draftWordsWrites.delete(draftId);
          set(draftsAtom, (current) =>
            current.map((draft) =>
              draft.id === draftId && draft.words !== next
                ? { ...draft, updatedAt: Date.now(), words: next }
                : draft,
            ),
          );
        }, DRAFT_WORDS_SETTLE_MS),
      );
    },
  );
  return words;
});

/** Lets go of a draft's words, for a draft sent or thrown away. */
export function forgetDraftWords(draftId: string) {
  clearTimeout(draftWordsWrites.get(draftId));
  draftWordsWrites.delete(draftId);
  draftWordsAtom.remove(draftId);
}

/** Which draft each chat's box is writing into, by chat id: see {@link chatBoxDraftsAtom}. */
export type ChatBoxDrafts = Record<string, null | string>;

/**
 * Which draft each chat's box is writing into: the reply it took up, or null
 * where it took up none, which an emptied box and one whose reply has just
 * been sent both are. A chat not named here has taken nothing up yet, so its
 * box reads the newest of the chat's replies, which is what a chat opened for
 * the first time since a launch finds.
 *
 * Held rather than worked out from which reply is newest. A box that worked it
 * out answered differently the moment the draft it was writing into went:
 * emptying the box by hand deleted that draft, and the next words typed landed
 * in another reply the person had already written, over its words, with
 * nothing said and no way back.
 */
export const chatBoxDraftsAtom = atom<ChatBoxDrafts>({});

/**
 * The reply a chat's box is writing into, which is a draft of its own in
 * Drafts: the one it took up, or the newest of the chat's where it has taken
 * none up yet. Nothing at all for a box writing into none, where the next
 * words typed start a reply of their own.
 */
export function replyDraftOf(
  drafts: Draft[],
  boxDrafts: ChatBoxDrafts,
  chatId: ChatId,
): Draft | undefined {
  const writingInto = boxDrafts[chatId];
  if (writingInto === null) {
    return undefined;
  }
  return writingInto === undefined
    ? newestReplyOf(drafts, chatId)
    : drafts.find((draft) => draft.id === writingInto);
}

/** The newest of a chat's replies waiting, which is what a box that has taken none up reads. */
function newestReplyOf(drafts: Draft[], chatId: ChatId): Draft | undefined {
  return drafts
    .filter((draft) => draft.chatId === chatId)
    .reduce<Draft | undefined>(
      (newest, draft) =>
        newest === undefined || draft.updatedAt >= newest.updatedAt
          ? draft
          : newest,
      undefined,
    );
}

/**
 * A chat's replies waiting that its box is not writing into, newest first:
 * what the control over the box counts and offers. Every one of them where
 * the box is writing into none.
 */
export function otherRepliesOf(
  drafts: Draft[],
  boxDrafts: ChatBoxDrafts,
  chatId: ChatId,
): Draft[] {
  const inTheBox = replyDraftOf(drafts, boxDrafts, chatId);
  return drafts
    .filter((draft) => draft.chatId === chatId && draft.id !== inTheBox?.id)
    .toSorted((one, other) => other.updatedAt - one.updatedAt);
}

/**
 * The drafts being sent, which are not deleted for having no words: the box
 * empties on submit, a beat before the send lands, and a send that fails
 * puts the words back into the draft they came from.
 */
const draftsBeingSent = new Set<string>();

/**
 * Holds a draft through a send: the words it is being sent with are left
 * alone, and it is not deleted for being empty. Answers with what to call
 * when the send has settled.
 */
export function holdDraftWhileSending(draftId: string): () => void {
  draftsBeingSent.add(draftId);
  return () => {
    draftsBeingSent.delete(draftId);
  };
}

/**
 * The words in a chat's own box: a draft of the chat's in Drafts, like the
 * draft a new chat is written in, so a reply left half-typed is on disk
 * where the person can find it, survives a relaunch, and can be read on
 * another device.
 *
 * Nothing is written while someone is typing: the draft is made when the
 * typing settles, and the id is minted then, so no draft is ever written
 * under an id a sent one had. A box emptied by hand takes its draft with it,
 * unless something was pasted or attached into it.
 */
export const chatDraftWordsAtom = atomFamily((chatId: ChatId) => {
  const typed = atom<null | string>(null);
  const words = atom(
    (get) =>
      get(typed) ??
      replyDraftOf(get(draftsAtom), get(chatBoxDraftsAtom), chatId)?.words ??
      "",
    (get, set, update: SetStateAction<string>) => {
      const next = typeof update === "function" ? update(get(words)) : update;
      set(typed, next);
      const key = boxWriteKey(chatId);
      clearTimeout(draftWordsWrites.get(key));
      draftWordsWrites.set(
        key,
        setTimeout(() => {
          set(keepChatBoxAtom, { chatId, words: next });
        }, DRAFT_WORDS_SETTLE_MS),
      );
    },
  );
  return words;
});

/** Where a chat's box keeps the write it has pending, among {@link draftWordsWrites}. */
function boxWriteKey(chatId: ChatId): string {
  return `chat:${chatId}`;
}

/** Lets go of a chat's box, for a reply sent: its next words start a new draft. */
export function forgetChatDraftWords(chatId: ChatId) {
  clearTimeout(draftWordsWrites.get(boxWriteKey(chatId)));
  draftWordsWrites.delete(boxWriteKey(chatId));
  chatDraftWordsAtom.remove(chatId);
}

/**
 * A reply draft for a chat's box, made now and written into from here: for
 * words typed into a box that was writing into none, and for a paste, which
 * is on disk the moment it arrives and so needs a draft of its own before any
 * words have settled into one. Answers with its id.
 */
export const makeReplyDraftAtom = atom(
  null,
  (
    _get,
    set,
    { chatId, words = "" }: { chatId: ChatId; words?: string },
  ): string => {
    const now = Date.now();
    const made: Draft = {
      chatId,
      createdAt: now,
      id: ulid(),
      updatedAt: now,
      words,
    };
    set(draftsAtom, (current) => [...current, made]);
    set(chatBoxDraftsAtom, (current) => ({ ...current, [chatId]: made.id }));
    return made.id;
  },
);

/**
 * Writes what is in a chat's box into the draft it is writing into, and says
 * which draft that is from here on. A draft is made where the box was writing
 * into none and there is something to keep, and taken away where the box was
 * emptied by hand and nothing was pasted or attached into it: an emptied box
 * is writing into nothing, so the next words typed start a reply of their own
 * instead of landing in another one waiting.
 */
const keepChatBoxAtom = atom(
  null,
  (get, set, { chatId, words }: { chatId: ChatId; words: string }) => {
    const key = boxWriteKey(chatId);
    clearTimeout(draftWordsWrites.get(key));
    draftWordsWrites.delete(key);
    const draft = replyDraftOf(get(draftsAtom), get(chatBoxDraftsAtom), chatId);
    // Words in a box writing into no draft are a reply of their own, and so
    // are words in a box whose draft is on its way to the chat: the box
    // empties on submit, a beat before the send lands, and that draft keeps
    // the words it is being sent with, so a send the workspace rejects still
    // has them and so does the next launch after a crash.
    if (!draft || draftsBeingSent.has(draft.id)) {
      if (words.trim() !== "") {
        set(makeReplyDraftAtom, { chatId, words });
      }
      return;
    }
    if (words.trim() === "" && (draft.attached ?? []).length === 0) {
      set(draftsAtom, (current) =>
        current.filter((entry) => entry.id !== draft.id),
      );
      set(chatBoxDraftsAtom, (current) => ({ ...current, [chatId]: null }));
      return;
    }
    if (draft.words !== words) {
      set(draftsAtom, (current) =>
        current.map((entry) =>
          entry.id === draft.id
            ? { ...entry, updatedAt: Date.now(), words }
            : entry,
        ),
      );
    }
    set(chatBoxDraftsAtom, (current) =>
      current[chatId] === draft.id
        ? current
        : { ...current, [chatId]: draft.id },
    );
  },
);

/**
 * The reply a chat has just sent: its draft goes, because the message naming
 * it is written, and the box is writing into nothing from here, so the next
 * words typed start a reply of their own rather than landing in one of the
 * replies still waiting. The box lets go of the words it was emptied of as
 * well, unless the person started another reply in it while the send was in
 * flight: those words are that reply's.
 */
export const replySentAtom = atom(
  null,
  (get, set, { chatId, draftId }: { chatId: ChatId; draftId: string }) => {
    set(draftsAtom, (current) =>
      current.filter((entry) => entry.id !== draftId),
    );
    const writingInto = get(chatBoxDraftsAtom)[chatId];
    if (writingInto === draftId || writingInto === undefined) {
      set(chatBoxDraftsAtom, (current) => ({ ...current, [chatId]: null }));
      forgetChatDraftWords(chatId);
    }
  },
);

/**
 * Puts one of a chat's waiting replies in its box: the box writes into that
 * draft from here, and the one picked is stamped now, so a launch, which
 * reads the newest, finds in the box the reply the person last had there.
 *
 * Answers with the draft now in the box, because the composer has to be
 * given its words and what was attached to it: the document in the box is
 * the editor's own, and nothing here can write it.
 */
export const swapInReplyDraftAtom = atom(
  null,
  (
    get,
    set,
    { chatId, draftId }: { chatId: ChatId; draftId: string },
  ): Draft | undefined => {
    const leaving = replyDraftOf(
      get(draftsAtom),
      get(chatBoxDraftsAtom),
      chatId,
    );
    if (leaving?.id === draftId) {
      return leaving;
    }
    // Read while the box is still the leaving draft's, and written to that
    // draft below. The write that was pending for it is dropped here rather
    // than left to the box's own setter further down: what must not happen
    // is a write made against the old box landing a beat after the swap.
    const words = get(chatDraftWordsAtom(chatId));
    const key = boxWriteKey(chatId);
    clearTimeout(draftWordsWrites.get(key));
    draftWordsWrites.delete(key);
    set(draftsAtom, (current) =>
      current.map((draft) => {
        if (draft.id === draftId) {
          return { ...draft, updatedAt: Date.now() };
        }
        // The one leaving keeps the stamp it had: stamped now as well, it
        // would be the newest and a launch would find it in the box instead
        // of the reply just picked.
        return draft.id === leaving?.id && draft.words !== words
          ? { ...draft, words }
          : draft;
      }),
    );
    // Words typed into a box that was writing into no draft are the person's
    // too, so they stay as a reply of their own rather than going with the
    // one picked.
    if (!leaving && words.trim() !== "") {
      set(makeReplyDraftAtom, { chatId, words });
    }
    const picked = get(draftsAtom).find((draft) => draft.id === draftId);
    if (picked) {
      set(chatBoxDraftsAtom, (current) => ({
        ...current,
        [chatId]: picked.id,
      }));
      // The box reads what was last typed in it before it reads the draft,
      // so those words are replaced rather than left standing over the reply
      // just swapped in.
      set(chatDraftWordsAtom(chatId), picked.words);
    }
    return picked;
  },
);

/**
 * What each draft's composer held besides its words when it was last put
 * away, by draft id: the files and folders it was given, restored when the
 * draft comes back up. In memory only, since bytes do not belong in storage.
 */
export const draftSnapshotsAtom = atom<Record<string, PromptInputDraft>>({});
