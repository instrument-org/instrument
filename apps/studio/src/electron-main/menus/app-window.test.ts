import { CODE_EDITOR_FOCUS_CHANNEL } from "@/shared/constants";
import { type Input, type WebContents } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";

const inFront = vi.hoisted(() => ({
  window: null as null | {
    isDestroyed: () => boolean;
    webContents: { id: number };
  },
}));
vi.mock("electron", () => ({
  BrowserWindow: {
    fromWebContents: () => ({
      isDestroyed: () => false,
      webContents: { id: 1 },
    }),
    getFocusedWindow: () => inFront.window,
  },
}));
const publish = vi.hoisted(() =>
  vi.fn<(name: string, data: unknown) => void>(),
);
vi.mock("@/electron-main/rpc/publisher", () => ({ publisher: { publish } }));
vi.mock("@/electron-main/stores/workspace/preferences", () => ({
  isDeveloperMode: () => false,
}));
vi.mock("@/electron-main/lib/setup-state", () => ({ isSetupUp: () => false }));
vi.mock("./other-window", () => ({
  createOtherWindowViewMenu: () => ({ label: "View", submenu: [] }),
}));
vi.mock("./utils", () => ({
  withAppMenu: (menus: unknown[]) => [{ label: "App" }, ...menus],
  createDevToolsMenu: () => [],
  createEditMenu: () => ({ label: "Edit" }),
  createHelpMenu: () => ({ label: "Help" }),
  createWindowMenu: () => [],
}));

const PLATFORM = process.platform;

const NO_WINDOW_ACTIONS = {
  canMerge: false,
  canReopenClosed: false,
  mergeAll: () => {},
  openNew: () => {},
  openNewWithChat: () => {},
  reopenClosed: () => {},
};

afterEach(() => {
  Object.defineProperty(process, "platform", { value: PLATFORM });
});

/** The command a publish on the window's stream carried. */
function commandOf(published: unknown) {
  return published !== null &&
    typeof published === "object" &&
    "command" in published
    ? published.command
    : null;
}

type Press = Pick<Input, "alt" | "code" | "control" | "key" | "meta" | "shift">;

/**
 * The window's chord binder as it loads on `platform`, bound to a stand-in
 * for the window's web contents that takes key presses and the renderer's
 * word on a code editor's focus.
 */
async function windowOn(platform: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { value: platform });
  vi.resetModules();
  const { bindAppWindowChords } = await import("./app-window");
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const ipc = new Map<string, (...args: unknown[]) => void>();
  const webContents = {
    ipc: {
      on: (channel: string, listener: (...args: unknown[]) => void) => {
        ipc.set(channel, listener);
      },
    },
    on: (name: string, listener: (...args: unknown[]) => void) => {
      listeners.set(name, listener);
    },
  };
  // A stand-in with only the two ways the binder listens, not a WebContents.
  bindAppWindowChords(webContents as unknown as WebContents);
  return {
    focusCodeEditor: (focused: boolean) => {
      ipc.get(CODE_EDITOR_FOCUS_CHANNEL)?.({}, focused);
    },
    navigate: () => {
      listeners.get("did-navigate")?.();
    },
    /** The command a press ran, or null when it went on to the page. */
    press: (input: Press) => {
      publish.mockClear();
      const event = { preventDefault: vi.fn() };
      listeners.get("before-input-event")?.(event, {
        ...input,
        type: "keyDown",
      });
      const ran = commandOf(publish.mock.calls[0]?.[1]);
      expect(event.preventDefault).toHaveBeenCalledTimes(ran === null ? 0 : 1);
      return ran;
    },
  };
}

function press(key: string, code: string, ...held: (keyof Press)[]): Press {
  return {
    alt: held.includes("alt"),
    code,
    control: held.includes("control"),
    key,
    meta: held.includes("meta"),
    shift: held.includes("shift"),
  };
}

describe("a window chord that is also a code editor's key", () => {
  it.each([
    {
      back: press("ArrowLeft", "ArrowLeft", "alt"),
      nextChat: press("ArrowDown", "ArrowDown", "alt", "shift"),
      newTab: press("t", "KeyT", "control"),
      platform: "win32",
    },
    {
      back: press("ArrowLeft", "ArrowLeft", "alt"),
      nextChat: press("ArrowDown", "ArrowDown", "alt", "shift"),
      newTab: press("t", "KeyT", "control"),
      platform: "linux",
    },
    {
      back: press("[", "BracketLeft", "meta"),
      nextChat: press("ArrowDown", "ArrowDown", "alt", "meta"),
      newTab: press("t", "KeyT", "meta"),
      platform: "darwin",
    },
  ] as const)(
    "goes on to a focused code editor on $platform, and only then",
    async ({ back, newTab, nextChat, platform }) => {
      const window = await windowOn(platform);
      expect(window.press(back)).toBe("back");
      expect(window.press(nextChat)).toBe("nextChat");

      window.focusCodeEditor(true);
      expect(window.press(back)).toBeNull();
      expect(window.press(nextChat)).toBeNull();
      // A chord the editor has no key for stays the window's.
      expect(window.press(newTab)).toBe("newTab");

      window.focusCodeEditor(false);
      expect(window.press(back)).toBe("back");

      // A page loaded afresh has no editor holding the keyboard.
      window.focusCodeEditor(true);
      window.navigate();
      expect(window.press(nextChat)).toBe("nextChat");
    },
  );
});

