import { isSetupUp } from "@/electron-main/lib/setup-state";
import { matchesAccelerator } from "@/electron-main/menus/match-accelerator";
import { publisher } from "@/electron-main/rpc/publisher";
import { isDeveloperMode } from "@/electron-main/stores/workspace/preferences";
import { CODE_EDITOR_FOCUS_CHANNEL } from "@/shared/constants";
import { resolveAccelerator } from "@/shared/shortcuts";
import {
  CODE_EDITOR_SHORTCUTS,
  WINDOW_MENU_SHORTCUTS,
  WINDOW_SHORTCUT_ALIASES,
  WINDOW_SHORTCUTS,
  type WindowShortcutId,
} from "@/shared/window-shortcuts";
import {
  BrowserWindow,
  type MenuItemConstructorOptions,
  type WebContents,
} from "electron";

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
  /** The shared table's row, for a chord that has one. */
  id?: WindowShortcutId;
  label: string;
  run: () => void;
  /** Drawn in the menu, or an accelerator alone behind a row already there. */
  visible?: boolean;
}

/** Sends a command to the window's renderer, which holds the tabs and the inbox: every chord's id is one. */
const command = (name: WindowShortcutId) => () => {
  publisher.publish("window.command", name);
};

/** A chord from the shared table, answered by the command of the same name unless told otherwise. */
function chord(
  id: WindowShortcutId,
  run: () => void = command(id),
): WindowChord {
  const { accelerator, label } = WINDOW_SHORTCUTS[id];
  return {
    accelerator: resolveAccelerator(accelerator, { isMac: IS_MAC }),
    id,
    label,
    run,
  };
}

