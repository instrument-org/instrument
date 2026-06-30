import {
  AGENT_BROWSER_GUEST_NAVIGATE_CHANNEL,
  type AgentBrowserNavDirection,
} from "@/shared/agent-browser";
import { ipcRenderer } from "electron";

// Injected into the agent-browser guest. macOS delivers mouse thumb buttons to
// the page's DOM rather than as a window `app-command`, so listen for buttons
// 3/4 here and forward them to main, which navigates the guest's history.

function directionFor(event: MouseEvent): AgentBrowserNavDirection | null {
  if (event.button === 3) {
    return "back";
  }
  if (event.button === 4) {
    return "forward";
  }
  return null;
}

function navigate(event: MouseEvent) {
  const direction = directionFor(event);
  if (!event.isTrusted || !direction) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  ipcRenderer.send(AGENT_BROWSER_GUEST_NAVIGATE_CHANNEL, direction);
}

// Swallow the press/aux-click so the page can't also act on it.
function suppress(event: MouseEvent) {
  if (directionFor(event)) {
    event.preventDefault();
    event.stopPropagation();
  }
}

window.addEventListener("mousedown", suppress, { capture: true });
window.addEventListener("auxclick", suppress, { capture: true });
window.addEventListener("mouseup", navigate, { capture: true });
