import { matchesAccelerator } from "@/electron-main/menus/match-accelerator";
import {
  BrowserWindow,
  dialog,
  type Input,
  Menu,
  type MenuItem,
  type MessageBoxOptions,
  type MessageBoxReturnValue,
  type OpenDialogOptions,
  type OpenDialogReturnValue,
  type SaveDialogOptions,
  type SaveDialogReturnValue,
  type WebContents,
  webContents,
} from "electron";

import { isDrivenInstance, keepsOffScreen } from "./on-screen";

/**
 * What the system draws for an instance an agent drives off screen: its menus
 * and its dialogs. Nobody is looking, nothing over CDP reaches either, and
 * one put up would stand in front of whatever the person at the machine is
 * doing, so each is held here until the driving script answers it
 * (`debug.drive`). An instance on screen draws them as any run does.
 */

/** A menu row as a script reads it. */
export interface MenuRow {
  accelerator?: string;
  checked?: boolean;
  enabled: boolean;
  label: string;
  submenu?: MenuRow[];
}

/** A native dialog waiting on an answer. */
export interface HeldDialog {
  buttons: string[];
  detail?: string;
  id: string;
  kind: "message" | "open" | "save";
  message: string;
}

interface HeldMenu {
  close: () => void;
  menu: Menu;
  window: BrowserWindow | null;
}

type DialogAnswer =
  | { button: number; checked: boolean }
  | { paths: string[] }
  | "cancel";

let heldMenu: HeldMenu | undefined;
const heldDialogs: {
  answer: (answer: DialogAnswer) => void;
  shown: HeldDialog;
}[] = [];
let nextDialog = 1;
/** The window a script is acting in, which is the focused one to what it runs. */
let actingIn: BrowserWindow | undefined;

/** Holds the system's menus and dialogs for as long as this run is driven off screen. */
export function holdNativeForDriving() {
  if (!isDrivenInstance()) {
    return;
  }
  // oxlint-disable-next-line typescript/unbound-method -- kept to call on each menu with `.call`, past the wrapper
  const popup = Menu.prototype.popup;
  Menu.prototype.popup = function holdPopup(this: Menu, options) {
    if (!keepsOffScreen()) {
      popup.call(this, options);
      return;
    }
    heldMenu?.close();
    heldMenu = {
      close: () => {
        heldMenu = undefined;
        options?.callback?.();
        this.emit("menu-will-close", {});
      },
      menu: this,
      window: options?.window instanceof BrowserWindow ? options.window : null,
    };
  };

  // Electron takes the window ahead of the options, or the options alone.
  const optionsOf = <T>(args: unknown[]) =>
    // The last argument either way, as each method's own overloads have it.
    args.at(-1) as T;
  const showMessageBox = dialog.showMessageBox.bind(dialog);
  const showOpenDialog = dialog.showOpenDialog.bind(dialog);
  const showSaveDialog = dialog.showSaveDialog.bind(dialog);
  dialog.showMessageBox = async (
    ...args: unknown[]
  ): Promise<MessageBoxReturnValue> => {
    const options = optionsOf<MessageBoxOptions>(args);
    if (!keepsOffScreen()) {
      return showMessageBox(...(args as Parameters<typeof showMessageBox>));
    }
    const buttons = options.buttons?.length ? options.buttons : ["OK"];
    const answer = await hold({
      buttons,
      kind: "message",
      message: options.message,
      ...(options.detail ? { detail: options.detail } : {}),
    });
    return answer !== "cancel" && "button" in answer
      ? { checkboxChecked: answer.checked, response: answer.button }
      : {
          checkboxChecked: false,
          response: options.cancelId ?? buttons.length - 1,
        };
  };
  dialog.showOpenDialog = async (
    ...args: unknown[]
  ): Promise<OpenDialogReturnValue> => {
    const options = optionsOf<OpenDialogOptions>(args);
    if (!keepsOffScreen()) {
      return showOpenDialog(...(args as Parameters<typeof showOpenDialog>));
    }
    const answer = await hold({
      buttons: [options.buttonLabel ?? "Open", "Cancel"],
      kind: "open",
      message: options.message ?? options.title ?? "",
    });
    return answer !== "cancel" && "paths" in answer
      ? { canceled: false, filePaths: answer.paths }
      : { canceled: true, filePaths: [] };
  };
  dialog.showSaveDialog = async (
    ...args: unknown[]
  ): Promise<SaveDialogReturnValue> => {
    const options = optionsOf<SaveDialogOptions>(args);
    if (!keepsOffScreen()) {
      return showSaveDialog(...(args as Parameters<typeof showSaveDialog>));
    }
    const answer = await hold({
      buttons: [options.buttonLabel ?? "Save", "Cancel"],
      kind: "save",
      message: options.defaultPath ?? options.title ?? "",
    });
    return answer !== "cancel" && "paths" in answer
      ? { canceled: false, filePath: answer.paths[0] ?? "" }
      : { canceled: true, filePath: "" };
  };

  // The menu bar's items act on the focused window, and no window held off
  // screen ever is.
  const getFocusedWindow = BrowserWindow.getFocusedWindow.bind(BrowserWindow);
  BrowserWindow.getFocusedWindow = () => actingIn ?? getFocusedWindow();
}

