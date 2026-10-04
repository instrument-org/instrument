import fs from "node:fs/promises";
import { encodeTime } from "ulid";
import { z } from "zod";

import { StoreId } from "../schemas/store-id";
import { BrowserTargetIdSchema } from "../types";
import {
  type JsonRecord,
  readJsonRecord,
  updateJsonRecord,
} from "./json-record-file";
import { windowDir, windowStatePath } from "./window-paths";

/**
 * What the app window keeps about the chats rather than any one of them,
 * in `.instrument/window.json` at the workspace root.
 *
 * Each field is read on its own, so one this build cannot read (written by a
 * newer build, or edited by hand) reads as absent without costing the others,
 * and stays in the file until something replaces it.
 */
const WindowStateSchema = z.object({
  /**
   * The chat each app was asked for in, by slug: what sends the news of a
   * sign-in, a key, or a decline back to the chat that asked for it.
   */
  appChats: z
    .record(z.string(), StoreId.SessionSchema)
    .optional()
    .catch(undefined),
  /** The tab on screen, which a chat's own `agent-browser` drives. */
  browserTargetId: BrowserTargetIdSchema.optional().catch(undefined),
  /**
   * The newest settled message the user has seen in each chat, by session
   * id. Unread is every non-user message after it.
   */
  chatSeen: z
    .record(z.string(), StoreId.MessageSchema)
    .optional()
    .catch(undefined),
  /**
   * Where unread starts for a chat with no seen mark of its own: a message
   * id stamped with the time this workspace's window state began, so what
   * was said before the window kept marks counts as seen and what was said
   * since counts as new. Written once, by whatever first reads or writes the
   * window's state with none recorded.
   */
  seenFloor: StoreId.MessageSchema.optional().catch(undefined),
});

export type WindowState = z.output<typeof WindowStateSchema>;

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
  const state = read.kind === "read" ? stateOf(read.record) : {};
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
  return stateOf(
    await updateJsonRecord(
      windowStatePath(),
      (raw) => {
        const state = stateOf(raw);
        const changes = update(state);
        return {
          ...changes,
          seenFloor: withSeenFloor({ ...state, ...changes }).seenFloor,
        };
      },
      { unreadable: "set-aside" },
    ),
  );
}

/** What this build reads of the file, each field on its own. */
function stateOf(raw: JsonRecord): WindowState {
  return WindowStateSchema.parse(raw);
}
