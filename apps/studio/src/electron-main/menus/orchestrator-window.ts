import { getBrowserViewManager } from "@/electron-main/browser-view/manager";
import { matchesAccelerator } from "@/electron-main/menus/match-accelerator";
import { publisher } from "@/electron-main/rpc/publisher";
import {
  BrowserWindow,
  type MenuItemConstructorOptions,
  type WebContents,
} from "electron";

import { isDeveloperMode } from "../stores/preferences";
import { createOtherWindowViewMenu } from "./other-window";
import {
  createAppMenu,
  createDevToolsMenu,
  createEditMenu,
  createHelpMenu,
  createWindowMenu,
} from "./utils";

const IS_MAC = process.platform === "darwin";

/**
 * One chord of the window's own: the keys, what the menu calls it, and what
 * it does. The same row draws the menu item and answers the key, so a chord
 * cannot be in one place and not the other.
 */
interface WindowChord {
  accelerator: string;
  label: string;
  run: () => void;
  /** Drawn in the menu, or an accelerator alone behind a row already there. */
  visible?: boolean;
}

/** Sends a command to the window's renderer, which holds the tabs and the inbox. */
const command =
  (
    name:
      | "back"
      | "closeTab"
      | "findInPage"
      | "forward"
      | "newTab"
      | "newThread"
      | "nextTab"
      | "nextThread"
      | "previousTab"
      | "previousThread"
      | "reopenTab",
  ) =>
  () => {
    publisher.publish("orchestrator.command", name);
  };

const FILE_CHORDS: WindowChord[] = [
  // Where mail keeps New Message: a draft of a new thread, at the corner.
  {
    accelerator: "CmdOrCtrl+N",
    label: "New Thread",
    run: command("newThread"),
  },
  {
    accelerator: "CmdOrCtrl+L",
    label: "Search or Ask",
    run: () => {
      // The chord reaches the menu when a page guest has the keyboard, since
      // its keys never reach the window's own renderer. The field is the
      // window's, so the window (the one in front, which is this one while
      // its menu is up) takes the keyboard back before it is asked for.
      BrowserWindow.getFocusedWindow()?.webContents.focus();
      publisher.publish("orchestrator.command", "search");
    },
  },
  // The renderer opens the find bar in the page on screen, and does nothing
  // when none is.
  {
    accelerator: "CmdOrCtrl+F",
    label: "Find in Page",
    run: command("findInPage"),
  },
];

/**
 * Cmd+W closes the tab on screen and never the window, which has tabs the
 * user may be keeping; the window closes on Shift+Cmd+W, a role below.
 */
const TAB_CHORDS: WindowChord[] = [
  { accelerator: "CmdOrCtrl+T", label: "New Tab", run: command("newTab") },
  { accelerator: "CmdOrCtrl+W", label: "Close Tab", run: command("closeTab") },
  {
    accelerator: "Shift+CmdOrCtrl+T",
    label: "Reopen Closed Tab",
    run: command("reopenTab"),
  },
];

/**
 * Down and up the inbox from the thread on screen, in the order the list
 * shows. Alt with the command key, since Alt and an arrow alone moves the
 * caret by a word in the composer.
 */
const THREAD_CHORDS: WindowChord[] = [
  {
    accelerator: "Alt+CmdOrCtrl+Down",
    label: "Next Thread",
    run: command("nextThread"),
  },
  {
    accelerator: "Alt+CmdOrCtrl+Up",
    label: "Previous Thread",
    run: command("previousThread"),
  },
];

/**
 * The chords the main window's tab bar answers to, on whichever screen is up
 * here: next and previous by Ctrl+Tab and by Cmd+Shift+bracket, a tab by
 * place with Cmd+1 through Cmd+8, and the last with Cmd+9, as browsers do.
 */
