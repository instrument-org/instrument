import { type Draft } from "@/shared/drafts";
import { TabIdSchema } from "@/shared/tabs";
import { ChatIdSchema } from "@instrument-org/workspace/electron";
import {
  type DraftAttached,
  type DraftFile,
  type DraftOnDisk,
} from "@instrument-org/workspace/drafts";
import path from "node:path";
import { z } from "zod";

/**
 * The translation between a draft as every window has it ({@link Draft}) and
 * as its file holds it ({@link DraftFile}): the keys the file names, and the
 * rest of the draft under the file's `state`.
 *
 * What is read from `state` is checked, since the file is a document anyone
 * can edit: a key holding something this build cannot use is left out of the
 * draft rather than handed to a window that would map over it, and a key it
 * does not know at all is carried through as it was found.
 */

const ChosenSchema = z.object({
  kind: z.enum(["file", "folder"]),
  path: z.string(),
});

/** What a draft keeps under `state`, each checked on its own. */
const STATE_FIELDS = {
  chosen: z.array(ChosenSchema),
  included: z.union([
    z.object({ appTabId: TabIdSchema }),
    z.object({ chat: ChatIdSchema }),
    z.object({ group: z.string(), tabId: z.string() }),
  ]),
  leftOut: z.array(z.string()),
  topicSource: z.enum(["chosen", "suggested"]),
};

/** The keys of a draft the file holds by name rather than under `state`. */
const FILE_KEYS = new Set<string>([
  "attached",
  "chatId",
  "createdAt",
  "id",
  "send",
  "sendOn",
  "sendingTo",
  "topicId",
  "updatedAt",
  "words",
]);

/**
 * The draft as its file holds it. A path inside the draft's own folder is
 * kept relative to it, so the folder travels; `dir` is that folder, unknown
 * the first time a draft is written, when the folder it names is the one
 * about to be made.
 *
 * A draft on its way into a chat names that chat, so a launch after a crash
 * knows where to look for the message that says it was sent.
 */
export function draftFileOf(draft: Draft, dir: string | undefined): DraftFile {
  const state = Object.fromEntries(
    Object.entries(draft).filter(
      ([key, value]) => !FILE_KEYS.has(key) && value !== undefined,
    ),
  );
  const chat = draft.chatId ?? draft.sendingTo;
  const attached = attachedOf(draft, dir);
  return {
    ...(attached.length > 0 ? { attached } : {}),
    ...(chat === undefined ? {} : { chat }),
    created: new Date(draft.createdAt),
    id: draft.id,
    ...(draft.send === undefined ? {} : { send: draft.send }),
    ...(draft.sendOn === undefined ? {} : { sendOn: draft.sendOn }),
    ...(Object.keys(state).length > 0 ? { state } : {}),
    ...(draft.topicId === undefined ? {} : { topic: draft.topicId }),
    updated: new Date(draft.updatedAt),
    words: draft.words,
  };
}

/**
 * The draft its file holds, with every path it names absolute, since the
 * window shows and sends files by path. A `chat` that is no chat's id is
 * read as no chat, which makes the draft a new chat's rather than a reply
 * that could never be sent.
 */
export function draftOf({ dir, draft }: DraftOnDisk): Draft {
  const chat = ChatIdSchema.safeParse(draft.chat);
  const attached = (draft.attached ?? []).map((item) =>
    attachmentOf(item, dir),
  );
  return {
    ...stateOf(draft.state ?? {}),
    ...(attached.length > 0 ? { attached } : {}),
    ...(chat.success ? { chatId: chat.data } : {}),
    createdAt: draft.created.getTime(),
    id: draft.id,
    ...(draft.send === undefined ? {} : { send: draft.send }),
    ...(draft.sendOn === undefined ? {} : { sendOn: draft.sendOn }),
    ...(draft.topic === undefined ? {} : { topicId: draft.topic }),
    updatedAt: draft.updated.getTime(),
    words: draft.words,
  };
}

/** What of a file's `state` a draft takes in: each known key that checks out, and every unknown one as it is. */
function stateOf(state: Record<string, unknown>): Partial<Draft> {
  const read: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    if (FILE_KEYS.has(key)) {
      continue;
    }
    if (!isStateField(key)) {
      read[key] = value;
      continue;
    }
    const checked = STATE_FIELDS[key].safeParse(value);
    if (checked.success) {
      read[key] = checked.data;
    }
  }
  // Every known key was checked against its own schema above; what is left
  // is a newer build's, which this one only carries.
  return read as Partial<Draft>;
}

function isStateField(key: string): key is keyof typeof STATE_FIELDS {
  return Object.hasOwn(STATE_FIELDS, key);
}

function attachedOf(draft: Draft, dir: string | undefined): DraftAttached[] {
  return (draft.attached ?? []).map((item) => {
    const where =
      dir !== undefined && path.dirname(item.path) === dir
        ? path.basename(item.path)
        : item.path;
    return item.kind === "folder"
      ? { kind: "folder", path: where }
      : {
          kind: "file",
          mediaType: item.mimeType,
          name: item.name,
          path: where,
          size: item.size,
        };
  });
}

function attachmentOf(
  item: DraftAttached,
  dir: string,
): NonNullable<Draft["attached"]>[number] {
  const where = path.isAbsolute(item.path)
    ? item.path
    : path.join(dir, item.path);
  return item.kind === "folder"
    ? { kind: "folder", path: where }
    : {
        kind: "file",
        mimeType: item.mediaType ?? "application/octet-stream",
        name: item.name ?? path.basename(where),
        path: where,
        size: item.size ?? 0,
      };
}
