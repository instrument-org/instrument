import {
  matchScreen,
  newChatHref,
} from "@/client/components/window/window-href";
import { getGroupTabRouter } from "@/client/lib/group-tab-router-registry";
import { type Draft, isLeftEmpty, isOnItsWay } from "@/shared/drafts";
import { atom } from "jotai";
import { ulid } from "ulid";

import { cancelWords, flushWords } from "./settle-words";
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

/**
 * Writes the words still settling in a tab's new chat, and answers the draft
 * the box made for what was written, which the tab's address may not name
 * yet: a screen going away, or its tab closing, has it named there, so the
 * tab comes back with the words.
 */
export function settleMadeDraft(
  store: {
    get: (atom: typeof newChatBoxesAtom) => Partial<Record<string, NewChatBox>>;
  },
  tabId: string,
): string | undefined {
  flushWords(newChatWordsKey(tabId));
  const box = store.get(newChatBoxesAtom)[tabId];
  return box?.isMadeHere === true && box.draftId !== null
    ? box.draftId
    : undefined;
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
 * The project the person filed a tab's new chat under, by its Project button
 * or New in a project: the draft's own once there is one, unless the model
 * only suggested it, and before then the one the box keeps for it.
 */
export function pickedNewChatProject(
  draft: Draft | undefined,
  box: NewChatBox | undefined,
): string | undefined {
  if (draft === undefined) {
    return box?.projectId;
  }
  return draft.projectSource === "suggested" ? undefined : draft.projectId;
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
    !isOnItsWay(draft) &&
    isBoxEmpty &&
    isLeftEmpty(draft, { hasTabs })
  );
}

/**
 * How a new chat's tab closes: at the address of the draft it writes into
 * (`made` is the one words settling as it closes just made), so it reopens
 * with it; or as a new tab with nothing in it where that draft was emptied
 * of everything, which is to be thrown away now (`emptied`), or is gone.
 * Any other tab closes at the address it has.
 */
export function closingNewChat(
  {
    boxes,
    drafts,
  }: { boxes: Partial<Record<string, NewChatBox>>; drafts: Draft[] },
  { href, made, tabId }: { href: string; made?: string; tabId: string },
): { emptied?: string; href: string } {
  const screen = matchScreen(href);
  if (screen.kind !== "inbox") {
    return { href };
  }
  const written = made ?? boxes[tabId]?.draftId ?? screen.draft;
  if (written === undefined || written === null) {
    return { href };
  }
  const draft = drafts.find((each) => each.id === written);
  if (draft === undefined) {
    return { href: newChatHref() };
  }
  if (isNewChatEmptied(draft, { hasTabs: false, isBoxEmpty: true })) {
    return { emptied: draft.id, href: newChatHref() };
  }
  return { href: screen.draft === written ? href : newChatHref(written) };
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
 * picked for it, or the one the caller names. The tab's address names it in
 * the same step, so the tab is kept naming it however soon the app quits.
 * Answers with its id.
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
    getGroupTabRouter(tabId)?.history.replace(newChatHref(draft.id));
    return draft.id;
  },
);

/**
 * Drops a tab's new chat's words, those still settling and the draft they
 * made, and names no draft in its address, keeping the project it was filed
 * under: for words that were an address, as the tab goes there.
 */
export const dropNewChatWordsAtom = atom(
  null,
  (
    get,
    set,
    { projectId, tabId }: { projectId: string | undefined; tabId: string },
  ) => {
    cancelWords(newChatWordsKey(tabId));
    const id = get(newChatBoxesAtom)[tabId]?.draftId ?? null;
    set(newChatBoxesAtom, (boxes) => ({
      ...boxes,
      [tabId]: {
        draftId: null,
        ...(projectId === undefined ? {} : { projectId }),
      },
    }));
    if (id !== null) {
      void set(applyDraftOpsAtom, [{ id, type: "remove" }]);
      getGroupTabRouter(tabId)?.history.replace(newChatHref());
    }
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
