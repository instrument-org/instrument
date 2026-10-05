import {
  getAppWindow,
  openAppScreen,
} from "@/electron-main/windows/app-window";
import { getForegroundWindow } from "@/electron-main/windows/foreground";
import { type TaskId } from "@instrument-org/workspace/electron";

/**
 * Bring a task into view from outside the app: today, a completion
 * notification the user clicked.
 *
 * A chat opens in the inbox. Raising the window is the whole of what a click
 * does for anything else.
 */
export function revealTask({
  id,
  isChat = false,
}: {
  id: TaskId;
  /** A chat of the conversation rather than a task: its id is the chat's address. */
  isChat?: boolean;
}) {
  const target = getForegroundWindow();
  if (!target) {
    return;
  }

  if (target.isMinimized()) {
    target.restore();
  }
  target.show();
  target.focus();
  if (isChat && target === getAppWindow()) {
    openAppScreen(`/chats/${id}`);
  }
}
