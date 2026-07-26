import { sendAppCommand } from "@/electron-main/app-command";
import {
  type Input,
  type MenuItemConstructorOptions,
  type WebContents,
} from "electron";

interface Shortcut {
  accelerator: string;
  label: string;
  /**
   * Whether the chord has to beat the focused page. Electron offers the native
   * menu only the key events web content left unhandled, and Chromium keeps the
   * editing chords for itself whenever a contenteditable has focus, so an
   * unreserved chord stops working the moment the caret enters the prompt
   * editor. Reserve only what the app owns outright: anything an editor
   * legitimately uses (Mod-Z to undo) belongs to the page.
   */
  reserved: boolean;
  run: () => void;
}

// Checks each entry against Shortcut without narrowing it to its literal
// values, so `reserved` stays a boolean the binder can filter on.
const defineShortcut = (shortcut: Shortcut) => shortcut;

/**
 * Shortcuts declared once and consumed everywhere: the native menu builds its
 * items from these, and the reserved ones are also run from the main process
 * ahead of the page.
 */
export const SHORTCUTS = {
  toggleSidebar: defineShortcut({
    accelerator: "CmdOrCtrl+B",
    label: "Toggle Sidebar",
    reserved: true,
    run: () => {
      sendAppCommand({ type: "toggleSidebar" });
    },
  }),
};

/**
 * Runs the reserved shortcuts ahead of the page's own key handling.
 * `preventDefault` here also suppresses the matching menu accelerator, so each
 * chord still fires exactly once.
 */
export function bindReservedShortcuts(webContents: WebContents) {
  const reserved = Object.values(SHORTCUTS).filter(
    (shortcut) => shortcut.reserved,
  );
  webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") {
      return;
    }
    const shortcut = reserved.find((candidate) =>
      matchesAccelerator(input, candidate.accelerator),
    );
    if (!shortcut) {
      return;
    }
    event.preventDefault();
    shortcut.run();
  });
}

export function shortcutMenuItem(
  shortcut: Shortcut,
): MenuItemConstructorOptions {
  return {
    accelerator: shortcut.accelerator,
    click: shortcut.run,
    label: shortcut.label,
  };
}

// Reserving a chord means matching it against a raw key event, which only
// `CmdOrCtrl+<key>` accelerators do here. Anything richer never matches rather
// than matching loosely, so a shortcut that outgrows the shape fails loudly the
// first time it's pressed instead of firing on the wrong chord.
function matchesAccelerator(input: Input, accelerator: string) {
  const [modifier, key, ...rest] = accelerator.split("+");
  if (modifier !== "CmdOrCtrl" || !key || rest.length > 0) {
    return false;
  }
  if (
    input.alt ||
    input.shift ||
    input.key.toLowerCase() !== key.toLowerCase()
  ) {
    return false;
  }
  return process.platform === "darwin"
    ? input.meta && !input.control
    : input.control && !input.meta;
}
