import fs from "node:fs/promises";
import path from "node:path";
import { encodeTime } from "ulid";
import { z } from "zod";

import { StoreId } from "../schemas/store-id";
import { BrowserTargetIdSchema } from "../types";
import { createWriteQueue } from "./create-write-queue";
import { renameWhenAllowed } from "./task-record";
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

const enqueue = createWriteQueue();

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
  let state: WindowState = {};
  try {
    ({ state } = await readWindowFile(windowStatePath()));
  } catch {
    // Unreadable as a file: read as empty, and leave it for the write to refuse.
  }
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
 * Applies a change to the window's state, reading the current one inside a
 * write queue, so the window marking a chat seen and an app ask landing at
 * once cannot each write over the other.
 *
 * The change is written over the file as it was on disk rather than over
 * what this build read of it, so a field it could not read is carried
 * forward. A file that is not JSON at all is set aside beside it before a
 * fresh one is started; one that cannot be read as a file refuses the write.
 */
export async function updateWindowState(
  update: (state: WindowState) => Partial<WindowState>,
): Promise<WindowState> {
  const target = windowStatePath();
  return enqueue(target, async () => {
    const { raw, state } = await readWindowFile(target, { setAside: true });
    const changes = update(state);
    const next = withSeenFloor({ ...state, ...changes });
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    try {
      await fs.writeFile(
        temporary,
        JSON.stringify(
          { ...raw, ...changes, seenFloor: next.seenFloor },
          null,
          2,
        ),
      );
      await renameWhenAllowed(temporary, target);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
    return next;
  });
}

/**
 * The file as it is on disk and what this build reads of it. Missing reads as
 * empty. Not a JSON object reads as empty too, after it is moved aside to
 * `window.json.unreadable-<time>` when `setAside` asks, so the write that
 * follows does not destroy the only copy. Anything else that stops the read
 * throws.
 */
async function readWindowFile(
  target: string,
  { setAside = false }: { setAside?: boolean } = {},
): Promise<{ raw: Record<string, unknown>; state: WindowState }> {
  let contents: string;
  try {
    contents = await fs.readFile(target, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { raw: {}, state: {} };
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    parsed = undefined;
  }
  const raw = z.record(z.string(), z.unknown()).safeParse(parsed);
  if (!raw.success) {
    if (setAside) {
      await fs.rename(target, `${target}.unreadable-${Date.now()}`);
    }
    return { raw: {}, state: {} };
  }
  return { raw: raw.data, state: WindowStateSchema.parse(raw.data) };
}