describe("Info", () => {
  // Taken ahead of the page, ⌘I would stop being italic in every editor.
  it.each([
    ["darwin", press("i", "KeyI", "meta")],
    ["win32", press("Enter", "Enter", "alt")],
    ["linux", press("Enter", "Enter", "alt")],
  ] as const)("is left to the page first on %s", async (platform, chord) => {
    const window = await windowOn(platform);
    expect(window.press(chord)).toBeNull();
  });

  it.each([
    ["darwin", "Info", "CmdOrCtrl+I"],
    ["win32", "Properties", "Alt+Enter"],
    ["linux", "Properties", "Alt+Enter"],
  ] as const)(
    "is the File menu's row on %s, under the system's name and key",
    async (platform, label, accelerator) => {
      Object.defineProperty(process, "platform", { value: platform });
      vi.resetModules();
      const { createAppWindowMenu } = await import("./app-window");
      const file = createAppWindowMenu(NO_WINDOW_ACTIONS).find(
        (menu) => menu.label === "File",
      );
      const row = (Array.isArray(file?.submenu) ? file.submenu : []).find(
        (item) => item.label === label,
      );
      expect(row?.accelerator).toBe(accelerator);
      publish.mockClear();
      const click = row?.click as
        | ((item: unknown, window: unknown, event: unknown) => void)
        | undefined;
      inFront.window = { isDestroyed: () => false, webContents: { id: 7 } };
      click?.({}, {}, {});
      expect(publish).toHaveBeenCalledWith("window.command", {
        command: "fileInfo",
        webContentsId: 7,
      });
    },
  );
});

describe("a window chord from the menu", () => {
  it("does nothing with no window focused, as with the window held off screen", async () => {
    vi.resetModules();
    const { createAppWindowMenu } = await import("./app-window");
    const closeTab = createAppWindowMenu(NO_WINDOW_ACTIONS)
      .flatMap((menu) => (Array.isArray(menu.submenu) ? menu.submenu : []))
      .find((item) => item.label === "Close Tab");
    // Electron types the click's arguments as real menu items and windows;
    // stand-ins are enough to tell focused from not.
    const click = closeTab?.click as
      | ((item: unknown, window: unknown, event: unknown) => void)
      | undefined;
    expect(click).toBeDefined();

    publish.mockClear();
    inFront.window = null;
    click?.({}, undefined, {});
    expect(publish).not.toHaveBeenCalled();

    inFront.window = { isDestroyed: () => false, webContents: { id: 7 } };
    click?.({}, {}, {});
    expect(publish).toHaveBeenCalledWith("window.command", {
      command: "closeTab",
      webContentsId: 7,
    });
  });

  it("opens a window for New Chat, New Tab and Reopen Closed Tab with none focused, as a browser does", async () => {
    vi.resetModules();
    const { createAppWindowMenu } = await import("./app-window");
    const opened: string[] = [];
    const rows = (canReopenClosed: boolean) =>
      createAppWindowMenu({
        ...NO_WINDOW_ACTIONS,
        canReopenClosed,
        openNew: () => opened.push("window"),
        openNewWithChat: () => opened.push("window with a chat"),
        reopenClosed: () => opened.push("window closed last"),
      }).flatMap((menu) => (Array.isArray(menu.submenu) ? menu.submenu : []));
    const choose = (canReopenClosed: boolean, label: string) => {
      const click = rows(canReopenClosed).find(
        (item) => item.label === label && item.visible !== false,
      )?.click as
        | ((item: unknown, window: unknown, event: unknown) => void)
        | undefined;
      click?.({}, undefined, {});
    };

    inFront.window = null;
    publish.mockClear();
    choose(true, "New Chat");
    choose(true, "New Tab");
    choose(true, "Reopen Closed Tab");
    choose(false, "Reopen Closed Tab");
    choose(true, "Close Tab");
    expect(opened).toEqual([
      "window with a chat",
      "window",
      "window closed last",
    ]);
    expect(publish).not.toHaveBeenCalled();
  });
});
