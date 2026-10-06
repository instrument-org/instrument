import { mergeGenerators } from "@instrument-org/shared/merge-generators";
import { isEqual, unique } from "radashi";

import { publisher } from "../../rpc/publisher";
import { collapsed, everyOne } from "../../rpc/live-read";
import { type ChatId } from "../../schemas/chat-id";
import { type RecordChanged, recordChanges } from "../record-changes";
import { chatOf } from "../record-folders";
import { listChatIds } from "./chat-records";
import { type Chat, listedChats } from "./chats";

/** The chat each change is to, or the one whose folder holds the task it is to. */
function chatsMoved(changes: RecordChanged[]): ChatId[] {
  return unique(
    changes.flatMap((change) => {
      const chat =
        change.kind === "removed"
          ? change.ref.kind === "chat"
            ? change.ref.id
            : change.ref.chatId
          : chatOf(change.id);
      return chat === undefined ? [] : [chat];
    }),
  );
}

/**
 * The chats, oldest first, and again after every burst of changes. Each
 * change to a record moves the row of the chat it is or is in, and only
 * those rows are read again: a row is made from nothing but its chat's
 * records and its tasks', so whatever a row comes to show is heard without
 * a list of what to listen for. A change to the workspace's apps reads every
 * row, since a row's holds name only the apps the workspace has. A chat the
 * index lists that no change named (made behind its back) is read when the
 * next change lands, and one it no longer lists goes. Subscribed before the
 * first read, so nothing lands unheard between the two; an answer the same
 * as the last is not sent again.
 */
export async function* liveChatList(
  signal: AbortSignal | undefined,
): AsyncGenerator<Chat[]> {
  const records = recordChanges(signal);
  const apps = collapsed(
    everyOne(publisher.subscribe("app.updated", { signal })),
  );
  const rows = new Map<ChatId, Chat>();
  /** Chats read at least once, whether or not they had a row to show. */
  const read = new Set<ChatId>();
  const readAgain = async (ids: ChatId[]) => {
    const fresh = await listedChats(ids);
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
  try {
    await readAgain(listChatIds());
    let last = ordered();
    yield last;
    for await (const moved of mergeGenerators([all(records), apps])) {
      const listed = listChatIds();
      const known = new Set(listed);
      for (const id of read) {
        if (!known.has(id)) {
          read.delete(id);
          rows.delete(id);
        }
      }
      await readAgain(
        unique([
          ...(moved === null
            ? listed
            : chatsMoved(moved).filter((id) => known.has(id))),
          ...listed.filter((id) => !read.has(id)),
        ]),
      );
      const next = ordered();
      if (!isEqual(next, last)) {
        last = next;
        yield next;
      }
    }
  } finally {
    await records.return();
    // Not awaited: it may be waiting on an app change that ends only when
    // the request's signal does.
    void apps.return(undefined);
  }
}

/** An iterator as a generator, for merging. */
async function* all<T>(source: AsyncIterable<T>): AsyncGenerator<T> {
  yield* source;
}
