import { openAppWindow } from "@/electron-main/windows/app-window";
import { getForegroundWindow } from "@/electron-main/windows/foreground";
import { windowsMayOpen } from "@/electron-main/windows/launch";
import { showPutAwayWindows } from "@/electron-main/windows/on-screen";

/**
 * Put the foreground window ({@link getForegroundWindow}) on screen, making one
 * if none is left. For the paths that have to leave the user somewhere: a
 * canceled quit, a deep link that arrived with every window closed. Outside
 * macOS a process with no window can't be reached again at all, so none of them
 * may end with nothing shown. Before the launch has opened the windows there
 * is none to show, and boot puts them up itself.
 */
export function ensureForegroundWindowVisible() {
  showPutAwayWindows();
  const target = getForegroundWindow();
  if (!target) {
    if (windowsMayOpen()) {
      openAppWindow();
    }
    return;
  }
  if (target.isMinimized()) {
    target.restore();
  }
  if (!target.isVisible()) {
    target.show();
  }
  target.focus();
}
