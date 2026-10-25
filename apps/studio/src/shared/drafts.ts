import { type ChatId } from "@instrument-org/workspace/client";

/**
 * The drafts every window shows, and the one way they change.
 *
 * The main process owns them (`electron-main/drafts/draft-store.ts`): it is
 * the only writer of `Drafts/`, and it takes in what another device or a file
 * manager changes there. A window changes a draft by sending a {@link DraftOp}
 * and shows the drafts as main last said they were, with the ops it has sent
 * since applied over them, so its own changes show at once and a change from
 * elsewhere never undoes one still on its way. Both sides apply ops with
 * {@link applyDraftOps}, which is what makes the two agree.
 */

/** A file or folder on this computer picked to go with a draft, by its path. */
export interface ChosenItem {
  kind: "file" | "folder";
  path: string;
}

/**
 * One thing besides the words that goes with a draft's message, as its chip
 * shows it: a file or folder by its path, another chat, or something with
 * an address of its own (a web page, an app's front). Its file writes each
 * as a line of `context`.
 */
export type DraftContextItem =
  | ChosenItem
  | { chat: ChatId; kind: "chat" }
  | { kind: "link"; url: string };

/**
 * A file or folder given to a draft's composer, by its path on disk: what of
 * the composer outlasts the app. Bytes pasted in with no file behind them
 * are written to the draft's own folder first, and kept by that path.
 */
export type DraftAttachment =
  | {
      kind: "file";
      mediaType: string;
      name: string;
      path: string;
      size: number;
    }
  | { kind: "folder"; path: string };

/**
 * A draft: a chat not yet started, or a reply waiting in a chat. The two are
 * told apart by `chatId`, which a reply has from the moment it is made and a
 * new chat's draft never has.
 *
 * What it has gathered (sites, files, folders) is its tab group, kept with
 * the window's tabs under {@link draftGroupOf}; what its composer has besides
 * the words is kept in memory beside it, and the part of that with a place on
 * disk in `attached`. What else the person chose to go with the message is
 * `context`; what is on screen goes too, worked out at the moment, and is
 * never kept with the draft.
 *
 * `topicSource` is kept while the app runs and never written to the draft's
 * file.
 */
export interface Draft {
  /** What the composer was given that has a place on disk, so it comes back after a relaunch. */
  attached?: DraftAttachment[];
  /**
   * The chat a reply is for. A chat may have several, ready to be sent one
   * after another. Absent on a draft that opens a chat of its own.
   */
  chatId?: ChatId;
  /**
   * What the person chose to go with the message besides the words: the
   * files and folders the draft was opened on by name, and the chats they
   * added. Changed only by the person, so a chip taken off stays off.
   */
  context?: DraftContextItem[];
  createdAt: number;
  id: string;
  /**
   * What the draft's folder has that goes with the message, as main last
   * read the folder: everything in it but the draft's own file and the
   * system's clutter, whoever put it there. Main's alone, so a window never
   * changes it; a composer shows what turns up here and drops what goes.
   */
  inFolder?: DraftAttachment[];
  /**
   * The chat the draft is on its way into, from the press until the message
   * is written or the send fails. A draft being sent is neither a reply
   * waiting nor a draft to list: it is the message about to arrive. Its file
   * says so as `sending`, so a launch after a crash knows where to look for
   * the message and another device leaves the draft alone meanwhile.
   */
  sendingTo?: ChatId;
  topicId?: string;
  /**
   * Who settled the topic: the person, by picking or clearing one, or the
   * decision model, from what the draft says. Absent while neither has. A
   * topic the model suggested is not written to the file.
   */
  topicSource?: "chosen" | "suggested";
  updatedAt: number;
  words: string;
}

/** The fields an update may set; the draft's identity, its send and its folder are not among them. */
type DraftFields = Omit<Draft, "createdAt" | "id" | "inFolder" | "sendingTo">;

/**
 * One change to the drafts. Each names the draft it changes and carries
 * everything it needs, the time included, so applying it here and in main
 * comes to the same draft.
 */
export type DraftOp =
  /** A draft made, with an id the window minted. Ignored where the id is taken. */
  | { draft: Draft; type: "create" }
  /** Pointed at the chat it is about to be sent into, with the words it is sent with. */
  | { at: number; chatId: ChatId; id: string; type: "claim"; words: string }
  /** Thrown away, or emptied by hand: gone, with what was pasted into it. */
  | { id: string; type: "remove" }
  /** A send that failed: the draft is the person's again, as it was before the press. */
  | { id: string; type: "release" }
  /** The message naming the draft is written, so the draft is gone and stays gone. */
  | { id: string; type: "sent" }
  /**
   * Fields set and fields cleared, stamped with when unless `at` is left out,
   * which leaves the draft as new as it was. Ignored for a draft that is gone.
   */
  | {
      at?: number;
      id: string;
      set: Partial<DraftFields>;
      type: "update";
      unset?: OptionalField[];
    };

/** The fields a draft can be without, which are the ones an update can clear. */
type OptionalField = {
  [K in keyof DraftFields]-?: undefined extends DraftFields[K] ? K : never;
}[keyof DraftFields];

/** Main's drafts as a window receives them, with the last op it applied from each window. */
export interface DraftsSnapshot {
  /** By window: the `seq` of the last op main applied from it. */
  acks: Record<string, number>;
  /** Every draft, oldest first. */
  drafts: Draft[];
}

/** A batch of ops from one window, numbered so main can say which it has applied. */
export interface DraftOpBatch {
  /** The window sending, by the id it made for itself as it loaded. */
  client: string;
  ops: DraftOp[];
  /** Counts up per window; the batch's last op is applied when an ack reaches it. */
  seq: number;
}

