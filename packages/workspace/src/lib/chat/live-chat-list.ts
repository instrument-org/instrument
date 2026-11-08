import { mergeGenerators } from "@instrument-org/shared/merge-generators";
import { isEqual, unique } from "radashi";

import { publisher } from "../../rpc/publisher";
import { collapsed, everyOne } from "../../rpc/live-read";
import { type ChatId } from "../../schemas/chat-id";
import { appListChanges } from "../host-events";
import { type RecordChanged, recordChanges } from "../record-changes";
import { resolveChat } from "../record-folders";
import { listChatIds } from "./chat-records";
import { type Chat, knownAppSlugs, listedChats } from "./chats";

/**
 * How often a chat's row is read again for changes only in memory: a reply
 * streaming in publishes every 100 ms, and the row shows of it only the step
 * it is on.
 */
const LIVE_READ_MS = 500;

/** The chat each change is to. */
function chatsMoved(changes: RecordChanged[]): ChatId[] {
  return unique(
    changes.flatMap((change) => {
      const chat =
        change.kind === "removed" ? change.id : resolveChat(change.id);
      return chat === undefined ? [] : [chat];
    }),
  );
}

function sameSlugs(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((slug) => b.has(slug));
}

/**
 * The chats, oldest first, and again after every burst of changes. Each
 * change to a record moves the row of the chat it is or is in, and only
 * those rows are read again, a change only to a running turn's memory at
 * most once per chat per `LIVE_READ_MS`: a row is made from nothing but its chat's
 * records and its tasks', so whatever a row comes to show is heard without
 * a list of what to listen for. The one other thing a row shows is which of
 * the apps it names the workspace has, kept here and read again on each
 * change to the apps folder or an app; a change that adds or takes away an
 * app reads every row, and one that leaves the same apps (an edit to an
 * app's guide, a stray file) reads none. A chat the index lists that no
 * change named (made behind its back) is read when the next change lands,
 * and one it no longer lists goes. Subscribed before the first read, so
 * nothing lands unheard between the two. An answer the same
 * as the last is not sent again, except to a request to change a row
 * (`chatRowAsked`): a window paints that request before it lands, and a
 * request that changed nothing (a project just removed, a chat already gone)
 * leaves the list as it was, so the same answer is what takes the paint back.
 *
 * One reading of the list serves every follower in the process (each
 * window's `chats.live.list`, and the phone's `chat-list.json`), so a moved
 * row is read once however many follow it. A follower that comes while the
 * list is read for the first time is sent that first answer, and one that
 * comes later the last answer sent, then whatever follows. A follower busy
 * with one answer is sent only the newest of those that came meanwhile.
 * The reading starts with its first follower and stops with its last, so
 * nothing is read, watched or kept while no one follows it; the phone's
 * file follows it for as long as the app runs.
 */
export async function* liveChatList(
  signal: AbortSignal | undefined,
): AsyncGenerator<Chat[]> {
  if (signal?.aborted) {
    return;
  }
  const current = (reading ??= startReading());
  const follower: Follower = {
    ...(current.answer && { pending: current.answer }),
  };
  current.followers.add(follower);
  const leave = () => {
    if (!current.followers.delete(follower)) {
      return;
    }
    follower.wake?.();
    if (current.followers.size === 0) {
      if (reading === current) {
        reading = undefined;
      }
      current.stop.abort();
    }
  };
  signal?.addEventListener("abort", leave, { once: true });
  try {
    while (true) {
      if (follower.failed) {
        throw follower.failed.error;
      }
      if (!current.followers.has(follower)) {
        return;
      }
      if (follower.pending) {
        const answer = follower.pending;
        delete follower.pending;
        yield answer;
        continue;
      }
      await new Promise<void>((resolve) => {
        follower.wake = resolve;
      });
      delete follower.wake;
    }
  } finally {
    signal?.removeEventListener("abort", leave);
    leave();
  }
}

/** One follower of the list: the newest answer it has not been sent yet. */
interface Follower {
  failed?: { error: unknown };
  pending?: Chat[];
  wake?: () => void;
}

/** The process's reading of the list, while anyone follows it. */
interface Reading {
  /** The last answer sent, which a follower that comes later starts from. */
  answer?: Chat[];
  followers: Set<Follower>;
  stop: AbortController;
}

let reading: Reading | undefined;

function startReading(): Reading {
  const current: Reading = {
    followers: new Set(),
    stop: new AbortController(),
  };
  void (async () => {
    try {
      for await (const answer of readChatList(current.stop.signal)) {
        current.answer = answer;
        for (const follower of current.followers) {
          follower.pending = answer;
          follower.wake?.();
        }
      }
    } catch (error) {
      if (!current.stop.signal.aborted) {
        for (const follower of current.followers) {
          follower.failed = { error };
          follower.wake?.();
        }
      }
    } finally {
      if (reading === current) {
        reading = undefined;
      }
      // A reading that ended under its followers ends them too.
      const left = [...current.followers];
      current.followers.clear();
      for (const follower of left) {
        follower.wake?.();
      }
    }
  })();
  return current;
}

