import { sendAppCommand } from "@/electron-main/app-command";
import { getForegroundWindow } from "@/electron-main/windows/foreground";
import { focusMainContents } from "@/electron-main/windows/main/controls";
import { getMainWindow } from "@/electron-main/windows/main/instance";
import { type StoreId, type TaskId } from "@instrument-org/workspace/electron";

/**
 * Bring a task into view from outside the app: today, a completion
 * notification the user clicked.
 *
 * The task opens in a tab, which only the classic window has. Raising the
 * window is the whole of what a click can do anywhere else, and raising the
 * right one matters more than the tab: the classic window is hidden under
 * Instrument 2.0, so showing it put a window the user had never opened over the
 * one they were working in.
 */
export function revealTask({
  id,
  sessionId,
}: {
  id: TaskId;
  sessionId: StoreId.Session;
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
  if (target === getMainWindow()) {
    focusMainContents();
    sendAppCommand({ id, sessionId, type: "focusTask" });
  }
}
