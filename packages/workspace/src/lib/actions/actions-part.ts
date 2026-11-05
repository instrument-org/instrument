import { type ChatId } from "../../schemas/chat-id";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { type SessionMessagePart } from "../../schemas/session/message-part";
import { StoreId } from "../../schemas/store-id";
import { ChatReads } from "../chat-reads";
import { isFromUser } from "../message-gap";
import { readActions } from "./read";
import { type Action } from "./schema";
import { mayShareActions } from "./sharing";

/** How far back the note reaches, at most: past it, what they did is another sitting. */
const NOTE_WINDOW_MS = 30 * 60_000;

/** How many rows the note has at most, the newest. */
const NOTE_ROWS_MAX = 8;

type Row = SessionMessageDataPart.ActionsDataPart["rows"][number];

/**
 * The kind a note row says for an action: its own, or for an app or a
 * permission, what was done with it; nothing for what a cap left out.
 */
function noteKindOf(action: Action): Row["kind"] | undefined {
  switch (action.kind) {
    case "app": {
      return action.did === "signed in"
        ? "app-signed-in"
        : action.did === "disconnected"
          ? "app-disconnected"
          : "app-sign-in-failed";
    }
    case "permission": {
      return `permission-${action.did}-${action.path === undefined ? "app" : "folder"}`;
    }
    case "capped": {
      return undefined;
    }
    default: {
      return action.kind;
    }
  }
}

/** How many things one action did: the files of a move, copy or trash, else one. */
function countOf(action: Action): number {
  switch (action.kind) {
    case "copy":
    case "move": {
      return action.names.length;
    }
    case "trash": {
      return action.paths.length;
    }
    default: {
      return 1;
    }
  }
}

/**
 * The note's rows from the actions before a message, oldest first: each
 * kind, how many in a row, and the whole minutes before `sentAt` of the
 * newest of them, the newest `NOTE_ROWS_MAX` rows. What a cap left out and
 * reading the very chat the message is in say nothing about what the
 * message means, and are left out.
 */
export function actionsNoteRows(
  actions: readonly Action[],
  { chatId, sentAt }: { chatId: ChatId; sentAt: Date },
): Row[] {
  const rows: Row[] = [];
  for (const action of actions) {
    const kind = noteKindOf(action);
    if (
      kind === undefined ||
      (action.kind === "chat" && action.id === chatId)
    ) {
      continue;
    }
    const minutes = Math.max(
      0,
      Math.floor((sentAt.getTime() - Date.parse(action.at)) / 60_000),
    );
    const last = rows.at(-1);
    if (last?.kind === kind) {
      last.count += countOf(action);
      last.minutes = minutes;
      continue;
    }
    rows.push({ count: countOf(action), kind, minutes });
  }
  return rows.slice(-NOTE_ROWS_MAX);
}

/**
 * The kinds of things the user did in the app since the last message they
 * typed in the chat, at most `NOTE_WINDOW_MS` back, for the message they are
 * sending now; nothing when there were none or they keep it to themselves.
 * Read when the message is stored, since the note is rendered from what is
 * stored.
 */
export async function createActionsPart({
  chatId,
  createdAt,
  messageId,
  sessionId,
}: {
  chatId: ChatId;
  createdAt: Date;
  messageId: StoreId.Message;
  sessionId: StoreId.Session;
}): Promise<SessionMessagePart.Type | undefined> {
  if (!mayShareActions()) {
    return undefined;
  }
  const history = await ChatReads.history({ chatId, sessionId });
  const previous = history.isOk()
    ? Math.max(
        ...history.value
          .filter(isFromUser)
          .map((message) => message.metadata.createdAt.getTime()),
      )
    : Number.NEGATIVE_INFINITY;
  const until = createdAt.getTime();
  const actions = await readActions({
    since: Math.max(until - NOTE_WINDOW_MS, previous + 1),
    until,
  });
  const rows = actionsNoteRows(actions, { chatId, sentAt: createdAt });
  if (rows.length === 0) {
    return undefined;
  }
  return {
    data: { rows },
    metadata: { createdAt, id: StoreId.newPartId(), messageId, sessionId },
    type: "data-actions",
  };
}
