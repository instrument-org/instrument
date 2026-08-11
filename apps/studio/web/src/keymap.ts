/**
 * Stands in for the native application menu.
 *
 * Every app-wide shortcut in Studio is a menu accelerator: the main process
 * turns it into an `AppCommand` and publishes it on `appCommands.events.command`
 * (see `shared/app-command.ts`). A browser has no menu, so nothing produces
 * those commands and the shortcuts appear dead. This listens for the same
 * chords and pushes the same commands onto that stream.
 *
 * Combinations the browser reserves for itself (Cmd+T, Cmd+W, Cmd+N) cannot be
 * intercepted from a page, so tab lifecycle stays mouse-driven here.
 */
import { type AppCommand } from "@/shared/app-command";

import { pushLive } from "./mock-rpc";

const COMMAND_PATH = "appCommands.events.command";

const CHORDS: Record<string, AppCommand> = {
  "mod+0": { type: "zoomReset" },
  "mod+,": { type: "openSettings" },
  "mod+/": { type: "openShortcutGuide" },
  "mod+[": { type: "navigateBack" },
  "mod+]": { type: "navigateForward" },
  "mod+b": { type: "toggleSidebar" },
  "mod+f": { type: "findInPage" },
  "mod+k": { type: "toggleCommandMenu" },
  "mod+shift+[": { type: "selectPrevious" },
  "mod+shift+]": { type: "selectNext" },
};

export function installKeymap() {
  window.addEventListener(
    "keydown",
    (event) => {
      const chord = chordFor(event);
      const command = chord ? CHORDS[chord] : undefined;
      if (!command) {
        return;
      }
      event.preventDefault();
      pushLive(COMMAND_PATH, command);
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
