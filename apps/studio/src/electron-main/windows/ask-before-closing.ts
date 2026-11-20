import {
  WINDOW_CLOSE_CHANNEL,
  type WindowCloseAnswer,
} from "@/shared/window-close";
import { ipcMain, type WebContents } from "electron";

/**
 * How long a window has to answer before its close goes ahead anyway: a
 * page that is stuck, or loading afresh, must not hold the window open.
 * Once it says it is asking the person, the close waits on them instead.
 */
const WINDOW_CLOSE_ANSWER_MS = 1500;

let tokens = 0;

/**
 * Asks a window whether a close the person asked for may go ahead, which it
 * answers after asking about the chats the close would stop
 * (`shared/window-close.ts`). True to close: at once from a window with
 * nothing to ask, on its deadline from one that does not answer, and once
 * its page is gone.
 */
export function askBeforeClosing(
  contents: WebContents,
  { answerMs = WINDOW_CLOSE_ANSWER_MS }: { answerMs?: number } = {},
): Promise<boolean> {
  if (contents.isDestroyed()) {
    return Promise.resolve(true);
  }
  tokens += 1;
  const token = `close-${tokens.toString()}`;
  return new Promise<boolean>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (isClosing: boolean) => {
      clearTimeout(timer);
      ipcMain.off(WINDOW_CLOSE_CHANNEL.answer, onAnswer);
      contents.off("destroyed", onGone);
      contents.off("render-process-gone", onGone);
      resolve(isClosing);
    };
    const onAnswer = (
      { sender }: { sender: WebContents },
      said: unknown,
      answer: WindowCloseAnswer,
    ) => {
      if (sender.id !== contents.id || said !== token) {
        return;
      }
      if (answer === "asking") {
        clearTimeout(timer);
        return;
      }
      settle(answer !== "stay");
    };
    const onGone = () => {
      settle(true);
    };
    ipcMain.on(WINDOW_CLOSE_CHANNEL.answer, onAnswer);
    contents.once("destroyed", onGone);
    contents.once("render-process-gone", onGone);
    timer = setTimeout(() => {
      settle(true);
    }, answerMs);
    contents.send(WINDOW_CLOSE_CHANNEL.ask, token);
  });
}
