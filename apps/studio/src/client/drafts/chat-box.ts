import { type Draft, holdsSomething, repliesOf } from "@/shared/drafts";
import { type ChatId } from "@instrument-org/workspace/client";
import { atom } from "jotai";
import { ulid } from "ulid";

import { cancelWords, flushWords } from "./settle-words";
import {
  applyDraftOpsAtom,
  claimDraftAtom,
  draftsAtom,
  draftSentAtom,
  releaseDraftAtom,
} from "./store";

/**
 * A chat's own box, and the reply waiting in it.
 *
 * A reply is a draft of the chat's in Drafts, like the draft a new chat is
 * written in, so a reply left half-typed is on disk where the person can find
 * it, survives a relaunch, and can be read on another device. A chat may have
 * several, and its box writes into one of them at a time.
 */

/**
 * Which reply each chat's box is writing into, in this window: the one it
 * took up, or null where it took up none, which an emptied box and one whose
 * reply was just sent both are. A chat not named here has taken nothing up
 * yet, so its box reads the newest of the chat's replies, which is what a
 * chat opened for the first time since a launch finds.
 *
 * Held rather than worked out from which reply is newest: a box that worked
 * it out would, the moment the reply it was writing into went, land the next
 * words typed in another reply the person had already written.
 */
export type ChatBoxes = Partial<Record<ChatId, null | string>>;

export const chatBoxesAtom = atom<ChatBoxes>({});

/** The reply a chat's box is writing into, or nothing for a box writing into none. */
export function replyInBox(
  drafts: Draft[],
  boxes: ChatBoxes,
  chatId: ChatId,
): Draft | undefined {
  const writingInto = boxes[chatId];
  if (writingInto === null) {
    return undefined;
  }
  const replies = repliesOf(drafts, chatId);
  return writingInto === undefined
    ? newestOf(replies)
    : replies.find((draft) => draft.id === writingInto);
}

/**
 * A chat's replies waiting that its box is not writing into, newest first:
 * what the control over the box counts and offers.
 */
export function otherRepliesOf(
  drafts: Draft[],
  boxes: ChatBoxes,
  chatId: ChatId,
): Draft[] {
  const inTheBox = replyInBox(drafts, boxes, chatId);
  return repliesOf(drafts, chatId)
    .filter((draft) => draft.id !== inTheBox?.id)
    .toSorted((one, other) => other.updatedAt - one.updatedAt);
}

function newestOf(drafts: Draft[]): Draft | undefined {
  return drafts.reduce<Draft | undefined>(
    (newest, draft) =>
      newest === undefined || draft.updatedAt >= newest.updatedAt
        ? draft
        : newest,
    undefined,
  );
}

/** Where a chat's box keeps the words it has waiting to be written, among the composers'. */
export function chatBoxWordsKey(chatId: ChatId): string {
  return `chat:${chatId}`;
}

const bindBoxAtom = atom(
  null,
  (
    _get,
    set,
    { chatId, draftId }: { chatId: ChatId; draftId: null | string },
  ) => {
    set(chatBoxesAtom, (boxes) =>
      boxes[chatId] === draftId ? boxes : { ...boxes, [chatId]: draftId },
    );
  },
);

/**
 * A chat's box as it first draws: it writes into the reply it shows, or into
 * nothing where it shows none, from here on. Held from the start, so a reply
 * that arrives later (another window's, another device's) is one waiting
 * rather than the one the box writes its next words into.
 */
export const takeUpBoxAtom = atom(null, (get, set, chatId: ChatId) => {
  if (get(chatBoxesAtom)[chatId] !== undefined) {
    return;
  }
  set(bindBoxAtom, {
    chatId,
    draftId:
      replyInBox(get(draftsAtom), get(chatBoxesAtom), chatId)?.id ?? null,
  });
});

/**
 * A reply made for a chat's box, and written into from here: for words typed
 * into a box writing into none, and for a paste, which is on disk the moment
 * it arrives and so needs a draft before any words have settled into one.
 * Answers with its id.
 */
export const makeReplyAtom = atom(
  null,
  (
    _get,
    set,
    { chatId, words = "" }: { chatId: ChatId; words?: string },
  ): string => {
    const now = Date.now();
    const draft: Draft = {
      chatId,
      createdAt: now,
      id: ulid(),
      updatedAt: now,
      words,
    };
    void set(applyDraftOpsAtom, [{ draft, type: "create" }]);
    set(bindBoxAtom, { chatId, draftId: draft.id });
    return draft.id;
  },
);