const FILE_CHORDS: WindowChord[] = [
  // Where mail keeps New Message: a draft of a new chat, at the corner.
  chord("newChat"),
  chord("commandMenu", () => {
    // As with the field below: a page guest holding the keyboard keeps the
    // menu's input from taking it, so the window takes it back first.
    BrowserWindow.getFocusedWindow()?.webContents.focus();
    publisher.publish("window.command", "commandMenu");
  }),
  chord("search", () => {
    // The chord reaches the menu when a page guest has the keyboard, since
    // its keys never reach the window's own renderer. The field is the
    // window's, so the window (the one in front, which is this one while
    // its menu is up) takes the keyboard back before it is asked for.
    BrowserWindow.getFocusedWindow()?.webContents.focus();
    publisher.publish("window.command", "search");
  }),
  // The renderer opens the find bar in the page on screen, and does nothing
  // when none is.
  chord("findInPage"),
  chord("findNext"),
  chord("findPrevious"),
  // The page the person is looking at; nothing when none is.
  chord("printPage"),
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
 * The inbox column put away and brought back, on the usual sidebar chord:
 * the column is this window's sidebar.
 */
const VIEW_CHORDS: WindowChord[] = [
  chord("toggleInbox"),
  chord("editPage"),
  // The page in front of the user, never the window: reloading the window
  // takes every browser guest down with its document. The window decides
  // which page that is (page-chords.ts).
  chord("reloadPage"),
];

/** The rail's places, the tab up going to one the way a press on the rail takes it. */
const PLACE_CHORDS: WindowChord[] = [
  chord("goToChat"),
  chord("goToFiles"),
  chord("goToBrowser"),
  chord("goToApps"),
];

/**
 * Down and up the inbox from the chat on screen, in the order the list
 * shows, on the keys each system steps between conversations with
 * (`window-shortcuts.ts`).
 */
const CHAT_CHORDS: WindowChord[] = [chord("nextChat"), chord("previousChat")];

/**
 * The chords the tab bar answers to, on whichever screen is up: next and
 * previous by Ctrl+Tab (and by this system's own second chord, below), a tab
 * by place with Cmd+1 through Cmd+8, and the last with Cmd+9, as browsers do.
 */
const TAB_SWITCH_CHORDS: WindowChord[] = [
  chord("nextTab"),
  chord("previousTab"),
  ...Array.from({ length: 9 }, (_, index) => ({
    ...(index === 8
      ? WINDOW_MENU_SHORTCUTS.lastTab
      : { accelerator: `CmdOrCtrl+${index + 1}`, label: `Tab ${index + 1}` }),
    run: () => {
      publisher.publish("window.command", {
        index: index + 1,
        type: "selectTab",
      });
    },
  })),
];

/**
 * Back and forward go to the window, focused page or not: it steps the page
 * holding the keyboard the way the surface showing that page walks it, which
 * runs out into the tab's history at either end, and the tab otherwise.
 */
const HISTORY_CHORDS: WindowChord[] = [chord("back"), chord("forward")];

/**
 * This system's second chords for a command (`WINDOW_SHORTCUT_ALIASES`),
 * answered like the rest and drawn in the menu only as hidden rows, which a
 * focused page guest still reaches.
 */
function aliasChords(...ids: WindowShortcutId[]): WindowChord[] {
  return WINDOW_SHORTCUT_ALIASES.flatMap(({ accelerator, id }) => {
    const own = IS_MAC ? accelerator.darwin : accelerator.default;
    return own && ids.includes(id)
      ? [{ ...chord(id), accelerator: own, visible: false }]
      : [];
  });
}

const TAB_ALIAS_CHORDS = aliasChords("closeTab");
const TAB_SWITCH_ALIAS_CHORDS = aliasChords("nextTab", "previousTab");
const VIEW_ALIAS_CHORDS = aliasChords("reloadPage");
const FILE_ALIAS_CHORDS = aliasChords("findNext", "findPrevious");

const WINDOW_CHORDS = [
  ...FILE_CHORDS,
  ...FILE_ALIAS_CHORDS,
  ...VIEW_CHORDS,
  ...VIEW_ALIAS_CHORDS,
  ...PLACE_CHORDS,
  ...TAB_CHORDS,
  ...TAB_ALIAS_CHORDS,
  ...CHAT_CHORDS,
  ...TAB_SWITCH_CHORDS,
  ...TAB_SWITCH_ALIAS_CHORDS,
  ...HISTORY_CHORDS,
];

/**
 * Runs the window's chords from the raw key event, ahead of the page: a menu
 * accelerator is offered only the
 * keys web content left unhandled, and the composer's editor has the keyboard
 * almost all of the time. The menu keeps the same chords for display, and
 * for a focused browser guest, whose keys never pass through here. A code
 * editor holding the keyboard is given the chords that are its keys too
 * (`CODE_EDITOR_SHORTCUTS`) the same way: they go on to the page, and the
 * menu answers whatever the editor leaves alone.
 */
export function bindAppWindowChords(webContents: WebContents) {
  // The renderer's last word on whether a code editor has the keyboard. A
  // page loaded afresh has none.
  let codeEditorFocused = false;
  webContents.ipc.on(CODE_EDITOR_FOCUS_CHANNEL, (_event, focused: unknown) => {
    codeEditorFocused = focused === true;
  });
  webContents.on("did-navigate", () => {
    codeEditorFocused = false;
  });
  webContents.on("before-input-event", (event, input) => {
    // Setup is drawn over the app, which none of these may reach behind it.
    if (input.type !== "keyDown" || isSetupUp()) {
      return;
    }
    const pressed = WINDOW_CHORDS.find(({ accelerator }) =>
      matchesAccelerator(input, accelerator, { isMac: IS_MAC }),
    );
    if (
      !pressed ||
      (codeEditorFocused &&
        pressed.id !== undefined &&
        CODE_EDITOR_SHORTCUTS.has(pressed.id))
    ) {
      return;
    }
    event.preventDefault();
    pressed.run();
  });
}

/**
 * The app window's menu: the other windows' menu, but with the
 * chords a browser has, and the ones an inbox has.
 */
export function createAppWindowMenu(): MenuItemConstructorOptions[] {
  const fileMenu: MenuItemConstructorOptions = {
    label: "File",
    submenu: [
      ...menuItems(FILE_CHORDS.slice(0, 1)),
      { type: "separator" },
      ...menuItems(FILE_CHORDS.slice(1)),
      ...menuItems(FILE_ALIAS_CHORDS),
      { type: "separator" },
      ...menuItems(TAB_CHORDS),
      ...menuItems(TAB_ALIAS_CHORDS),
      { ...WINDOW_MENU_SHORTCUTS.closeWindow, role: "close" as const },
    ],
  };

  const chatsMenu: MenuItemConstructorOptions = {
    label: "Chats",
    submenu: menuItems(CHAT_CHORDS),
  };

  const tabMenu: MenuItemConstructorOptions = {
    label: "Tabs",
    submenu: [
      ...menuItems(TAB_SWITCH_CHORDS.slice(0, 2)),
      ...menuItems(TAB_SWITCH_ALIAS_CHORDS),
      { type: "separator" },
      ...menuItems(TAB_SWITCH_CHORDS.slice(2)),
    ],
  };

  // Where a browser keeps it: the dialog clears the in-app browser's
  // history, cookies, and cache.
  const historyMenu: MenuItemConstructorOptions = {
    label: "History",
    submenu: [
      ...menuItems(HISTORY_CHORDS),
      { type: "separator" },
      {
        click: () => {
          // A focused page guest holds the keyboard, and the dialog is the
          // window's, so the window takes the keyboard back first.
          BrowserWindow.getFocusedWindow()?.webContents.focus();
          publisher.publish("window.command", "clearBrowsingData");
        },
        label: "Clear Browsing Data…",
      },
    ],
  };

  // The other windows' View menu with the inbox's chord at its head, less
  // its reload roles, which would reload the window and every page in it
  // (Reload Page above takes Cmd+R; the Developer menu reloads the app). Its
  // zoom chords go to the window, which decides whether they mean a page.
  const shared = createOtherWindowViewMenu({
    zoom: (type) => {
      publisher.publish("window.command", type);
    },
  });
  const viewMenu: MenuItemConstructorOptions = {
    ...shared,
    submenu: [
      ...menuItems(VIEW_CHORDS),
      ...menuItems(VIEW_ALIAS_CHORDS),
      { type: "separator" },
      ...menuItems(PLACE_CHORDS),
      { type: "separator" },
      ...(Array.isArray(shared.submenu)
        ? shared.submenu.filter(
            (item) => item.role !== "reload" && item.role !== "forceReload",
          )
        : []),
    ],
  };

  return [
    createAppMenu(),
    fileMenu,
    createEditMenu(),
    viewMenu,
    chatsMenu,
    tabMenu,
    historyMenu,
    ...createWindowMenu(),
    createHelpMenu({
      reportProblem: () => {
        BrowserWindow.getFocusedWindow()?.webContents.focus();
        publisher.publish("window.command", "reportProblem");
      },
      shortcutGuide: () => {
        // A focused page guest holds the keyboard, and the guide's search
        // field is the window's, so the window takes the keyboard back first.
        BrowserWindow.getFocusedWindow()?.webContents.focus();
        publisher.publish("window.command", "openShortcutGuide");
      },
    }),
    ...(isDeveloperMode() ? createDevToolsMenu() : []),
  ];
}

/**
 * A chord's menu row, answered only while a window is focused. This menu is
 * up with no window focused too (menus/index.ts), where the app window may
 * be minimized or held off screen, and a chord there would act on a window
 * nobody can see: Cmd+W on its last tab closes it.
 */
function menuItems(chords: WindowChord[]): MenuItemConstructorOptions[] {
  return chords.map(({ accelerator, label, run, visible }) => ({
    accelerator,
    click: (_item, focusedWindow) => {
      if (focusedWindow) {
        run();
      }
    },
    label,
    ...(visible === false ? { visible } : {}),
  }));
}
