import {
  type Draft,
  type DraftAsk,
  type DraftAttachment,
  type DraftContextItem,
  type DraftSend,
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
 * carries. Read back, the folder is the composer's again, and so is every
 * file and folder a line names, shown in the box and sent or taken out as
 * what was given to it there; a line with an address is a chip. What the window keeps only while the app runs (the chips of the
 * draft's own tabs taken off, a project the model suggested) is not written.
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
 * another device does not read a new chat's draft as a reply; once its
 * message is written, `sent` names the message too.
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
  const project =
    draft.projectSource === "suggested" ? undefined : draft.projectId;
  const asks = (draft.asks ?? []).map((ask) => ({
    ...(ask.context === undefined ? {} : { context: ask.context }),
    ...(ask.excerpt === undefined ? {} : { excerpt: ask.excerpt }),
    file: contextLineOf({ kind: "file", path: ask.path }, folders),
    instruction: ask.instruction,
    target: ask.target,
  }));
  return {
    ...(asks.length > 0 ? { asks } : {}),
    ...(draft.chatId === undefined ? {} : { chat: draft.chatId }),
    ...(context.length > 0 ? { context } : {}),
    created: new Date(draft.createdAt),
    id: draft.id,
    ...sendLinesOf(draft.send),
    ...(project === undefined ? {} : { project }),
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
  const send = sendOf(draft);
  const inFolder = folderAttachmentsOf({ dir, draft });
  const elsewhere: DraftAttachment[] = [];
  const context: DraftContextItem[] = [];
  for (const line of draft.context ?? []) {
    const item = itemOf(contextEntryOf(line, { dir, rootDir }));
    if (item?.kind === "file" || item?.kind === "folder") {
      if (!isInside(dir, item.path)) {
        elsewhere.push(
          item.kind === "folder"
            ? { kind: "folder", path: item.path }
            : { kind: "file", ...pastedFileOf(item.path) },
        );
      }
    } else if (item !== undefined) {
      context.push(item);
    }
  }
  const attached = unique([...inFolder, ...elsewhere], (item) => item.path);
  const created = draft.created.getTime();
  // Named by their place in the file, which is all a file says of them.
  const asks = (draft.asks ?? []).flatMap((ask, at): DraftAsk[] => {
    const file = contextEntryOf(ask.file, { dir, rootDir });
    return file?.kind === "file"
      ? [
          {
            ...(ask.context === undefined ? {} : { context: ask.context }),
            createdAt: created + at,
            ...(ask.excerpt === undefined ? {} : { excerpt: ask.excerpt }),
            id: `${draft.id}-ask-${at.toString()}`,
            instruction: ask.instruction,
            path: file.path,
            target: ask.target,
          },
        ]
      : [];
  });
  return {
    ...(asks.length > 0 ? { asks } : {}),
    ...(attached.length > 0 ? { attached } : {}),
    ...(inFolder.length > 0 ? { inFolder } : {}),
    ...(chat.success ? { chatId: chat.data } : {}),
    ...(context.length > 0 ? { context } : {}),
    createdAt: created,
    folder: dir,
    id: draft.id,
    ...(send === undefined ? {} : { send }),
    ...(draft.project === undefined ? {} : { projectId: draft.project }),
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
  const {
    attached: _attached,
    folder: _folder,
    inFolder: _inFolder,
    ...rest
  } = current;
  return {
    ...rest,
    ...(attached.length > 0 ? { attached } : {}),
    ...(read.folder === undefined ? {} : { folder: read.folder }),
    ...(read.inFolder === undefined ? {} : { inFolder: read.inFolder }),
  };
}

/** A draft's send as its file writes it: `send`, else `sending` with its `sender` and, once its message is written, `sent`. */
function sendLinesOf(
  send: DraftSend | undefined,
): Pick<DraftFile, "send" | "sender" | "sending" | "sent"> {
  switch (send?.stage) {
    case undefined: {
      return {};
    }
    case "asked": {
      return { send: send.device };
    }
    case "sending": {
      return { ...senderOf(send), sending: send.chatId };
    }
    case "sent": {
      return { ...senderOf(send), sending: send.chatId, sent: send.messageId };
    }
  }
}

/**
 * A draft's send as its file has it, one stage: a chat it is going into wins
 * over a device asked to send it, which a file written partway through an
 * asked send has both of.
 */
function sendOf(draft: DraftFile): DraftSend | undefined {
  const sending = ChatIdSchema.safeParse(draft.sending);
  if (sending.success) {
    const device = draft.sender === undefined ? {} : { device: draft.sender };
    return draft.sent === undefined
      ? { chatId: sending.data, ...device, stage: "sending" }
      : {
          chatId: sending.data,
          ...device,
          messageId: draft.sent,
          stage: "sent",
        };
  }
  return draft.send === undefined
    ? undefined
    : { device: draft.send, stage: "asked" };
}

function senderOf({ device }: { device?: string }): Pick<DraftFile, "sender"> {
  return device === undefined ? {} : { sender: device };
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
