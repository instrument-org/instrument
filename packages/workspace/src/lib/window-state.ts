import fs from "node:fs/promises";
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
});

export interface WindowState {
  /**
   * The chat each app was asked for in, by slug: what sends the news of a
   * sign-in, a key, or a decline back to the chat that asked for it.
   */
  appChats?: Record<string, ChatId>;
  /** The tab on screen, which a chat's own `agent-browser` drives. */
  browserTargetId?: z.output<typeof BrowserTargetIdSchema>;
}

/** Makes the window's folder, which its tabs' store opens inside. */
export async function ensureWindowDir(): Promise<void> {
  await fs.mkdir(windowDir(), { recursive: true });
}

/**
 * The window's state, empty when nothing has been written or the file cannot
 * be read: an app's chat lost costs a note sent to the newest chat, never
 * anything in a chat.
 */
export async function getWindowState(): Promise<WindowState> {
  const read = await readJsonRecord(windowStatePath());
  return read.kind === "read" ? readState(read.record).state : {};
}

/**
 * Applies a change to the window's state, read inside the file's write queue,
 * so the tab on screen changing and an app ask landing at once cannot each
 * write over the other. A field this build cannot read is carried
 * forward. A file that is not a JSON object is set aside beside it before a
 * fresh one is started, since what it held costs little; one that cannot
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
        ...(converted ? { appChats: state.appChats } : {}),
        ...changes,
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
  return {
    converted,
    state: {
      ...(appChats ? { appChats } : {}),
      ...(stored.browserTargetId
        ? { browserTargetId: stored.browserTargetId }
        : {}),
    },
  };
}