function hold(dialogShown: Omit<HeldDialog, "id">) {
  return new Promise<DialogAnswer>((resolve) => {
    const shown = { ...dialogShown, id: String(nextDialog++) };
    heldDialogs.push({
      answer: (answer) => {
        heldDialogs.splice(
          heldDialogs.findIndex((each) => each.shown.id === shown.id),
          1,
        );
        resolve(answer);
      },
      shown,
    });
  });
}

/** What is held right now: the menu up, and the dialogs, oldest first. */
export function heldNative(): {
  dialogs: HeldDialog[];
  menu: MenuRow[] | null;
} {
  return {
    dialogs: heldDialogs.map(({ shown }) => shown),
    menu: heldMenu ? rowsOf(heldMenu.menu) : null,
  };
}

/** Answers the oldest dialog held, or the one named. */
export function answerHeldDialog(answer: DialogAnswer, id?: string) {
  const entry = id
    ? heldDialogs.find(({ shown }) => shown.id === id)
    : heldDialogs[0];
  entry?.answer(answer);
  return entry?.shown;
}

/** The menu bar, as this window has it. */
export function appMenuRows() {
  return rowsOf(Menu.getApplicationMenu());
}

/** Presses the row at a path of labels, in the menu held or in the menu bar, and whether there was one. */
export function pressMenuRow(
  from: "bar" | "held",
  labels: string[],
  window: BrowserWindow,
) {
  const held = from === "held" ? heldMenu : undefined;
  const item = itemAt(
    from === "held" ? heldMenu?.menu : Menu.getApplicationMenu(),
    labels,
  );
  if (!item) {
    return false;
  }
  // A menu closes ahead of the row it was pressed on.
  pressItem(item, held?.window ?? window);
  held?.close();
  return true;
}

export function dismissHeldMenu() {
  heldMenu?.close();
}

/**
 * A key pressed the way a person's reaches the app: the window's own chords
 * hear it ahead of the page, which a key sent over CDP never passes through,
 * then the page it was pressed in.
 */
export function pressKeyIn(
  window: BrowserWindow,
  guestId: number | undefined,
  { keyCode, modifiers }: { keyCode: string; modifiers: InputModifier[] },
) {
  const contents =
    (guestId === undefined ? undefined : webContents.fromId(guestId)) ??
    window.webContents;
  let isTaken = false;
  const hear = (event: { defaultPrevented: boolean }) => {
    isTaken = event.defaultPrevented;
  };
  actingIn = window;
  contents.once("before-input-event", hear);
  try {
    contents.sendInputEvent({ keyCode, modifiers, type: "keyDown" });
    contents.sendInputEvent({ keyCode, modifiers, type: "keyUp" });
  } finally {
    contents.off("before-input-event", hear);
    actingIn = undefined;
  }
  return isTaken;
}

type InputModifier = "alt" | "control" | "meta" | "shift";

