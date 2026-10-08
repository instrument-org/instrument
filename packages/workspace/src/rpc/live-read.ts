import { mergeGenerators } from "@instrument-org/shared/merge-generators";
import { isEqual } from "radashi";

/**
 * A `live.*` answer: one read, then a read again after each burst of
 * `changes`.
 *
 * Hand it `changes` already subscribed, which `publisher.subscribe(...)` in
 * the argument list does: they are listening before the first read starts,
 * so a change that lands during that read, or while its answer is on the
 * way to the client, is heard and read again rather than lost. A burst of
 * changes that arrives while a read is under way costs one more read, not
 * one per change.
 */
export async function* liveRead<T>({
  changes,
  read,
}: {
  changes: AsyncIterable<unknown>[];
  read: () => Promise<T> | T;
}): AsyncGenerator<T> {
  const fired = collapsed(mergeGenerators(changes.map(everyOne)));
  try {
    yield await read();
    for await (const _ of fired) {
      yield await read();
    }
  } finally {
    await fired.return(undefined);
  }
}

/**
 * The answers of a live read that differ from the one before, so a change
 * that moved nothing a reader shows sends it nothing.
 */
export async function* distinct<T>(
  source: AsyncIterable<T>,
): AsyncGenerator<T> {
  let last: { value: T } | undefined;
  for await (const value of source) {
    if (last === undefined || !isEqual(value, last.value)) {
      last = { value };
      yield value;
    }
  }
}

/** Only the values `keep` accepts, such as the events for one task. */
export async function* where<T>(
  source: AsyncIterable<T>,
  keep: (value: T) => boolean,
): AsyncGenerator<T> {
  for await (const value of source) {
    if (keep(value)) {
      yield value;
    }
  }
}

/**
 * One firing for however many events landed since the consumer last came
 * back: a reader that re-reads everything on each firing does it once per
 * read, not once per event that arrived during the read.
 */
export async function* collapsed(source: AsyncGenerator) {
  const state: {
    /** What ended the source, handed to the consumer as the source would have. */
    failure?: { error: unknown };
    finished: boolean;
    pending: boolean;
    wake?: () => void;
  } = { finished: false, pending: false };
  // Read through a call each time: the pump changes these between awaits.
  const isPending = () => state.pending;
  const isFinished = () => state.finished;
  void (async () => {
    try {
      for await (const _event of source) {
        state.pending = true;
        state.wake?.();
      }
    } catch (error) {
      state.failure = { error };
    } finally {
      state.finished = true;
      state.wake?.();
    }
  })();
  try {
    while (true) {
      if (!isPending() && !isFinished()) {
        await new Promise((resolve) => {
          state.wake = () => {
            resolve(undefined);
          };
        });
        state.wake = undefined;
      }
      if (!isPending()) {
        if (state.failure) {
          throw state.failure.error;
        }
        return;
      }
      state.pending = false;
      yield null;
    }
  } finally {
    // Not awaited: the source may be waiting on an event that ends only when
    // the request's signal does.
    void source.return(undefined);
  }
}

/** One firing per event, whatever it carries. */
export async function* everyOne(source: AsyncIterable<unknown>) {
  for await (const _payload of source) {
    yield null;
  }
}
