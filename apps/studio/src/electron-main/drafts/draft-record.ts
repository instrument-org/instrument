import {
  type Draft,
  type DraftAttachment,
  type DraftContextItem,
} from "@/shared/drafts";
import { ChatIdSchema } from "@instrument-org/workspace/electron";
import {
  contextEntryOf,
  contextLineOf,
  type DraftContextEntry,
  type DraftFile,
  draftFolderItems,
  type DraftOnDisk,
  ownsDraftFolder,
  pastedFileOf,
} from "@instrument-org/workspace/drafts";
import path from "node:path";
import { unique } from "radashi";

/**
 * The translation between a draft as every window has it ({@link Draft}) and
 * as its file holds it ({@link DraftFile}).
 *
 * The draft's folder is what its composer was given: every file and folder
 * in it goes with the message, so nothing in the folder is written as a line.
 * The file's `context` is everything else that goes with it, one line each:
 * what the composer was given from elsewhere and every chip the draft
 * carries. Read back, the folder is the composer's again and every line is a
 * chip. What the window keeps only while the app runs (the chips of the
 * draft's own tabs taken off, a topic the model suggested) is not written.
 *
 * In a folder another draft shares, the folder cannot say whose a file is,
 * so there a file in it is written as a line by its path inside the folder,
 * and read back as the composer's (`ownsDraftFolder`).
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
  const { dir } = folders;
  const ownFolder =
    dir !== undefined && ownsDraftFolder(dir, draft.id) ? dir : undefined;
  const context = unique([
    ...(draft.attached ?? []).flatMap((item) =>
      ownFolder !== undefined && isInside(ownFolder, item.path)
        ? []
        : [contextLineOf({ kind: item.kind, path: item.path }, folders)],
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
 * left out, and so is one naming something in the draft's own folder, which
 * the folder already gives.
 */
export function draftOf({ dir, draft }: DraftOnDisk, rootDir: string): Draft {
  const chat = ChatIdSchema.safeParse(draft.chat);
  const sending = ChatIdSchema.safeParse(draft.sending);
  const attached = folderAttachmentsOf({ dir, draft });
  const context: DraftContextItem[] = [];
  for (const line of draft.context ?? []) {
    const item = itemOf(contextEntryOf(line, { dir, rootDir }));
    if (
      item !== undefined &&
      !(
        (item.kind === "file" || item.kind === "folder") &&
        isInside(dir, item.path)
      )
    ) {
      context.push(item);
    }
  }
  return {
    ...(attached.length > 0 ? { attached, inFolder: attached } : {}),
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

/**
 * A draft whose file is as it was, with its folder read again: what the
 * folder has now, and the composer's files that left it taken out of what
 * it was given. One that arrived stays out of `attached` until a composer
 * shows it, since that is the composer's to say.
 */
export function withFolderOf(current: Draft, read: Draft, dir: string): Draft {
  const now = new Set((read.inFolder ?? []).map((item) => item.path));
  const attached = (current.attached ?? []).filter(
    (item) => !isInside(dir, item.path) || now.has(item.path),
  );
  const { attached: _attached, inFolder: _inFolder, ...rest } = current;
  return {
    ...rest,
    ...(attached.length > 0 ? { attached } : {}),
    ...(read.inFolder === undefined ? {} : { inFolder: read.inFolder }),
  };
}

/** What in the draft's folder goes with it, as a composer shows it. */
function folderAttachmentsOf(
  entry: Pick<DraftOnDisk, "dir" | "draft">,
): DraftAttachment[] {
  return draftFolderItems(entry).map((item) =>
    item.kind === "folder"
      ? { kind: "folder", path: item.path }
      : { kind: "file", ...pastedFileOf(item.path) },
  );
}

/** Whether `target` is something inside `dir`, the folder itself aside. */
function isInside(dir: string, target: string): boolean {
  const within = path.relative(dir, target);
  return within !== "" && !within.startsWith("..") && !path.isAbsolute(within);
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
