import { type Draft, type DraftContextItem } from "@/shared/drafts";
import { ChatIdSchema } from "@instrument-org/workspace/electron";
import {
  contextEntryOf,
  contextLineOf,
  type DraftContextEntry,
  type DraftFile,
  type DraftOnDisk,
  pastedFileOf,
  pastedPathOf,
} from "@instrument-org/workspace/drafts";
import path from "node:path";
import { unique } from "radashi";

/**
 * The translation between a draft as every window has it ({@link Draft}) and
 * as its file holds it ({@link DraftFile}).
 *
 * The file's `context` is everything that goes with the message, one line
 * each: what was pasted into the composer, by its path inside the draft's
 * folder, and every chip the draft carries. Read back, a line naming a file
 * pasted into the draft is the composer's again and every other line is a
 * chip. What the window keeps only while the app runs (the chips of the
 * draft's own tabs taken off, a topic the model suggested) is not written.
 */

/** Where a draft's lines are read and written from. */
interface Folders {
  /** The draft's folder, unknown the first time a draft is written, when the folder it names is the one about to be made. */
  dir: string | undefined;
  /** The workspace's own folder, which a line names a place in it from. */
  rootDir: string;
}

/**
 * The draft as its file holds it. A draft on its way into a chat names that
 * chat as `sending`, apart from the chat a reply is for, so a launch after a
 * crash knows where to look for the message that says it was sent, and
 * another device does not read a new chat's draft as a reply.
 */
export function draftFileOf(draft: Draft, folders: Folders): DraftFile {
  const context = unique([
    ...(draft.attached ?? []).map((item) =>
      contextLineOf({ kind: item.kind, path: item.path }, folders),
    ),
    ...(draft.context ?? []).map((item) => contextLineOf(item, folders)),
  ]);
  const topic = draft.topicSource === "suggested" ? undefined : draft.topicId;
  return {
    ...(draft.chatId === undefined ? {} : { chat: draft.chatId }),
    ...(context.length > 0 ? { context } : {}),
    created: new Date(draft.createdAt),
    id: draft.id,
    ...(draft.sendingTo === undefined ? {} : { sending: draft.sendingTo }),
    ...(topic === undefined ? {} : { topic }),
    updated: new Date(draft.updatedAt),
    words: draft.words,
  };
}

/**
 * The draft its file holds, with every path it names absolute, since the
 * window shows and sends files by path. A `chat` that is no chat's id is
 * read as no chat, which makes the draft a new chat's rather than a reply
 * that could never be sent; a line naming nothing this build can read is
 * left out.
 */
export function draftOf({ dir, draft }: DraftOnDisk, rootDir: string): Draft {
  const chat = ChatIdSchema.safeParse(draft.chat);
  const sending = ChatIdSchema.safeParse(draft.sending);
  const attached: NonNullable<Draft["attached"]> = [];
  const context: DraftContextItem[] = [];
  for (const line of draft.context ?? []) {
    const pasted = pastedPathOf(line);
    if (pasted !== undefined) {
      attached.push({ kind: "file", ...pastedFileOf(path.join(dir, pasted)) });
      continue;
    }
    const item = itemOf(contextEntryOf(line, { dir, rootDir }));
    if (item !== undefined) {
      context.push(item);
    }
  }
  return {
    ...(attached.length > 0 ? { attached } : {}),
    ...(chat.success ? { chatId: chat.data } : {}),
    ...(context.length > 0 ? { context } : {}),
    createdAt: draft.created.getTime(),
    id: draft.id,
    ...(sending.success ? { sendingTo: sending.data } : {}),
    ...(draft.topic === undefined ? {} : { topicId: draft.topic }),
    updatedAt: draft.updated.getTime(),
    words: draft.words,
  };
}

function itemOf(
  entry: DraftContextEntry | undefined,
): DraftContextItem | undefined {
  if (entry?.kind !== "chat") {
    return entry;
  }
  const chat = ChatIdSchema.safeParse(entry.chat);
  return chat.success ? { chat: chat.data, kind: "chat" } : undefined;
}
