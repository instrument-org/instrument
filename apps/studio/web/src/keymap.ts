/**
 * Stands in for the native application menu.
 *
 * Every app-wide shortcut in Studio is a menu accelerator: the main process
 * turns it into a command and publishes it on `window.events.command`, or
 * for zoom on `appCommands.events.command` (see `shared/app-command.ts`). A
 * browser has no menu, so nothing produces those commands and the shortcuts
 * appear dead. This listens for the same chords and pushes the same commands
 * onto those streams.
 *
 * Combinations the browser reserves for itself (Cmd+T, Cmd+W, Cmd+N) cannot be
 * intercepted from a page, so tab lifecycle stays mouse-driven here.
 */
import { type AppCommand } from "@/shared/app-command";

import { pushLive } from "./mock-rpc";

type WindowCommand =
  | "back"
  | "findInPage"
  | "forward"
  | "openSettings"
  | "search"
  | "toggleInbox";

const APP_COMMAND_PATH = "appCommands.events.command";
const WINDOW_COMMAND_PATH = "window.events.command";

const APP_CHORDS: Record<string, AppCommand> = {
  "mod+0": { type: "zoomReset" },
};

const WINDOW_CHORDS: Record<string, WindowCommand> = {
  "mod+,": "openSettings",
  "mod+[": "back",
  "mod+]": "forward",
  "mod+b": "toggleInbox",
  "mod+f": "findInPage",
  "mod+l": "search",
};

export function installKeymap() {
  window.addEventListener(
    "keydown",
    (event) => {
      const chord = chordFor(event);
      if (!chord) {
        return;
      }
      const appCommand = APP_CHORDS[chord];
      const windowCommand = WINDOW_CHORDS[chord];
      if (appCommand) {
        pushLive(APP_COMMAND_PATH, appCommand);
      } else if (windowCommand) {
        pushLive(WINDOW_COMMAND_PATH, windowCommand);
      } else {
        return;
      }
      event.preventDefault();
    },
    { capture: true },
  );
}

function chordFor(event: KeyboardEvent): string | undefined {
  if (!event.metaKey && !event.ctrlKey) {
    return;
  }
  const parts = ["mod"];
  if (event.shiftKey) {
    parts.push("shift");
  }
  parts.push(event.key.toLowerCase());
  return parts.join("+");
}
