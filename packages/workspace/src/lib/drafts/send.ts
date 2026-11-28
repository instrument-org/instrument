import path from "node:path";

import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { type StoreId } from "../../schemas/store-id";
import { unansweredMessage } from "../chat/take-back";
import { chatDir } from "../record-folders";
import { type FoldedChat } from "../records/fold";
import { foldChatInFolder } from "../records/fold-folder";
import {
  type DraftOnDisk,
  readDrafts,
  removeDraft,
  trashLeftInDraft,
  writeDraftFile,
} from "./draft-folder";

/**
 * Sending a draft, in steps that can each be interrupted.
 *
 * The records are what "sent" means. A message names the draft it came from
 * (`fromDraft`), and that message is the only thing that says the draft was
 * sent: a draft is pointed at its chat first (`sending`), the message is
 * appended next (`sent`), and the draft, folder and all, is taken away only
 * once the turn the message started has ended with the message still there.
 * A Stop that takes the message back before any answer retracts it, and the
 * draft is the person's again, exactly as it was.
 *
 * So one rule settles a draft on its way wherever the app stops: its chat
 * holds its message, and the draft is finished; it does not (never written,
 * or taken back), and the draft is the person's again. A draft another
 * computer is sending (its `sender`) is the exception for a day: its
 * message may be written there and not yet synced here.
 */

/** How long a launch leaves a draft another computer is sending to that computer. */
export const OTHER_SENDER_WAIT_MS = 24 * 60 * 60 * 1000;

/** What finishing the drafts a message already names came to. */
export interface DraftsFinished {
  /** Each draft whose folder was taken away, by id. */
  finished: string[];
  /** Each draft left to be sent again, with why it could not be read as sent. */
  left: { id: string; reason: string }[];
  /** What a finished draft's folder still had that could not be moved to the Trash, left where it is. */
  untrashed: { path: string; reason: string }[];
}

/**
 * Settles every draft a launch finds on its way, by the rule above: one whose
 * chat holds a message naming it is taken away, since no turn is running
 * yet to answer it; one on its way whose chat holds no such message is the
 * person's again, as the kind of draft it was. A reply naming its chat but
 * not on its way is taken away only where its chat holds its message.
 *
 * Runs over the chats' record folders rather than through the records
 * service, so it can run before the workspace is up, and comes to the same
 * answer however often it runs: a draft whose folder is already gone is not
 * there to find. What its folder still has goes to the Trash: the chat has
 * its own copy of what was sent, and which of the folder's entries those
 * were is not written down.
 */
export async function finishSentDrafts({
  chatsDir,
  deviceId,
  moveToTrash,
  now = Date.now(),
  rootDir,
}: {
  /** The workspace's record folders, `.instrument/chats/`. */
  chatsDir: string;
  /** This computer's device id, which a draft it is sending names as its `sender`. */
  deviceId: string;
  /** Moves a file or folder to the system's Trash. */
  moveToTrash: (target: string) => Promise<void>;
  now?: number;
  /** The workspace's own folder, whose `.instrument/drafts/` the drafts are in. */
  rootDir: string;
}): Promise<DraftsFinished> {
  const drafts = await readDrafts(rootDir);
  // A draft on its way names the chat it is being sent into; a reply names
  // its own chat from the start.
  const chatOf = (entry: DraftOnDisk) =>
    entry.draft.sending ?? entry.draft.chat;
  const waiting = drafts.filter((entry) => chatOf(entry) !== undefined);
  const finished: string[] = [];
  const left: DraftsFinished["left"] = [];
  const untrashed: DraftsFinished["untrashed"] = [];
  const sentInto = new Map<string, Promise<Set<string> | string>>();
  for (const entry of waiting) {
    const chat = chatOf(entry) ?? "";
    const named = ChatIdSchema.safeParse(chat);
    if (!named.success) {
      left.push({ id: entry.draft.id, reason: `${chat} is no chat's id` });
      continue;
    }
    let read = sentInto.get(chat);
    if (read === undefined) {
      read = draftsSentInto(path.join(chatsDir, chat));
      sentInto.set(chat, read);
    }
    const sent = await read;
    if (typeof sent === "string") {
      left.push({ id: entry.draft.id, reason: sent });
      continue;
    }
    if (!sent.has(entry.draft.id)) {
      const { sender, updated } = entry.draft;
      if (
        entry.draft.sending !== undefined &&
        sender !== undefined &&
        sender !== deviceId &&
        now - updated.getTime() < OTHER_SENDER_WAIT_MS
      ) {
        left.push({
          id: entry.draft.id,
          reason: `${sender} is sending it into ${chat}`,
        });
        continue;
      }
      // A send that never landed, or a message taken back: the draft is the
      // person's again, as the kind of draft it was.
      if (entry.draft.sending !== undefined || entry.draft.sent !== undefined) {
        const {
          sender: _sender,
          sending: _stopped,
          sent: _taken,
          ...draft
        } = entry.draft;
        writeDraftFile(entry.file, draft);
      }
      left.push({
        id: entry.draft.id,
        reason: `${chat} holds no message from it`,
      });
      continue;
    }
    const kept = await trashLeftInDraft({
      dir: entry.dir,
      left: removeDraft(entry),
      moveToTrash,
    });
    for (const { error, path: where } of kept) {
      untrashed.push({ path: where, reason: String(error) });
    }
    finished.push(entry.draft.id);
  }
  return { finished, left, untrashed };
}

/**
 * The drafts a chat's records say were sent into it, by id, or why they could
 * not be read. A chat with no record folder at all reads as holding nothing,
 * which is what a draft pointed at a chat whose send never reached the
 * records looks like: it is left to be sent again.
 */
async function draftsSentInto(dir: string): Promise<Set<string> | string> {
  try {
    return new Set((await draftMessagesInFolder(dir)).keys());
  } catch (error) {
    return `its chat's records could not be read (${String(error)})`;
  }
}

/** Where a draft's message stands in its chat: the session it is in, and whether a Stop now would take it back. */
export interface DraftMessage {
  /** It is the message {@link unansweredMessage} names: nothing has answered it. */
  isUnanswered: boolean;
  sessionId: StoreId.Session;
}

/**
 * Each message in the chat that names the draft it came from, by that
 * draft's id. A draft missing here was never sent into the chat, or its
 * message was taken back; a chat that is gone holds none.
 */
export async function draftMessagesIn(
  chatId: ChatId,
): Promise<Map<string, DraftMessage>> {
  let dir: string;
  try {
    dir = chatDir(chatId);
  } catch {
    return new Map();
  }
  return draftMessagesInFolder(dir);
}

/** {@link draftMessagesIn}, read from the chat's record folder. */
export async function draftMessagesInFolder(
  dir: string,
): Promise<Map<string, DraftMessage>> {
  let chat: FoldedChat;
  try {
    chat = await foldChatInFolder(dir);
  } catch (error) {
    if (isMissing(error)) {
      return new Map();
    }
    throw error;
  }
  const found = new Map<string, DraftMessage>();
  for (const session of chat.sessions) {
    const waiting = unansweredMessage(session.messages, session.id)?.message;
    for (const message of session.messages) {
      if (
        message.role === "user" &&
        typeof message.metadata.fromDraft === "string"
      ) {
        found.set(message.metadata.fromDraft, {
          isUnanswered: message === waiting,
          sessionId: session.id,
        });
      }
    }
  }
  return found;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
