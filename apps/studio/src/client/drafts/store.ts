import {
  createOpMirror,
  memoryMirrorBridge,
  type MirrorSync,
  rebaseMirror,
  shownOf,
} from "@/client/lib/op-mirror";
import {
  applyDraftOps,
  type Draft,
  type DraftOp,
  type DraftsBridge,
  type DraftsSnapshot,
  type DraftTrashRequest,
  draftUpdateOf,
  holdsSomething,
  repliesOf,
} from "@/shared/drafts";
import { type ChatId } from "@instrument-org/workspace/client";
import { atom } from "jotai";
import { atomFamily, selectAtom } from "jotai/utils";

/**
 * The drafts as this window shows them: main's (`shared/drafts.ts`), with the
 * ops this window has sent and main has not yet applied laid over them
 * (`client/lib/op-mirror.ts`).
 */

export type Sync = MirrorSync<DraftsSnapshot, DraftOp>;

const memory = memoryMirrorBridge<DraftsSnapshot, DraftOp>(
  { acks: {}, drafts: [] },
  (snapshot, ops) => ({
    ...snapshot,
    drafts: applyDraftOps(snapshot.drafts, ops),
  }),
);

/** Main's side, or drafts kept in this window's memory where there is no main (tests, a browser). */
const bridge: DraftsBridge & { reset?: (drafts: Draft[]) => void } = globalThis
  .window?.api?.drafts ?? {
  ...memory,
  reset: (drafts) => {
    memory.reset({ acks: {}, drafts });
  },
  stage: (request) =>
    Promise.resolve({
      path: `/drafts/${request.draftId}/${request.name}`,
      size: request.content.length,
    }),
  trash: () => Promise.resolve(),
};

const showDrafts = (snapshot: DraftsSnapshot, pending: DraftOp[]) =>
  applyDraftOps(snapshot.drafts, pending);

const mirror = createOpMirror({ bridge, show: showDrafts });

/**
 * Takes in a snapshot from main: it is what the drafts are, and each of this
 * window's batches it says main applied is off the stack.
 */
export function rebase(
  sync: Sync,
  snapshot: DraftsSnapshot,
  client?: string,
): Sync {
  return rebaseMirror(sync, snapshot, client);
}

/** The drafts a window shows: main's, with its own batches still on their way applied over them. */
export function shownDrafts(sync: Sync): Draft[] {
  return shownOf(sync, showDrafts);
}

/** Every draft, oldest first, as this window shows them. */
export const draftsAtom = mirror.shownAtom;

/**
 * Sends ops to main and shows them at once. Answers once main has applied
 * them and written them through; a batch main refused is taken back off, so
 * the window shows what main has.
 */
export const applyDraftOpsAtom = mirror.applyOpsAtom;

/** Writes pasted bytes into a draft's own folder; answers where they went. */
export function stageIntoDraft(request: {
  content: string;
  draftId: string;
  itemId: string;
  name: string;
}): Promise<{ path: string; size: number }> {
  return bridge.stage(request);
}

/** Moves something taken out of a draft to the Trash, where it is in the draft's folder. */
export function trashFromDraft(request: DraftTrashRequest): Promise<void> {
  return bridge.trash(request);
}

/** A draft made, with what it starts with. */
export const createDraftAtom = atom(null, (_get, set, draft: Draft) => {
  void set(applyDraftOpsAtom, [{ draft, type: "create" }]);
});

/**
 * A draft changed by a function of the whole draft, sent as the fields that
 * changed. Stamped as changed now unless `stamp` is false, which is for a
 * change that should not make the draft the newest.
 */
export const updateDraftAtom = atom(
  null,
  (
    get,
    set,
    {
      id,
      stamp = true,
      update,
    }: { id: string; stamp?: boolean; update: (draft: Draft) => Draft },
  ) => {
    const draft = get(draftsAtom).find((entry) => entry.id === id);
    if (draft === undefined) {
      return;
    }
    const op = draftUpdateOf(draft, update(draft), stamp ? Date.now() : null);
    if (op) {
      void set(applyDraftOpsAtom, [op]);
    }
  },
);

/** A draft thrown away, with what was pasted into it. */
export const removeDraftAtom = atom(null, (_get, set, id: string) => {
  void set(applyDraftOpsAtom, [{ id, type: "remove" }]);
});

/**
 * The first step of a send: the draft is pointed at the chat it is going
 * into, with the words it is going with. Answers once that is on disk, which
 * has to be before anything is written in the chat: the message naming the
 * draft is what says it was sent, and a launch after a crash finds that
 * message by the chat the draft names.
 */
export const claimDraftAtom = atom(
  null,
  (
    _get,
    set,
    { chatId, id, words }: { chatId: ChatId; id: string; words: string },
  ): Promise<void> =>
    set(applyDraftOpsAtom, [
      { at: Date.now(), chatId, id, type: "claim", words },
    ]),
);

/** A send that failed: the draft is the person's again. */
export const releaseDraftAtom = atom(null, (_get, set, id: string) => {
  void set(applyDraftOpsAtom, [{ id, type: "release" }]);
});

/** A send that landed: the message naming the draft is written, so the draft goes. */
export const draftSentAtom = atom(null, (_get, set, id: string) => {
  void set(applyDraftOpsAtom, [{ id, type: "sent" }]);
});

/** Whether a chat has a reply waiting with something in it, which its row in the inbox says. */
export const hasReplyWaitingAtom = atomFamily((chatId: ChatId) =>
  selectAtom(draftsAtom, (drafts) =>
    repliesOf(drafts, chatId).some((draft) => holdsSomething(draft)),
  ),
);

/**
 * Starts the drafts over with these, for tests, which share one module
 * between them. Only where there is no main to own them.
 */
export function resetDrafts(drafts: Draft[] = []) {
  bridge.reset?.(drafts);
}
