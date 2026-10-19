import {
  applyDraftOps,
  type Draft,
  type DraftOp,
  type DraftOpBatch,
  type DraftsBridge,
  type DraftsSnapshot,
  draftUpdateOf,
  holdsSomething,
  repliesOf,
} from "@/shared/drafts";
import { type ChatId } from "@instrument-org/workspace/client";
import { atom } from "jotai";
import { atomFamily, selectAtom } from "jotai/utils";
import { ulid } from "ulid";

/**
 * The drafts as this window shows them: main's (`shared/drafts.ts`), with the
 * ops this window has sent and main has not yet applied laid over them.
 *
 * So a change made here shows at once, and a change main reports from
 * elsewhere (another window, a file manager, another device) lands under the
 * ones still on their way rather than over them: main applies those after it,
 * and says so with the next snapshot it sends, which is when they come off.
 */

/** This window, among the ones sending main ops. */
const CLIENT = ulid();

/** The number of this window's last batch. */
let lastSeq = 0;

export interface Sync {
  /** What main last said the drafts are. */
  confirmed: DraftsSnapshot;
  /** This window's batches main had not applied as of {@link confirmed}, oldest first. */
  pending: DraftOpBatch[];
}

/** Main's side, or drafts kept in this window's memory where there is no main (tests, a browser). */
const bridge: DraftsBridge & { reset?: (drafts: Draft[]) => void } =
  globalThis.window?.api?.drafts ?? memoryBridge();

/**
 * The newest snapshot main has sent, kept from the moment the window loads
 * rather than from whenever something first reads the drafts, so a change
 * main sends before the first render is not missed.
 */
let latest = bridge.initial;
const listeners = new Set<(snapshot: DraftsSnapshot) => void>();
bridge.onChange((snapshot) => {
  latest = snapshot;
  for (const listener of listeners) {
    listener(snapshot);
  }
});

/**
 * Takes in a snapshot from main: it is what the drafts are, and each of this
 * window's batches it says main applied is off the stack.
 */
export function rebase(
  sync: Sync,
  snapshot: DraftsSnapshot,
  client = CLIENT,
): Sync {
  const applied = snapshot.acks[client] ?? 0;
  return {
    confirmed: snapshot,
    pending: sync.pending.filter((batch) => batch.seq > applied),
  };
}

/** The drafts a window shows: main's, with its own batches still on their way applied over them. */
export function shownDrafts({ confirmed, pending }: Sync): Draft[] {
  return pending.reduce(
    (drafts, batch) => applyDraftOps(drafts, batch.ops),
    confirmed.drafts,
  );
}

/**
 * What this window has heard and sent. Until something is written here it
 * reads as the newest snapshot with nothing pending, so a store made after
 * the drafts changed starts from those.
 */
const syncStateAtom = atom<Sync | undefined>(undefined);

const syncAtom = atom(
  (get): Sync => get(syncStateAtom) ?? { confirmed: latest, pending: [] },
  (get, set, update: (sync: Sync) => Sync) => {
    set(syncStateAtom, update(get(syncAtom)));
  },
);
syncAtom.onMount = (set) => {
  set((sync) => rebase(sync, latest));
  const listener = (snapshot: DraftsSnapshot) => {
    set((sync) => rebase(sync, snapshot));
  };
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Every draft, oldest first, as this window shows them. */
export const draftsAtom = atom((get) => shownDrafts(get(syncAtom)));

/**
 * Sends ops to main and shows them at once. Answers once main has applied
 * them and written them through; a batch main refused is taken back off, so
 * the window shows what main has.
 */
export const applyDraftOpsAtom = atom(
  null,
  async (_get, set, ops: DraftOp[]): Promise<void> => {
    if (ops.length === 0) {
      return;
    }
    lastSeq += 1;
    const batch: DraftOpBatch = { client: CLIENT, ops, seq: lastSeq };
    set(syncAtom, (sync) => ({
      ...sync,
      pending: [...sync.pending, batch],
    }));
    try {
      await bridge.apply(batch);
    } catch (error) {
      set(syncAtom, (sync) => ({
        ...sync,
        pending: sync.pending.filter((entry) => entry !== batch),
      }));
      throw error;
    }
  },
);

/** Writes pasted bytes into a draft's own folder; answers where they went. */
export function stageIntoDraft(request: {
  content: string;
  draftId: string;
  itemId: string;
  name: string;
}): Promise<{ path: string; size: number }> {
  return bridge.stage(request);
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

/**
 * Drafts kept in this window's memory, for where there is no main to keep
 * them: the same ops applied the same way, answered on the next turn the way
 * main's answer arrives.
 */
function memoryBridge(): DraftsBridge & { reset: (drafts: Draft[]) => void } {
  let snapshot: DraftsSnapshot = { acks: {}, drafts: [] };
  const heard = new Set<(snapshot: DraftsSnapshot) => void>();
  return {
    reset: (drafts) => {
      snapshot = { acks: snapshot.acks, drafts };
      for (const listener of heard) {
        listener(snapshot);
      }
    },
    apply: (batch) => {
      snapshot = {
        acks: { ...snapshot.acks, [batch.client]: batch.seq },
        drafts: applyDraftOps(snapshot.drafts, batch.ops),
      };
      const sent = snapshot;
      return Promise.resolve().then(() => {
        for (const listener of heard) {
          listener(sent);
        }
      });
    },
    initial: snapshot,
    onChange: (listener) => {
      heard.add(listener);
      return () => {
        heard.delete(listener);
      };
    },
    stage: (request) =>
      Promise.resolve({
        path: `/drafts/${request.draftId}/${request.name}`,
        size: request.content.length,
      }),
  };
}