/** The list's answers, read for every follower at once: see `liveChatList`. */
async function* readChatList(signal: AbortSignal): AsyncGenerator<Chat[]> {
  const records = recordChanges(signal);
  const apps = collapsed(everyOne(appListChanges(signal)));
  const asked = publisher.subscribe("chat.rowAsked", { signal });
  const held = heldReads(signal);
  const rows = new Map<ChatId, Chat>();
  /** Chats read at least once, whether or not they had a row to show. */
  const read = new Set<ChatId>();
  /** The apps the workspace has, as last read; filled in before the first read. */
  let knownApps = new Set<string>();
  /** When each chat's row was last read, by `performance.now()`. */
  const readAt = new Map<ChatId, number>();
  const readAgain = async (ids: ChatId[]) => {
    const now = performance.now();
    for (const id of ids) {
      readAt.set(id, now);
      held.drop(id);
    }
    const fresh = await listedChats(ids, knownApps);
    for (const id of ids) {
      read.add(id);
      const row = fresh.get(id);
      if (row) {
        rows.set(id, row);
      } else {
        rows.delete(id);
      }
    }
  };
  const ordered = () => listChatIds().flatMap((id) => rows.get(id) ?? []);
  /**
   * The chats a burst moves to read now: every chat a write moved, and one
   * moved only in memory once `LIVE_READ_MS` has passed since its last read,
   * which is otherwise held until it has.
   */
  const movedNow = (changes: RecordChanged[]) => {
    const written = chatsMoved(changes.filter((change) => !change.live));
    const now = performance.now();
    return [
      ...written,
      ...chatsMoved(changes.filter((change) => change.live)).filter((id) => {
        if (written.includes(id)) {
          return false;
        }
        const wait = (readAt.get(id) ?? -Infinity) + LIVE_READ_MS - now;
        if (wait <= 0) {
          return true;
        }
        held.hold(id, wait);
        return false;
      }),
    ];
  };
  try {
    knownApps = await knownAppSlugs();
    await readAgain(listChatIds());
    let last = ordered();
    yield last;
    for await (const moved of mergeGenerators([
      all(records),
      apps,
      all(asked),
      held.due,
    ])) {
      let appsMoved = false;
      if (moved === null) {
        const now = await knownAppSlugs();
        appsMoved = !sameSlugs(now, knownApps);
        knownApps = now;
      }
      const listed = listChatIds();
      const known = new Set(listed);
      for (const id of read) {
        if (!known.has(id)) {
          read.delete(id);
          rows.delete(id);
          readAt.delete(id);
          held.drop(id);
        }
      }
      await readAgain(
        unique([
          ...(moved === null
            ? appsMoved
              ? listed
              : []
            : moved instanceof Held
              ? moved.ids
              : Array.isArray(moved)
                ? movedNow(moved)
                : [moved.id]
          ).filter((id) => known.has(id)),
          ...listed.filter((id) => !read.has(id)),
        ]),
      );
      const next = ordered();
      const wasAsked =
        moved !== null && !Array.isArray(moved) && !(moved instanceof Held);
      if (wasAsked || !isEqual(next, last)) {
        last = next;
        yield next;
      }
    }
  } finally {
    await records.return();
    // Not awaited: it may be waiting on an app change that ends only when
    // the request's signal does.
    void apps.return(undefined);
    void asked.return(undefined);
    held.stop();
  }
}

/** Chats whose read was held, now due. */
class Held {
  constructor(readonly ids: ChatId[]) {}
}

/**
 * Reads held for later: `hold` makes a chat due after `wait` ms unless it is
 * already held, `drop` lets it go (a read took it in), and `due` yields the
 * chats come due since the last pull.
 */
function heldReads(signal: AbortSignal | undefined) {
  const timers = new Map<ChatId, NodeJS.Timeout>();
  const ready = new Set<ChatId>();
  let wake: (() => void) | undefined;
  let stopped = false;
  const notify = () => {
    const resume = wake;
    wake = undefined;
    resume?.();
  };
  const stop = () => {
    stopped = true;
    for (const timer of timers.values()) {
      clearTimeout(timer);
    }
    timers.clear();
    notify();
  };
  signal?.addEventListener("abort", stop, { once: true });
  return {
    drop: (id: ChatId) => {
      clearTimeout(timers.get(id));
      timers.delete(id);
      ready.delete(id);
    },
    due: (async function* () {
      while (!stopped && !signal?.aborted) {
        if (ready.size === 0) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          continue;
        }
        const ids = [...ready];
        ready.clear();
        yield new Held(ids);
      }
    })(),
    hold: (id: ChatId, wait: number) => {
      if (timers.has(id) || ready.has(id)) {
        return;
      }
      const timer = setTimeout(() => {
        timers.delete(id);
        ready.add(id);
        notify();
      }, wait);
      timer.unref();
      timers.set(id, timer);
    },
    stop,
  };
}

/**
 * Says a request to change what a chat's row shows has finished, written or
 * not, so every live chat list answers with the row as it stands.
 */
export function chatRowAsked(id: ChatId) {
  publisher.publish("chat.rowAsked", { id });
}

/** An iterator as a generator, for merging. */
async function* all<T>(source: AsyncIterable<T>): AsyncGenerator<T> {
  yield* source;
}
