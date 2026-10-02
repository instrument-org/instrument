import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { StoreId } from "../schemas/store-id";
import { BrowserTargetIdSchema } from "../types";
import { createWriteQueue } from "./create-write-queue";
import { renameWhenAllowed } from "./task-record";
import { windowDir, windowStatePath } from "./window-paths";

/**
 * What the app window keeps about the chats rather than any one of them,
 * in `.instrument/window.json` at the workspace root.
 */
export const WindowStateSchema = z.object({
  /**
   * The chat each app was asked for in, by slug: what sends the news of a
   * sign-in, a key, or a decline back to the chat that asked for it.
   */
  appChats: z.record(z.string(), StoreId.SessionSchema).optional(),
  /** The tab on screen, which a chat's own `agent-browser` drives. */
  browserTargetId: BrowserTargetIdSchema.optional(),
  /**
   * The newest settled message the user has seen in each chat, by session
   * id. Unread is every non-user message after it.
   */
  chatSeen: z.record(z.string(), StoreId.MessageSchema).optional(),
});

export type WindowState = z.output<typeof WindowStateSchema>;

const enqueue = createWriteQueue();

/** Makes the window's folder, which its tabs' store opens inside. */
export async function ensureWindowDir(): Promise<void> {
  await fs.mkdir(windowDir(), { recursive: true });
}

/**
 * The window's state, empty when nothing has been written or the file cannot
 * be read: a seen mark or an app's chat lost costs a dot or a note sent to
 * the newest chat, never anything in a chat.
 */
export async function getWindowState(): Promise<WindowState> {
  return readWindowState(windowStatePath());
}

/**
 * Applies a change to the window's state, reading the current one inside a
 * write queue, so the window marking a chat seen and an app ask landing at
 * once cannot each write over the other.
 */
export async function updateWindowState(
  update: (state: WindowState) => Partial<WindowState>,
): Promise<WindowState> {
  const target = windowStatePath();
  return enqueue(target, async () => {
    const current = await readWindowState(target);
    const next = { ...current, ...update(current) };
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(next, null, 2));
      await renameWhenAllowed(temporary, target);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
    return next;
  });
}

async function readWindowState(target: string): Promise<WindowState> {
  try {
    const parsed = WindowStateSchema.safeParse(
      JSON.parse(await fs.readFile(target, "utf8")),
    );
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}
