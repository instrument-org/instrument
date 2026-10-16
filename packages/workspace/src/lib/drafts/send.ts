import path from "node:path";

import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { foldChatInFolder } from "../records/fold-folder";
import {
  type DraftOnDisk,
  findDraft,
  readDrafts,
  removeDraft,
  writeDraftFile,
} from "./draft-folder";

/**
 * Sending a draft, in steps that can each be interrupted.
 *
 * The records are what "sent" means. A message names the draft it came from
 * (`fromDraft`), and that message is the only thing that says the draft was
 * sent: a draft is pointed at its chat first, the message is appended next,
 * and the draft's folder is taken away last.
 *
 * So the person loses nothing wherever the app stops:
 *
 * - Before the message: the draft is still there, with its words and
 *   everything pasted into it, and sending it again sends it once.
 * - After the message: the next launch finds the message that names the
 *   draft and finishes what was left, which is taking the folder away.
 *
 * The same reasoning is what lets another device send a draft later: it finds
 * out a draft was sent by finding the message that names it, not by anything
 * the draft itself says.
 */

/** What finishing the drafts a message already names came to. */
export interface DraftsFinished {
  /** Each draft whose folder was taken away, by id. */
  finished: string[];
  /** Each draft left to be sent again, with why it could not be read as sent. */
  left: { id: string; reason: string }[];
}

/**
 * Points a draft at the chat it is about to be sent into, and waits for the
 * file. The first step of a send: until the draft names its chat, nothing at
 * the next launch knows where to look for the message that would say it was
 * sent, so a crash between this and the append would strand it.
 *
 * A reply draft names its chat from its first autosave, so this changes
 * nothing for one; a draft opening a chat of its own learns the chat here.
 */
export function pointDraftAtChat({
  chatId,
  draftId,
  rootDir,
}: {
  chatId: ChatId;
  draftId: string;
  rootDir: string;
}): DraftOnDisk | undefined {
  const found = findDraft(rootDir, draftId);
  if (!found) {
    return undefined;
  }
  if (found.draft.chat === chatId) {
    return found;
  }
  const pointed = { ...found.draft, chat: chatId, updated: new Date() };
  writeDraftFile(found.file, pointed);
  return { ...found, draft: pointed };
}

/**
 * Takes away every draft whose chat already holds a message naming it: a
 * send the app was interrupted partway through, finished by the launch that
 * follows. One whose chat holds no such message is left exactly as it is, to
 * be sent again by whoever meant to send it.
 *
 * Runs over the chats' record folders rather than through the records
 * service, so it can run before the workspace is up, and comes to the same
 * answer however often it runs: a draft whose folder is already gone is not
 * there to find.
 */
export async function finishSentDrafts({
  chatsDir,
  rootDir,
}: {
  /** The workspace's record folders, `.instrument/chats/`. */
  chatsDir: string;
  /** The workspace's own folder, which `Drafts/` is at the top of. */
  rootDir: string;
}): Promise<DraftsFinished> {
  const drafts = readDrafts(rootDir);
  const waiting = drafts.filter((entry) => entry.draft.chat !== undefined);
  const finished: string[] = [];
  const left: DraftsFinished["left"] = [];
  const sentInto = new Map<string, Promise<Set<string> | string>>();
  for (const entry of waiting) {
    const chat = entry.draft.chat ?? "";
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
      left.push({
        id: entry.draft.id,
        reason: `${chat} holds no message from it`,
      });
      continue;
    }
    removeDraft(entry);
    finished.push(entry.draft.id);
  }
  return { finished, left };
}

/**
 * The drafts a chat's records say were sent into it, by id, or why they could
 * not be read. A chat with no record folder at all reads as holding nothing,
 * which is what a draft pointed at a chat whose send never reached the
 * records looks like: it is left to be sent again.
 */
async function draftsSentInto(dir: string): Promise<Set<string> | string> {
  let chat;
  try {
    chat = await foldChatInFolder(dir);
  } catch (error) {
    return isMissing(error)
      ? new Set<string>()
      : `its chat's records could not be read (${String(error)})`;
  }
  const sent = new Set<string>();
  for (const session of chat.sessions) {
    for (const message of session.messages) {
      if (
        message.role === "user" &&
        typeof message.metadata.fromDraft === "string"
      ) {
        sent.add(message.metadata.fromDraft);
      }
    }
  }
  return sent;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