/**
 * The IPC channels between a window and main's drafts: `load` is the
 * preload's synchronous read as the window loads, `apply` a batch of ops,
 * `stage` bytes pasted into a draft, `trash` a file taken out of a draft's
 * folder, and `changed` main telling every window what the drafts are now.
 */
export const DRAFTS_CHANNEL = {
  apply: "drafts:apply",
  changed: "drafts:changed",
  load: "drafts:load",
  stage: "drafts:stage",
  trash: "drafts:trash",
} as const;

/** What `trash` is given: a file or folder in one draft's folder, by its path. */
export interface DraftTrashRequest {
  draftId: string;
  path: string;
}

/** What `stage` is given: bytes with no file behind them, base64, for one draft. */
export interface DraftStageRequest {
  content: string;
  draftId: string;
  itemId: string;
  name: string;
}

/** A window's side of main's drafts, as the preload hands it over. */
export interface DraftsBridge {
  /** Sends a batch, answered once main has applied it and written it through. */
  apply: (batch: DraftOpBatch) => Promise<void>;
  /** The drafts as the window loaded. */
  initial: DraftsSnapshot;
  /** Every change main makes, from any window or from disk; returns the stop. */
  onChange: (listener: (snapshot: DraftsSnapshot) => void) => () => void;
  /** Writes pasted bytes into the draft's own folder; answers where. */
  stage: (
    request: DraftStageRequest,
  ) => Promise<{ path: string; size: number }>;
  /** Moves something in the draft's folder to the Trash; nothing for a path outside it. */
  trash: (request: DraftTrashRequest) => Promise<void>;
}

/** Applies ops in order. A draft not changed keeps its object, so a list can tell what changed. */
export function applyDraftOps(drafts: Draft[], ops: DraftOp[]): Draft[] {
  return ops.reduce(applyDraftOp, drafts);
}

function applyDraftOp(drafts: Draft[], op: DraftOp): Draft[] {
  switch (op.type) {
    case "create": {
      return drafts.some((draft) => draft.id === op.draft.id)
        ? drafts
        : [...drafts, op.draft];
    }
    case "claim": {
      return changeDraft(drafts, op.id, (draft) => ({
        ...draft,
        sendingTo: op.chatId,
        updatedAt: op.at,
        words: op.words,
      }));
    }
    case "release": {
      return changeDraft(
        drafts,
        op.id,
        ({ sendingTo: _sending, ...draft }) => draft,
      );
    }
    case "remove":
    case "sent": {
      return drafts.some((draft) => draft.id === op.id)
        ? drafts.filter((draft) => draft.id !== op.id)
        : drafts;
    }
    case "update": {
      return changeDraft(drafts, op.id, (draft) => {
        const next: Draft = {
          ...draft,
          ...op.set,
          ...(op.at === undefined ? {} : { updatedAt: op.at }),
        };
        for (const key of op.unset ?? []) {
          delete next[key];
        }
        return next;
      });
    }
  }
}

function changeDraft(
  drafts: Draft[],
  id: string,
  change: (draft: Draft) => Draft,
): Draft[] {
  return drafts.map((draft) => (draft.id === id ? change(draft) : draft));
}

/**
 * The update that turns `from` into `to`, field by field, or nothing where
 * they agree: what a change worked out against the whole draft is sent as,
 * so it touches only what it changed and a change from elsewhere to another
 * field stands.
 */
export function draftUpdateOf(
  from: Draft,
  to: Draft,
  /** When, to stamp the draft with; null leaves it as new as it was. */
  at: null | number,
): Extract<DraftOp, { type: "update" }> | undefined {
  const set: Record<string, unknown> = {};
  const unset: OptionalField[] = [];
  const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
  for (const key of keys) {
    if (!isField(key)) {
      continue;
    }
    const after = to[key];
    if (after === undefined) {
      if (from[key] !== undefined && isOptionalField(key)) {
        unset.push(key);
      }
    } else if (JSON.stringify(from[key]) !== JSON.stringify(after)) {
      set[key] = after;
    }
  }
  if (Object.keys(set).length === 0 && unset.length === 0) {
    return undefined;
  }
  return {
    ...(at === null ? {} : { at }),
    id: from.id,
    // Each value is the one `to` has under that key.
    set: set as Partial<DraftFields>,
    type: "update",
    ...(unset.length > 0 ? { unset } : {}),
  };
}

/** The keys an update may carry: every key but the draft's identity, its send, its folder, and its stamp. */
function isField(key: string): key is keyof DraftFields {
  return (
    key !== "createdAt" &&
    key !== "id" &&
    key !== "inFolder" &&
    key !== "sendingTo" &&
    key !== "updatedAt"
  );
}

function isOptionalField(key: keyof DraftFields): key is OptionalField {
  return key !== "words";
}

/** Whether a draft has anything in it worth keeping: words, or something attached or in its folder. */
export function holdsSomething(draft: Draft): boolean {
  return (
    draft.words.trim() !== "" ||
    (draft.attached ?? []).length > 0 ||
    (draft.inFolder ?? []).length > 0
  );
}

/** A chat's replies waiting, the ones on their way left out. */
export function repliesOf(drafts: Draft[], chatId: ChatId): Draft[] {
  return drafts.filter(
    (draft) => draft.chatId === chatId && draft.sendingTo === undefined,
  );
}

/** The group key a draft's tabs are kept under. */
export function draftGroupOf(draftId: string): string {
  return `draft:${draftId}`;
}

/** The draft a group key names, if it names one. */
export function draftOfGroup(group: string | undefined): string | undefined {
  return group?.startsWith("draft:") ? group.slice("draft:".length) : undefined;
}
