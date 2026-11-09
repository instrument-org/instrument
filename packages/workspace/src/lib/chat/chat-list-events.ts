import { type ChatId } from "../../schemas/chat-id";

/**
 * What the live chat list sends: every row first, then only the rows that
 * changed and the ids of those that went. `epoch` names one run of the
 * process's list, so a list read again from the start is never taken for the
 * one before; `rev` counts the changes it has sent, and a patch says the
 * `rev` it goes on from, so a reader that missed one knows to start over.
 */
export type ChatListEvent<Row> =
  | { epoch: string; kind: "snapshot"; rev: number; rows: Row[] }
  | {
      epoch: string;
      from: number;
      kind: "patch";
      removed: ChatId[];
      rev: number;
      upserts: Row[];
    };

/** Where a list stands: the run of it and the change it is at. */
export interface ListedAt {
  epoch: string;
  rev: number;
}

/** What a reader holds of the list: its rows, in the list's order. */
export interface HeldChatList<Row> extends ListedAt {
  rows: Row[];
}

/** What the fold needs of a row: its chat, and its session, which orders it. */
interface Listed {
  id: ChatId;
  sessionId: string;
}

/**
 * The list's order, oldest first: by each chat's session id, a ULID, which
 * orders to the millisecond. The one order the list is read in and a reader
 * folds into.
 */
export function listedBefore(a: string, b: string): number {
  return a.localeCompare(b);
}

/**
 * What a reader holds once an event is taken in, or none when the event does
 * not go on from what it holds (another run of the list, or a change
 * missed), and the list has to be read again from the start. A row the
 * event did not name keeps its object, and `keep` says which object a row
 * the event names takes, given the one held for it.
 */
export function foldChatList<Row extends Listed>(
  held: HeldChatList<Row> | undefined,
  event: ChatListEvent<Row>,
  keep: (before: Row, after: Row) => Row = (_before, after) => after,
): HeldChatList<Row> | undefined {
  const before = new Map(held?.rows.map((row) => [row.id, row]));
  const taken = (row: Row) => {
    const was = before.get(row.id);
    return was ? keep(was, row) : row;
  };
  if (event.kind === "snapshot") {
    return { epoch: event.epoch, rev: event.rev, rows: event.rows.map(taken) };
  }
  if (!held || held.epoch !== event.epoch || held.rev !== event.from) {
    return undefined;
  }
  const rows = new Map(before);
  for (const id of event.removed) {
    rows.delete(id);
  }
  for (const row of event.upserts) {
    rows.set(row.id, taken(row));
  }
  return {
    epoch: event.epoch,
    rev: event.rev,
    rows: [...rows.values()].sort((a, b) =>
      listedBefore(a.sessionId, b.sessionId),
    ),
  };
}
