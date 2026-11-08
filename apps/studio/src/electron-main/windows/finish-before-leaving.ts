import { LEAVING_CHANNEL } from "@/shared/leaving";
import { ipcMain, type WebContents } from "electron";

import { logger } from "../lib/electron-logger";

/**
 * How long a quit waits on the windows to finish what they put off. What
 * they send is a few small writes to main, so a window that has not answered
 * by then is one that cannot (still loading, its page gone) and the quit goes
 * on without it.
 */
export const FINISH_BEFORE_LEAVING_MS = 2000;

let tokens = 0;

/**
 * Asks each window to finish what it has put off (`client/lib/before-leaving.ts`)
 * and settles once every one has answered, or at `deadlineMs`. A quit ends in
 * `app.exit`, which unloads no page, so this is the only way a deletion still
 * offering Undo, or typing not yet written into its draft, reaches main
 * before the process goes.
 */
export async function finishBeforeLeaving(
  windows: readonly WebContents[],
  { deadlineMs = FINISH_BEFORE_LEAVING_MS }: { deadlineMs?: number } = {},
): Promise<void> {
  const asking = windows.filter((contents) => !contents.isDestroyed());
  if (asking.length === 0) {
    return;
  }
  tokens += 1;
  const token = `leaving-${tokens.toString()}`;
  const waiting = new Set(asking.map((contents) => contents.id));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onDone:
    | ((event: { sender: WebContents }, said: unknown) => void)
    | undefined;
  try {
    await new Promise<void>((resolve) => {
      onDone = ({ sender }, said) => {
        if (said !== token) {
          return;
        }
        waiting.delete(sender.id);
        if (waiting.size === 0) {
          resolve();
        }
      };
      ipcMain.on(LEAVING_CHANNEL.done, onDone);
      timer = setTimeout(resolve, deadlineMs);
      for (const contents of asking) {
        contents.send(LEAVING_CHANNEL.ask, token);
      }
    });
  } finally {
    clearTimeout(timer);
    if (onDone) {
      ipcMain.off(LEAVING_CHANNEL.done, onDone);
    }
  }
  if (waiting.size > 0) {
    logger.warn(
      `Quit went on without ${waiting.size.toString()} window(s) finishing what they put off`,
    );
  }
}