const TAB_SWITCH_CHORDS: WindowChord[] = [
  { accelerator: "Ctrl+Tab", label: "Show Next Tab", run: command("nextTab") },
  {
    accelerator: "CmdOrCtrl+Shift+]",
    label: "Show Next Tab",
    run: command("nextTab"),
    visible: false,
  },
  {
    accelerator: "Ctrl+Shift+Tab",
    label: "Show Previous Tab",
    run: command("previousTab"),
  },
  {
    accelerator: "CmdOrCtrl+Shift+[",
    label: "Show Previous Tab",
    run: command("previousTab"),
    visible: false,
  },
  ...Array.from({ length: 9 }, (_, index) => ({
    accelerator: `CmdOrCtrl+${index + 1}`,
    label: index === 8 ? "Last Tab" : `Tab ${index + 1}`,
    run: () => {
      publisher.publish("orchestrator.command", {
        index: index + 1,
        type: "selectTab",
      });
    },
  })),
];

/**
 * A focused browser guest navigates its own history, the way the main
 * window's does; otherwise the window's screens do.
 */
const HISTORY_CHORDS: WindowChord[] = [
  {
    accelerator: "CmdOrCtrl+[",
    label: "Back",
    run: () => {
      if (!getBrowserViewManager()?.navigateFocusedGuest("back")) {
        publisher.publish("orchestrator.command", "back");
      }
    },
  },
  {
    accelerator: "CmdOrCtrl+]",
    label: "Forward",
    run: () => {
      if (!getBrowserViewManager()?.navigateFocusedGuest("forward")) {
        publisher.publish("orchestrator.command", "forward");
      }
    },
  },
];

const WINDOW_CHORDS = [
  ...FILE_CHORDS,
  ...TAB_CHORDS,
  ...THREAD_CHORDS,
  ...TAB_SWITCH_CHORDS,
  ...HISTORY_CHORDS,
];

/**
 * Runs the window's chords from the raw key event, ahead of the page, the
 * way the main window runs its own: a menu accelerator is offered only the
 * keys web content left unhandled, and the composer's editor has the keyboard
 * almost all of the time. The menu keeps the same chords for display, and
 * for a focused browser guest, whose keys never pass through here.
 */
export function bindOrchestratorWindowChords(webContents: WebContents) {
  webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") {
      return;
    }
    const chord = WINDOW_CHORDS.find(({ accelerator }) =>
      matchesAccelerator(input, accelerator, { isMac: IS_MAC }),
    );
    if (!chord) {
      return;
    }
    event.preventDefault();
    chord.run();
  });
}

/**
 * The orchestrator window's menu: the other windows' menu, but with the
 * chords a browser has, and the ones an inbox has.
 */
export function createOrchestratorWindowMenu(): MenuItemConstructorOptions[] {
  const fileMenu: MenuItemConstructorOptions = {
    label: "File",
    submenu: [
      ...menuItems(FILE_CHORDS.slice(0, 1)),
      { type: "separator" },
      ...menuItems(FILE_CHORDS.slice(1)),
      { type: "separator" },
      ...menuItems(TAB_CHORDS),
      {
        accelerator: "Shift+CmdOrCtrl+W",
        label: "Close Window",
        role: "close" as const,
      },
    ],
  };

  const threadsMenu: MenuItemConstructorOptions = {
    label: "Threads",
    submenu: menuItems(THREAD_CHORDS),
  };

  const tabMenu: MenuItemConstructorOptions = {
    label: "Tabs",
    submenu: [
      ...menuItems(TAB_SWITCH_CHORDS.slice(0, 4)),
      { type: "separator" },
      ...menuItems(TAB_SWITCH_CHORDS.slice(4)),
    ],
  };

  const historyMenu: MenuItemConstructorOptions = {
    label: "History",
    submenu: menuItems(HISTORY_CHORDS),
  };

  return [
    createAppMenu(),
    fileMenu,
    createEditMenu(),
    createOtherWindowViewMenu(),
    threadsMenu,
    tabMenu,
    historyMenu,
    createWindowMenu(),
    createHelpMenu({ includeShortcutGuide: false }),
    ...(isDeveloperMode() ? createDevToolsMenu() : []),
  ];
}

function menuItems(chords: WindowChord[]): MenuItemConstructorOptions[] {
  return chords.map(({ accelerator, label, run, visible }) => ({
    accelerator,
    click: run,
    label,
    ...(visible === false ? { visible } : {}),
  }));
}