/**
 * Writes what is in a chat's box into the reply it is writing into. A reply
 * is made where the box was writing into none and there is something to
 * keep, and taken away where the box was emptied by hand and nothing was
 * pasted or attached into it: an emptied box is writing into nothing, so the
 * next words typed start a reply of their own instead of landing in another.
 */
export const keepChatBoxAtom = atom(
  null,
  (get, set, { chatId, words }: { chatId: ChatId; words: string }) => {
    const draft = replyInBox(get(draftsAtom), get(chatBoxesAtom), chatId);
    if (draft === undefined) {
      if (words.trim() !== "") {
        set(makeReplyAtom, { chatId, words });
      }
      return;
    }
    if (!holdsSomething({ ...draft, words })) {
      void set(applyDraftOpsAtom, [{ id: draft.id, type: "remove" }]);
      set(bindBoxAtom, { chatId, draftId: null });
      return;
    }
    if (draft.words !== words) {
      void set(applyDraftOpsAtom, [
        { at: Date.now(), id: draft.id, set: { words }, type: "update" },
      ]);
    }
    set(bindBoxAtom, { chatId, draftId: draft.id });
  },
);

/**
 * The press of send in a chat's box: the reply in it is claimed for the chat
 * with the words it is sent with, and the box writes into nothing from here,
 * so what is typed while the send is in flight is a reply of its own.
 * Answers with the reply being sent, if the box was writing into one, and
 * when its claim is on disk.
 */
export const beginReplySendAtom = atom(
  null,
  (
    get,
    set,
    { chatId, words }: { chatId: ChatId; words: string },
  ): undefined | { claimed: Promise<void>; draftId: string } => {
    cancelWords(chatBoxWordsKey(chatId));
    const draft = replyInBox(get(draftsAtom), get(chatBoxesAtom), chatId);
    set(bindBoxAtom, { chatId, draftId: null });
    if (draft === undefined) {
      return undefined;
    }
    return {
      claimed: set(claimDraftAtom, { chatId, id: draft.id, words }),
      draftId: draft.id,
    };
  },
);

/**
 * A reply's send settled. One that landed is gone. One that failed is the
 * person's again, and back in the box where nothing was typed since, so the
 * words put back there write into it rather than into a copy.
 */
export const settleReplySendAtom = atom(
  null,
  (
    get,
    set,
    { chatId, draftId, ok }: { chatId: ChatId; draftId: string; ok: boolean },
  ) => {
    if (ok) {
      set(draftSentAtom, draftId);
      return;
    }
    set(releaseDraftAtom, draftId);
    // Words typed since the press, written now, are a reply of their own and
    // take the box; only a box still writing into nothing takes this one back.
    flushWords(chatBoxWordsKey(chatId));
    if (get(chatBoxesAtom)[chatId] === null) {
      set(bindBoxAtom, { chatId, draftId });
    }
  },
);

/**
 * Puts one of a chat's waiting replies in its box. The words the box has now
 * stay with the reply leaving, or become a reply of their own where the box
 * was writing into none. The one picked is stamped now, so a launch, which
 * reads the newest, finds in the box the reply the person last had there.
 *
 * Answers with the reply now in the box, since the composer has to be given
 * its words and what was attached to it.
 */
export const swapInReplyAtom = atom(
  null,
  (
    get,
    set,
    {
      chatId,
      draftId,
      words,
    }: {
      chatId: ChatId;
      draftId: string;
      /** What the box has in it as the swap is asked for. */
      words: string;
    },
  ): Draft | undefined => {
    const drafts = get(draftsAtom);
    const leaving = replyInBox(drafts, get(chatBoxesAtom), chatId);
    if (leaving?.id === draftId) {
      return leaving;
    }
    const picked = repliesOf(drafts, chatId).find(
      (draft) => draft.id === draftId,
    );
    if (picked === undefined) {
      return undefined;
    }
    cancelWords(chatBoxWordsKey(chatId));
    if (leaving === undefined) {
      if (words.trim() !== "") {
        set(makeReplyAtom, { chatId, words });
      }
    } else if (!holdsSomething({ ...leaving, words })) {
      void set(applyDraftOpsAtom, [{ id: leaving.id, type: "remove" }]);
    } else if (leaving.words !== words) {
      // The one leaving keeps the stamp it had: stamped now, it would be the
      // newest and a launch would find it in the box instead of the one picked.
      void set(applyDraftOpsAtom, [
        { id: leaving.id, set: { words }, type: "update" },
      ]);
    }
    void set(applyDraftOpsAtom, [
      { at: Date.now(), id: picked.id, set: {}, type: "update" },
    ]);
    set(bindBoxAtom, { chatId, draftId: picked.id });
    return picked;
  },
);
