import fs from "node:fs/promises";
import { encodeTime } from "ulid";
import { z } from "zod";

import { type ChatId, ChatIdSchema } from "../schemas/chat-id";
import { StoreId } from "../schemas/store-id";
import { BrowserTargetIdSchema } from "../types";
import {
  type JsonRecord,
  readJsonRecord,
  updateJsonRecord,
} from "./json-record-file";
import { chatOfSession } from "./record-folders";
import { windowDir, windowStatePath } from "./window-paths";

/**
 * What the app window keeps about the chats rather than any one of them,
 * in `.instrument/window.json` at the workspace root.
 *
 * Each field is read on its own, so one this build cannot read (written by a
 * newer build, or edited by hand) reads as absent without costing the others,
 * and stays in the file until something replaces it.
 */
const StoredWindowStateSchema = z.object({
  /**
   * The chat each app was asked for in, by slug. 2.0 betas wrote a chat's
   * session id here, which reads as the chat it is.
   */
  appChats: z
    .record(z.string(), z.union([StoreId.SessionSchema, ChatIdSchema]))
    .optional()
    .catch(undefined),
  browserTargetId: BrowserTargetIdSchema.optional().catch(undefined),
  /** By chat id, or by a chat's session id where a 2.0 beta wrote it. */
  chatSeen: z
    .record(z.string(), StoreId.MessageSchema)
    .optional()
    .catch(undefined),
  seenFloor: StoreId.MessageSchema.optional().catch(undefined),
});

export interface WindowState {
  /**
   * The chat each app was asked for in, by slug: what sends the news of a
   * sign-in, a key, or a decline back to the chat that asked for it.
   */
  appChats?: Record<string, ChatId>;
  /** The tab on screen, which a chat's own `agent-browser` drives. */
  browserTargetId?: z.output<typeof BrowserTargetIdSchema>;
  /**
   * The newest settled message the user has seen in each chat, by chat id.
   * Unread is every non-user message after it.
   */
  chatSeen?: Record<string, StoreId.Message>;
  /**
   * Where unread starts for a chat with no seen mark of its own: a message
   * id stamped with the time this workspace's window state began, so what
   * was said before the window kept marks counts as seen and what was said
   * since counts as new. Written once, by whatever first reads or writes the
   * window's state with none recorded.
   */
  seenFloor?: StoreId.Message;
}

/**
 * A seen mark below every message: the chat it is recorded for counts every
 * finished reply as unread, floor or not.
 */
export const NOTHING_SEEN = StoreId.MessageSchema.parse(
  `msg_${"0".repeat(26)}`,
);

/**
 * The window's state with its seen floor recorded. The floor's random half
 * is all zeros, so a message made in the same millisecond still counts as
 * new.
 */
function withSeenFloor(state: WindowState): WindowState {
  return state.seenFloor
    ? state
    : {
        ...state,
        seenFloor: StoreId.MessageSchema.parse(
          `msg_${encodeTime(Date.now())}${"0".repeat(16)}`,
        ),
      };
}

/** Makes the window's folder, which its tabs' store opens inside. */
export async function ensureWindowDir(): Promise<void> {
  await fs.mkdir(windowDir(), { recursive: true });
}

/**
 * The window's state, empty but for its seen floor when nothing has been
 * written or the file cannot be read: a seen mark or an app's chat lost
 * costs a dot or a note sent to the newest chat, never anything in a chat.
 * The first read records the floor; one that cannot be written stands for
 * this read alone.
 */
export async function getWindowState(): Promise<WindowState> {
  const read = await readJsonRecord(windowStatePath());
  const state = read.kind === "read" ? readState(read.record).state : {};
  if (state.seenFloor) {
    return state;
  }
  try {
    return await updateWindowState(() => ({}));
  } catch {
    return withSeenFloor(state);
  }
}

/**
 * Applies a change to the window's state, read inside the file's write queue,
 * so the window marking a chat seen and an app ask landing at once cannot
 * each write over the other. A field this build cannot read is carried
 * forward. A file that is not a JSON object is set aside beside it before a
 * fresh one is started, since what it held costs only dots; one that cannot
 * be opened refuses the write.
 */
export async function updateWindowState(
  update: (state: WindowState) => Partial<WindowState>,
): Promise<WindowState> {
  const written = await updateJsonRecord(
    windowStatePath(),
    (raw) => {
      const { converted, state } = readState(raw);
      const changes = update(state);
      return {
        // What was read under a session's name is written under the chat's.
        ...(converted
          ? { appChats: state.appChats, chatSeen: state.chatSeen }
          : {}),
        ...changes,
        seenFloor: withSeenFloor({ ...state, ...changes }).seenFloor,
      };
    },
    { unreadable: "set-aside" },
  );
  return readState(written).state;
}

/**
 * What this build reads of the file, each field on its own, with a chat
 * named by its session (as 2.0 betas wrote them) named by its id, and one
 * whose chat is gone dropped. `converted` says the file still holds the
 * older names, so the next write replaces them.
 */
function readState(raw: JsonRecord): {
  converted: boolean;
  state: WindowState;
} {
  const stored = StoredWindowStateSchema.parse(raw);
  let converted = false;
  const chatOf = (ref: string): ChatId | undefined => {
    const session = StoreId.SessionSchema.safeParse(ref);
    if (!session.success) {
      return ChatIdSchema.safeParse(ref).data;
    }
    converted = true;
    return chatOfSession(session.data);
  };
  const appChats =
    stored.appChats &&
    Object.fromEntries(
      Object.entries(stored.appChats).flatMap(([slug, ref]) => {
        const chatId = chatOf(ref);
        return chatId ? [[slug, chatId]] : [];
      }),
    );
  const chatSeen =
    stored.chatSeen &&
    Object.fromEntries(
      // A mark under the chat's own id wins over one under its session.
      Object.entries(stored.chatSeen)
        .flatMap(([ref, seen]) => {
          const chatId = chatOf(ref);
          return chatId ? [{ chatId, own: chatId === ref, seen }] : [];
        })
        .toSorted((a, b) => Number(a.own) - Number(b.own))
        .map(({ chatId, seen }) => [chatId, seen]),
    );
  return {
    converted,
    state: {
      ...(appChats ? { appChats } : {}),
      ...(stored.browserTargetId
        ? { browserTargetId: stored.browserTargetId }
        : {}),
      ...(chatSeen ? { chatSeen } : {}),
      ...(stored.seenFloor ? { seenFloor: stored.seenFloor } : {}),
    },
  };
}