/** Runs the menu bar's row for a key the page left alone, and which it was. */
export function pressMenuKey(
  window: BrowserWindow,
  guestId: number | undefined,
  input: Pick<Input, "alt" | "code" | "control" | "key" | "meta" | "shift">,
) {
  const item = allItems(Menu.getApplicationMenu()).find(
    ({ accelerator, enabled, role, userAccelerator }) => {
      const keys =
        accelerator ?? userAccelerator ?? ROLE_KEYS[role?.toLowerCase() ?? ""];
      return (
        enabled &&
        typeof keys === "string" &&
        matchesAccelerator(input, keys, {
          isMac: process.platform === "darwin",
        })
      );
    },
  );
  if (!item) {
    return;
  }
  const contents =
    guestId === undefined ? undefined : webContents.fromId(guestId);
  pressItem(item, window, contents ?? undefined);
  return item.label;
}

/** The keys macOS gives the rows of the Edit menu, which name a role alone. */
const ROLE_KEYS: Record<string, string> = {
  copy: "CmdOrCtrl+C",
  cut: "CmdOrCtrl+X",
  paste: "CmdOrCtrl+V",
  pasteandmatchstyle: "Shift+Alt+CmdOrCtrl+V",
  redo: "Shift+CmdOrCtrl+Z",
  selectall: "CmdOrCtrl+A",
  undo: "CmdOrCtrl+Z",
};

/**
 * The rows that name a role alone (the Edit menu's, and the window's own),
 * which the system runs for a menu it draws on the key window, and no window
 * held off screen ever is.
 */
const ROLE_RUNS: Record<
  string,
  (contents: WebContents, window: BrowserWindow) => void
> = {
  close: (_contents, window) => {
    window.close();
  },
  copy: (contents) => {
    contents.copy();
  },
  cut: (contents) => {
    contents.cut();
  },
  delete: (contents) => {
    contents.delete();
  },
  minimize: (_contents, window) => {
    window.minimize();
  },
  paste: (contents) => {
    contents.paste();
  },
  pasteandmatchstyle: (contents) => {
    contents.pasteAndMatchStyle();
  },
  redo: (contents) => {
    contents.redo();
  },
  selectall: (contents) => {
    contents.selectAll();
  },
  togglefullscreen: (_contents, window) => {
    window.setFullScreen(!window.isFullScreen());
  },
  undo: (contents) => {
    contents.undo();
  },
  zoom: (_contents, window) => {
    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
  },
};

function pressItem(
  item: MenuItem,
  window: BrowserWindow,
  contents: WebContents = window.webContents,
) {
  const role = ROLE_RUNS[item.role?.toLowerCase() ?? ""];
  if (role) {
    role(contents, window);
    return;
  }
  actingIn = window;
  try {
    // Electron toggles a checkbox ahead of its click, as the system does.
    if (item.type === "checkbox") {
      item.checked = !item.checked;
    }
    // oxlint-disable-next-line typescript/no-unsafe-call -- Electron types a menu item's click as Function
    item.click(undefined, window, contents);
  } finally {
    actingIn = undefined;
  }
}

function allItems(menu: Menu | null | undefined): MenuItem[] {
  return menu?.items.flatMap((item) => [item, ...allItems(item.submenu)]) ?? [];
}

const bare = (label: string) =>
  label
    .replaceAll("&", "")
    .replace(/(?:…|\.\.\.)$/, "")
    .trim()
    .toLowerCase();

function itemAt(
  menu: Menu | null | undefined,
  labels: string[],
): MenuItem | undefined {
  const [first, ...rest] = labels;
  if (first === undefined) {
    return;
  }
  const item = menu?.items.find(
    (each) => each.visible && each.enabled && bare(each.label) === bare(first),
  );
  return rest.length === 0 ? item : itemAt(item?.submenu, rest);
}

function rowsOf(menu: Menu | null | undefined): MenuRow[] {
  return (
    menu?.items.flatMap((item) =>
      item.type === "separator" || !item.visible
        ? []
        : [
            {
              enabled: item.enabled,
              label: item.label,
              ...(typeof item.accelerator === "string" && {
                accelerator: item.accelerator,
              }),
              ...((item.type === "checkbox" || item.type === "radio") && {
                checked: item.checked,
              }),
              ...(item.submenu && { submenu: rowsOf(item.submenu) }),
            },
          ],
    ) ?? []
  );
}
