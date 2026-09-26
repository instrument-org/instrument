import { getBrowserViewManager } from "@/electron-main/browser-view/manager";
import { matchesAccelerator } from "@/electron-main/menus/match-accelerator";
import { publisher } from "@/electron-main/rpc/publisher";
import {
  ORCHESTRATOR_SHORTCUTS,
  type OrchestratorShortcutId,
} from "@/shared/orchestrator-shortcuts";
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
 * cannot be in one place and not the other; the keys and the label come from
 * the shared table, which is what the renderer's tooltips read too.
 */
interface WindowChord {
  accelerator: string;
  label: string;
  run: () => void;
  /** Drawn in the menu, or an accelerator alone behind a row already there. */
  visible?: boolean;
}

/** Sends a command to the window's renderer, which holds the tabs and the inbox: every chord's id is one. */
const command = (name: OrchestratorShortcutId) => () => {
  publisher.publish("orchestrator.command", name);
};

/** A chord from the shared table, answered by the command of the same name unless told otherwise. */
function chord(
  id: OrchestratorShortcutId,
  run: () => void = command(id),
): WindowChord {
  return { ...ORCHESTRATOR_SHORTCUTS[id], run };
}

const FILE_CHORDS: WindowChord[] = [
  // Where mail keeps New Message: a draft of a new thread, at the corner.
  chord("newThread"),
  chord("search", () => {
    // The chord reaches the menu when a page guest has the keyboard, since
    // its keys never reach the window's own renderer. The field is the
    // window's, so the window (the one in front, which is this one while
    // its menu is up) takes the keyboard back before it is asked for.
    BrowserWindow.getFocusedWindow()?.webContents.focus();
    publisher.publish("orchestrator.command", "search");
  }),
  // The renderer opens the find bar in the page on screen, and does nothing
  // when none is.
  chord("findInPage"),
];

/**
 * Cmd+W closes the tab on screen and never the window, which has tabs the
 * user may be keeping; the window closes on Shift+Cmd+W, a role below.
 */
const TAB_CHORDS: WindowChord[] = [
  chord("newTab"),
  chord("closeTab"),
  chord("reopenTab"),
];

/**
 * The inbox column put away and brought back, on the chord the classic
 * window keeps for its sidebar: the column is this window's sidebar.
 */
const VIEW_CHORDS: WindowChord[] = [chord("toggleInbox"), chord("editPage")];

/**
 * Down and up the inbox from the thread on screen, in the order the list
 * shows. Alt with the command key, since Alt and an arrow alone moves the
 * caret by a word in the composer.
 */
const THREAD_CHORDS: WindowChord[] = [
  chord("nextThread"),
  chord("previousThread"),
];

/**
 * The chords the main window's tab bar answers to, on whichever screen is up
 * here: next and previous by Ctrl+Tab and by Cmd+Shift+bracket, a tab by
 * place with Cmd+1 through Cmd+8, and the last with Cmd+9, as browsers do.
 */
const TAB_SWITCH_CHORDS: WindowChord[] = [
  chord("nextTab"),
  {
    ...chord("nextTab"),
    accelerator: "CmdOrCtrl+Shift+]",
    visible: false,
  },
  chord("previousTab"),
  {
    ...chord("previousTab"),
    accelerator: "CmdOrCtrl+Shift+[",
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
  chord("back", () => {
    if (!getBrowserViewManager()?.navigateFocusedGuest("back")) {
      publisher.publish("orchestrator.command", "back");
    }
  }),
  chord("forward", () => {
    if (!getBrowserViewManager()?.navigateFocusedGuest("forward")) {
      publisher.publish("orchestrator.command", "forward");
    }
  }),
];

const WINDOW_CHORDS = [
  ...FILE_CHORDS,
  ...VIEW_CHORDS,
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
    const pressed = WINDOW_CHORDS.find(({ accelerator }) =>
      matchesAccelerator(input, accelerator, { isMac: IS_MAC }),
    );
    if (!pressed) {
      return;
    }
    event.preventDefault();
    pressed.run();
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

  // The other windows' View menu with the inbox's chord at its head.
  const shared = createOtherWindowViewMenu();
  const viewMenu: MenuItemConstructorOptions = {
    ...shared,
    submenu: [
      ...menuItems(VIEW_CHORDS),
      { type: "separator" },
      ...(Array.isArray(shared.submenu) ? shared.submenu : []),
    ],
  };

  return [
    createAppMenu(),
    fileMenu,
    createEditMenu(),
    viewMenu,
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
