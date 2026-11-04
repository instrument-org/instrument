import {
  appWindowShowing,
  askWindow,
  openAppScreen,
} from "@/electron-main/windows/app-window";
import { getForegroundWindow } from "@/electron-main/windows/foreground";
import { type ChatId } from "@instrument-org/workspace/electron";

/**
 * Bring a chat into view from outside the app: today, a completion
 * notification the user clicked. The window that has it in a tab comes
 * forward with that tab up; with no such window it opens in a new tab of the
 * one last in front, or in the app window this opens when every window was
 * closed.
 */
export function revealChat(id: ChatId) {
  const href = `/chats/${id}`;
  const target = appWindowShowing(href) ?? getForegroundWindow();
  if (!target) {
    openAppScreen(href);
    return;
  }

  if (target.isMinimized()) {
    target.restore();
  }
  target.show();
  target.focus();
  askWindow(target, { href, type: "openScreen" });
}
