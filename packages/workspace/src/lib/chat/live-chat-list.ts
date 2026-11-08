import { randomUUID } from "node:crypto";

import { mergeGenerators } from "@instrument-org/shared/merge-generators";
import { isEqual, unique } from "radashi";

import { collapsed, everyOne } from "../../rpc/live-read";
import { type ChatId } from "../../schemas/chat-id";
import { appListChanges } from "../host-events";
import { type RecordChanged, recordChanges } from "../record-changes";
import { resolveChat } from "../record-folders";
import {
  type ChatListEvent,
  foldChatList,
  type HeldChatList,
  listedBefore,
  type ListedAt,
} from "./chat-list-events";
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
 * The chats, oldest first, as a snapshot of every row and then a patch for
 * every burst of changes that moved a row: the rows it changed and the ids
 * of the chats gone. Each change to a record moves the row of the chat it is
 * or is in, and only those rows are read again, a change only to a running
 * turn's memory at most once per chat per `LIVE_READ_MS`: a row is made from
 * nothing but its chat's records and its tasks', so whatever a row comes to
 * show is heard without a list of what to listen for. The one other thing a
 * row shows is which of the apps it names the workspace has, kept here and
 * read again on each change to the apps folder or an app; a change that adds
 * or takes away an app reads every row, and one that leaves the same apps
 * (an edit to an app's guide, a stray file) reads none. A chat the index
 * lists that no change named (made behind its back) is read when the next
 * change lands, and one it no longer lists goes. Subscribed before the first
 * read, so nothing lands unheard between the two. A row read again the same
 * as it was is not sent. A request that changes a row reads it again once
 * it has written (`refreshChatRow`) and answers with the `rev` the row
 * stands at, changed or not, which is what a window waits for before it
 * takes back what it painted.
 *
 * One reading of the list serves every follower in the process (each
 * window's `chats.live.rows`, and the phone's `chat-list.json`), so a moved
 * row is read once however many follow it. Each reading has an `epoch` of
 * its own and counts its patches in `rev`. A follower is sent a snapshot of
 * the rows as they stand first, once the first read is in, and then each
 * patch; one still busy with a patch when the next comes is sent a snapshot
 * of where the list stands once it is ready, rather than a queue of patches.
 * The reading starts with its first follower and stops with its last, so
 * nothing is read, watched or kept while no one follows it; the phone's
 * file follows it for as long as the app runs.
 */
export async function* liveChatRows(
  signal: AbortSignal | undefined,
): AsyncGenerator<ChatListEvent<Chat>> {
  if (signal?.aborted) {
    return;
  }
  const current = (reading ??= startReading());
  const follower: Follower = { owed: "snapshot" };
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
      const owed = follower.owed;
      if (owed === "snapshot" && current.rev !== undefined) {
        delete follower.owed;
        yield {
          epoch: current.epoch,
          kind: "snapshot",
          rev: current.rev,
          rows: [...current.rows.values()].sort((a, b) =>
            listedBefore(a.sessionId, b.sessionId),
          ),
        };
        continue;
      }
      if (owed !== undefined && owed !== "snapshot") {
        delete follower.owed;
        yield owed;
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

/** The chats, oldest first, whole after every change: `liveChatRows` folded. */
export async function* liveChatList(
  signal: AbortSignal | undefined,
): AsyncGenerator<Chat[]> {
  let held: HeldChatList<Chat> | undefined;
  for await (const event of liveChatRows(signal)) {
    held = foldChatList(held, event);
    if (!held) {
      throw new Error("The chat list skipped a change.");
    }
    yield held.rows;
  }
}

type ChatListPatch = Extract<ChatListEvent<Chat>, { kind: "patch" }>;

/**
 * One follower of the list: what it is owed next, a snapshot of where the
 * list stands or the one patch sent since its last.
 */
interface Follower {
  failed?: { error: unknown };
  owed?: "snapshot" | ChatListPatch;
  wake?: () => void;
}

/** The process's reading of the list, while anyone follows it. */
interface Reading {
  /** This reading's own, so a reader never takes another's revisions for its. */
  epoch: string;
  followers: Set<Follower>;
  /** How many patches it has sent; none until the first read is in. */
  rev?: number;
  /** Requests for a row read again, not yet answered. */
  refreshes: Refresh[];
  /** Each chat's row as last read. */
  rows: Map<ChatId, Chat>;
  stop: AbortController;
  /** Wakes the reading for the requests in `refreshes`. */
  wakeRefreshes?: () => void;
}

/** A request for a chat's row read again, answered with where the list stands once it is. */
interface Refresh {
  done: (at: ListedAt | null) => void;
  id: ChatId;
  /** Whether the reading has taken it to read. */
  taken?: boolean;
}

let reading: Reading | undefined;

function startReading(): Reading {
  const current: Reading = {
    epoch: randomUUID(),
    followers: new Set(),
    refreshes: [],
    rows: new Map(),
    stop: new AbortController(),
  };
  void (async () => {
    try {
      await readChatList(current, (patch) => {
        for (const follower of current.followers) {
          follower.owed = follower.owed === undefined ? patch : "snapshot";
          follower.wake?.();
        }
      });
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
      // A reading that ended under its followers ends them too, and leaves
      // no list for a request to wait on.
      const left = [...current.followers];
      current.followers.clear();
      for (const follower of left) {
        follower.wake?.();
      }
      for (const refresh of current.refreshes.splice(0)) {
        refresh.done(null);
      }
    }
  })();
  return current;
}

/**
 * Reads the list into `current` for every follower at once, and hands each
 * patch to `send`: see `liveChatRows`.
 */
async function readChatList(
  current: Reading,
  send: (patch: ChatListPatch) => void,
): Promise<void> {
  const { signal } = current.stop;
  const { rows } = current;
  const records = recordChanges(signal);
  const apps = collapsed(everyOne(appListChanges(signal)));
  const refreshes = refreshesOf(current);
  const held = heldReads(signal);
  /** Chats read at least once, whether or not they had a row to show. */
  const read = new Set<ChatId>();
  /** The apps the workspace has, as last read; filled in before the first read. */
  let knownApps = new Set<string>();
  /** When each chat's row was last read, by `performance.now()`. */
  const readAt = new Map<ChatId, number>();
  /**
   * Reads `ids` again and takes `gone` out, and says which rows that
   * changed.
   */
  const readAgain = async (ids: ChatId[], gone: ChatId[] = []) => {
    const now = performance.now();
    for (const id of ids) {
      readAt.set(id, now);
      held.drop(id);
    }
    const fresh = await listedChats(ids, knownApps);
    const upserts: Chat[] = [];
    const removed: ChatId[] = [];
    for (const id of gone) {
      if (rows.delete(id)) {
        removed.push(id);
      }
    }
    for (const id of ids) {
      read.add(id);
      const row = fresh.get(id);
      const was = rows.get(id);
      if (row) {
        rows.set(id, row);
        if (!was || !isEqual(was, row)) {
          upserts.push(row);
        }
      } else if (rows.delete(id)) {
        removed.push(id);
      }
    }
    return { removed, upserts };
  };
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
    let rev = 0;
    current.rev = rev;
    for (const follower of current.followers) {
      follower.wake?.();
    }
    for await (const moved of mergeGenerators([
      all(records),
      apps,
      refreshes,
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
      const gone: ChatId[] = [];
      for (const id of read) {
        if (!known.has(id)) {
          read.delete(id);
          readAt.delete(id);
          held.drop(id);
          gone.push(id);
        }
      }
      const { removed, upserts } = await readAgain(
        unique([
          ...(moved === null
            ? appsMoved
              ? listed
              : []
            : moved instanceof Held
              ? moved.ids
              : Array.isArray(moved)
                ? movedNow(moved)
                : moved.refreshes.map((refresh) => refresh.id)
          ).filter((id) => known.has(id)),
          ...listed.filter((id) => !read.has(id)),
        ]),
        gone,
      );
      if (upserts.length > 0 || removed.length > 0) {
        const from = rev;
        rev += 1;
        current.rev = rev;
        send({
          epoch: current.epoch,
          from,
          kind: "patch",
          removed,
          rev,
          upserts,
        });
      }
      if (moved instanceof Refreshes) {
        for (const refresh of moved.refreshes) {
          refresh.done({ epoch: current.epoch, rev });
        }
      }
    }
  } finally {
    await records.return();
    // Not awaited: it may be waiting on an app change that ends only when
    // the request's signal does.
    void apps.return(undefined);
    void refreshes.return(undefined);
    held.stop();
  }
}

/** Requests for rows read again, taken together. */
class Refreshes {
  constructor(readonly refreshes: Refresh[]) {}
}

/**
 * The requests for rows read again as they come, all those waiting at once.
 * Each stays in `current.refreshes` until it is answered, so a reading that
 * ends answers every one, those it was reading for included.
 */
async function* refreshesOf(current: Reading): AsyncGenerator<Refreshes> {
  const { signal } = current.stop;
  signal.addEventListener("abort", () => current.wakeRefreshes?.(), {
    once: true,
  });
  while (!signal.aborted) {
    const batch = current.refreshes.filter((refresh) => !refresh.taken);
    if (batch.length === 0) {
      await new Promise<void>((resolve) => {
        current.wakeRefreshes = resolve;
      });
      delete current.wakeRefreshes;
      continue;
    }
    for (const refresh of batch) {
      refresh.taken = true;
    }
    yield new Refreshes(batch);
  }
}

/**
 * Reads a chat's row again once what was asked of it is written, and
 * answers with where the list stands once it has: the `rev` from which the
 * row shows the request, whether or not it changed. None when no list is
 * read in the process, so no reader has anything to wait for.
 */
export function refreshChatRow(id: ChatId): Promise<ListedAt | null> {
  const current = reading;
  if (!current || current.stop.signal.aborted) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const refresh: Refresh = {
      done: (at) => {
        const index = current.refreshes.indexOf(refresh);
        if (index !== -1) {
          current.refreshes.splice(index, 1);
        }
        resolve(at);
      },
      id,
    };
    current.refreshes.push(refresh);
    current.wakeRefreshes?.();
  });
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

/** An iterator as a generator, for merging. */
async function* all<T>(source: AsyncIterable<T>): AsyncGenerator<T> {
  yield* source;
}
