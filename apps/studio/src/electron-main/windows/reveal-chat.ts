import {
  getAppWindow,
  openAppScreen,
} from "@/electron-main/windows/app-window";
import { getForegroundWindow } from "@/electron-main/windows/foreground";
import { type ChatId } from "@instrument-org/workspace/electron";

/**
 * Bring a chat into view from outside the app: today, a completion
 * notification the user clicked. It opens in the inbox when the window
 * raised is the app window, or in the app window this opens when every
 * window was closed.
 */
export function revealChat(id: ChatId) {
  const target = getForegroundWindow();
  if (!target) {
    openAppScreen(`/chats/${id}`);
    return;
  }

  if (target.isMinimized()) {
    target.restore();
  }
  target.show();
  target.focus();
  if (target === getAppWindow()) {
    openAppScreen(`/chats/${id}`);
  }
}
