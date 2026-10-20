import { atom } from "jotai";
import { ulid } from "ulid";

/**
 * What a window shows of something main owns and changes by ops (the
 * drafts, the bookmarks): main's latest snapshot, with the batches of ops
 * this window has sent and main has not yet applied laid over it.
 *
 * So a change made here shows at once, and a change main reports from
 * elsewhere (another window, a file manager, another device) lands under the
 * ones still on their way rather than over them: main applies those after it,
 * and says so in the next snapshot it sends by acking the batch, which is
 * when it comes off.
 */

/** This window, among the ones sending main ops. */
const CLIENT = ulid();

/** A batch of ops from one window, numbered so main can say which it has applied. */
interface OpBatch<Op> {
  /** The window sending, by the id it made for itself as it loaded. */
  client: string;
  ops: Op[];
  /** Counts up per window; the batch is applied once an ack reaches it. */
  seq: number;
}

/** Main's snapshot as a window receives it: whatever it holds, and by window the `seq` of the last batch it applied. */
export interface AckedSnapshot {
  acks: Record<string, number>;
}

/** What a window has heard from main and sent it. */
export interface MirrorSync<S, Op> {
  /** What main last said. */
  confirmed: S;
  /** This window's batches main had not applied as of {@link confirmed}, oldest first. */
  pending: OpBatch<Op>[];
}

/** Main's side, as the preload hands it over. */
interface MirrorBridge<S, Op> {
  apply: (batch: OpBatch<Op>) => Promise<void>;
  initial: S;
  onChange: (listener: (snapshot: S) => void) => () => void;
}

/**
 * Takes in a snapshot from main: it is what main has, and each of this
 * window's batches it acks is off the stack.
 */
export function rebaseMirror<S extends AckedSnapshot, Op>(
  sync: MirrorSync<S, Op>,
  snapshot: S,
  client = CLIENT,
): MirrorSync<S, Op> {
  const applied = snapshot.acks[client] ?? 0;
  return {
    confirmed: snapshot,
    pending: sync.pending.filter((batch) => batch.seq > applied),
  };
}

/**
 * A window's mirror of main's state over `bridge`. `show` turns main's
 * snapshot and the ops still on their way, oldest first, into what the
 * window shows.
 */
export function createOpMirror<S extends AckedSnapshot, Op, T>({
  bridge,
  show,
}: {
  bridge: MirrorBridge<S, Op>;
  show: (snapshot: S, pending: Op[]) => T;
}) {
  let lastSeq = 0;

  /**
   * The newest snapshot main has sent, kept from the moment the window loads
   * rather than from whenever something first reads it, so a change main
   * sends before the first render is not missed.
   */
  let latest = bridge.initial;
  const listeners = new Set<(snapshot: S) => void>();
  bridge.onChange((snapshot) => {
    latest = snapshot;
    for (const listener of listeners) {
      listener(snapshot);
    }
  });

  /**
   * What this window has heard and sent. Until something is written here it
   * reads as the newest snapshot with nothing pending, so a mirror read
   * after main changed starts from that.
   */
  const syncStateAtom = atom<MirrorSync<S, Op> | undefined>(undefined);
  const syncAtom = atom(
    (get): MirrorSync<S, Op> =>
      get(syncStateAtom) ?? { confirmed: latest, pending: [] },
    (get, set, update: (sync: MirrorSync<S, Op>) => MirrorSync<S, Op>) => {
      set(syncStateAtom, update(get(syncAtom)));
    },
  );
  syncAtom.onMount = (set) => {
    set((sync) => rebaseMirror(sync, latest));
    const listener = (snapshot: S) => {
      set((sync) => rebaseMirror(sync, snapshot));
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return {
    /**
     * Sends ops to main and shows them at once. Answers once main has
     * applied them and written them through; a batch main refused is taken
     * back off, so the window shows what main has.
     */
    applyOpsAtom: atom(null, async (_get, set, ops: Op[]): Promise<void> => {
      if (ops.length === 0) {
        return;
      }
      lastSeq += 1;
      const batch: OpBatch<Op> = { client: CLIENT, ops, seq: lastSeq };
      set(syncAtom, (sync) => ({ ...sync, pending: [...sync.pending, batch] }));
      try {
        await bridge.apply(batch);
      } catch (error) {
        set(syncAtom, (sync) => ({
          ...sync,
          pending: sync.pending.filter((entry) => entry !== batch),
        }));
        throw error;
      }
    }),
    /** What the window shows: main's, with its own batches still on their way applied over it. */
    shownAtom: atom((get) => shownOf(get(syncAtom), show)),
  };
}

/** What a sync shows, through the mirror's own `show`. */
export function shownOf<S, Op, T>(
  { confirmed, pending }: MirrorSync<S, Op>,
  show: (snapshot: S, pending: Op[]) => T,
): T {
  return show(
    confirmed,
    pending.flatMap((batch) => batch.ops),
  );
}

/**
 * Main's side kept in this window's memory, for where there is no main
 * (tests, a browser): the same ops applied the same way, answered on the
 * next turn the way main's answer arrives.
 */
export function memoryMirrorBridge<S extends AckedSnapshot, Op>(
  initial: S,
  apply: (snapshot: S, ops: Op[]) => S,
): MirrorBridge<S, Op> & { reset: (snapshot: S) => void } {
  let snapshot = initial;
  const heard = new Set<(snapshot: S) => void>();
  const tell = () => {
    for (const listener of heard) {
      listener(snapshot);
    }
  };
  return {
    apply: (batch) => {
      snapshot = {
        ...apply(snapshot, batch.ops),
        acks: { ...snapshot.acks, [batch.client]: batch.seq },
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
    reset: (next) => {
      snapshot = { ...next, acks: snapshot.acks };
      tell();
    },
  };
}
