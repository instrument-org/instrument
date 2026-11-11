import { type Draft, isLeftEmpty } from "@/shared/drafts";
import { atom } from "jotai";
import { ulid } from "ulid";

import { flushWords } from "./settle-words";
import { applyDraftOpsAtom, draftsAtom } from "./store";

/**
 * The new chat written in the Chat screen with no chat open, one per window
 * tab, and the draft it writes into.
 *
 * Nothing is made by opening the screen or pressing New: the draft is made
 * with the first words typed (or the first thing pasted or opened beside
 * it), so walking past the screen leaves nothing in Drafts. Until then the
 * box remembers only the project the person picked for it, which the draft
 * is filed under once it is made.
 */
export interface NewChatBox {
  /** The draft it writes into, or null before there is one. */
  draftId: null | string;
  /**
   * Whether the box made that draft itself, from what was written in it,
   * rather than taking it up from the tab's address: only a draft made here
   * is one the address has yet to name.
   */
  isMadeHere?: boolean;
  /** The project picked while there was no draft yet, for the draft to be filed under. */
  projectId?: string;
}

/** Each window tab's new chat, by the tab's id. A tab not named here writes into nothing yet. */
export const newChatBoxesAtom = atom<Partial<Record<string, NewChatBox>>>({});

/** Where a tab's new chat keeps the words it has waiting to be written, among the composers'. */
export function newChatWordsKey(tabId: string): string {
  return `new-chat:${tabId}`;
}

/** The draft a tab's new chat writes into, while it is there. */
export function draftInNewChatBox(
  drafts: Draft[],
  boxes: Partial<Record<string, NewChatBox>>,
  tabId: string,
): Draft | undefined {
  const id = boxes[tabId]?.draftId;
  return id === null || id === undefined
    ? undefined
    : drafts.find((draft) => draft.id === id);
}

/**
 * Whether a tab's new chat was emptied of everything it had, so its draft is
 * thrown away. The box counts as well as the draft: a paste makes the draft
 * before its bytes are written into the draft's folder, so for a moment the
 * draft has nothing while the box shows the picture, and throwing it away
 * then takes the picture to the Trash with it.
 */
export function isNewChatEmptied(
  draft: Draft | undefined,
  { hasTabs, isBoxEmpty }: { hasTabs: boolean; isBoxEmpty: boolean },
): boolean {
  return (
    draft !== undefined &&
    draft.sendingTo === undefined &&
    isBoxEmpty &&
    isLeftEmpty(draft, { hasTabs })
  );
}

/**
 * Points a tab's new chat at a draft its address names, or at none, keeping
 * the project picked for it. Words still settling were typed into the draft
 * being left, and their write finds its draft through the box, so they land
 * before it moves.
 */
export const bindNewChatBoxAtom = atom(
  null,
  (get, set, { draftId, tabId }: { draftId: null | string; tabId: string }) => {
    if (get(newChatBoxesAtom)[tabId]?.draftId === draftId) {
      return;
    }
    flushWords(newChatWordsKey(tabId));
    const boxes = get(newChatBoxesAtom);
    const { isMadeHere: _was, ...box } = boxes[tabId] ?? { draftId: null };
    set(newChatBoxesAtom, { ...boxes, [tabId]: { ...box, draftId } });
  },
);

/** The project a tab's new chat is filed under before it has a draft. */
export const pickNewChatProjectAtom = atom(
  null,
  (
    get,
    set,
    { projectId, tabId }: { projectId: string | undefined; tabId: string },
  ) => {
    const boxes = get(newChatBoxesAtom);
    const { projectId: _was, ...rest } = boxes[tabId] ?? { draftId: null };
    set(newChatBoxesAtom, {
      ...boxes,
      [tabId]: projectId === undefined ? rest : { ...rest, projectId },
    });
  },
);

/**
 * The draft made for a tab's new chat, and written into from here: for its
 * first words, and for a paste or a page opened beside it, which need a
 * draft before any words have settled into one. Filed under the project
 * picked for it, or the one the caller names. Answers with its id.
 */
export const makeNewChatDraftAtom = atom(
  null,
  (
    get,
    set,
    {
      projectId,
      tabId,
      words = "",
    }: { projectId?: string; tabId: string; words?: string },
  ): string => {
    const filed = get(newChatBoxesAtom)[tabId]?.projectId ?? projectId;
    const now = Date.now();
    const draft: Draft = {
      createdAt: now,
      id: ulid(),
      ...(filed === undefined
        ? {}
        : { projectId: filed, projectSource: "chosen" }),
      updatedAt: now,
      words,
    };
    void set(applyDraftOpsAtom, [{ draft, type: "create" }]);
    set(newChatBoxesAtom, (boxes) => ({
      ...boxes,
      [tabId]: { draftId: draft.id, isMadeHere: true },
    }));
    return draft.id;
  },
);

/**
 * Writes what is in a tab's new chat into its draft, making the draft with
 * the first words. An emptied box keeps its draft here: whether a draft
 * with no words still has something to keep (a file, a page beside it) is
 * the screen's to say, since only it sees the pages.
 */
export const keepNewChatBoxAtom = atom(
  null,
  (get, set, { tabId, words }: { tabId: string; words: string }) => {
    const draft = draftInNewChatBox(
      get(draftsAtom),
      get(newChatBoxesAtom),
      tabId,
    );
    if (draft === undefined) {
      if (words.trim() !== "") {
        set(makeNewChatDraftAtom, { tabId, words });
      }
      return;
    }
    if (draft.words !== words) {
      void set(applyDraftOpsAtom, [
        { at: Date.now(), id: draft.id, set: { words }, type: "update" },
      ]);
    }
  },
);
