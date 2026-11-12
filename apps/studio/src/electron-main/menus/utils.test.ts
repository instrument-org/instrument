import { type MenuItemConstructorOptions } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getName: () => "Instrument" },
  Menu: { getApplicationMenu: () => null },
}));
vi.mock("@/electron-main/stores/workspace/window-state", () => ({
  getAppZoom: () => 1,
}));
vi.mock("@/electron-main/lib/open-external", () => ({ openExternal: vi.fn() }));
vi.mock("@/electron-main/rpc/publisher", () => ({
  publisher: { publish: vi.fn() },
}));
vi.mock("./symbol", () => ({ menuSymbol: () => ({}) }));
vi.mock("./shortcuts", () => ({
  shortcutMenuItem: (id: string) => ({ label: id }),
}));

const PLATFORM = process.platform;

/** The menu module as it loads on `platform`, which it reads once. */
async function menusOn(platform: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { value: platform });
  vi.resetModules();
  return import("./utils");
}

afterEach(() => {
  Object.defineProperty(process, "platform", { value: PLATFORM });
});

/** Each row as its role or label, and the chord it binds. */
function rows(items: MenuItemConstructorOptions[]) {
  return items.map((item) =>
    item.type === "separator"
      ? "---"
      : `${item.role ?? item.label ?? ""}${item.accelerator ? ` (${item.accelerator})` : ""}`,
  );
}

/** A window's menus as `withAppMenu` is handed them. */
const MENUS = (): MenuItemConstructorOptions[] => [
  { label: "File", submenu: [{ label: "New Chat" }] },
  { label: "Edit", role: "editMenu" },
  { label: "History", submenu: [{ label: "Back" }] },
  { label: "Help", role: "help", submenu: [{ label: "Learn More" }] },
];

/** Each menu by its label, and its rows. */
function bar(menus: MenuItemConstructorOptions[]) {
  return Object.fromEntries(
    menus.map((menu) => [
      menu.label ?? "",
      Array.isArray(menu.submenu) ? rows(menu.submenu) : [],
    ]),
  );
}

describe("the app menu and the Window menu", () => {
  it("off the Mac, is only the items it is given, with none of Electron's chords", async () => {
    const { createWindowMenu } = await menusOn("linux");
    const items = [{ label: "Merge All Windows" }];
    expect(createWindowMenu(items)).toEqual([
      { label: "Window", submenu: items },
    ]);
    expect(createWindowMenu()).toEqual([]);
  });

  it("put the app's rows where each system keeps them, binding only its own chords", async () => {
    const menus: Record<string, unknown> = {};
    for (const platform of ["darwin", "win32", "linux"] as const) {
      const { createWindowMenu, withAppMenu } = await menusOn(platform);
      menus[platform] = {
        bar: bar(withAppMenu(MENUS())),
        window: rows(createWindowMenu()),
      };
    }
    expect(menus).toMatchInlineSnapshot(`
      {
        "darwin": {
          "bar": {
            "Edit": [],
            "File": [
              "New Chat",
            ],
            "Help": [
              "Learn More",
            ],
            "History": [
              "Back",
            ],
            "Instrument": [
              "about",
              "Check for Updates…",
              "---",
              "settings",
              "---",
              "services",
              "---",
              "hide",
              "hideOthers",
              "unhide",
              "---",
              "quit (CmdOrCtrl+Q)",
            ],
          },
          "window": [
            "windowMenu",
          ],
        },
        "linux": {
          "bar": {
            "&Edit": [],
            "&File": [
              "New Chat",
              "---",
              "settings",
              "---",
              "quit (CmdOrCtrl+Q)",
              "Show Menu (F10)",
            ],
            "&Help": [
              "Learn More",
              "---",
              "Check for Updates…",
              "---",
              "about",
            ],
            "Hi&story": [
              "Back",
            ],
          },
          "window": [],
        },
        "win32": {
          "bar": {
            "&Edit": [],
            "&File": [
              "New Chat",
              "---",
              "settings",
              "---",
              "quit",
              "Show Menu (F10)",
            ],
            "&Help": [
              "Learn More",
              "---",
              "Check for Updates…",
              "---",
              "about",
            ],
            "Hi&story": [
              "Back",
            ],
          },
          "window": [],
        },
      }
    `);
  });

  it("give every system the same rows, apart from the Mac's own", async () => {
    const leaves = (items: MenuItemConstructorOptions[]): string[] =>
      items.flatMap((item) =>
        Array.isArray(item.submenu)
          ? leaves(item.submenu)
          : item.type === "separator" || item.visible === false
            ? []
            : [String(item.role ?? item.label)],
      );
    const MAC_ONLY = ["services", "hide", "hideOthers", "unhide"];
    const each: Record<string, string[]> = {};
    for (const platform of ["darwin", "win32", "linux"] as const) {
      const { withAppMenu } = await menusOn(platform);
      each[platform] = leaves(withAppMenu(MENUS()))
        .filter((row) => !MAC_ONLY.includes(row))
        .toSorted();
    }
    expect(each.win32).toEqual(each.darwin);
    expect(each.linux).toEqual(each.darwin);
  });
});

describe("the Help menu", () => {
  it("lists feedback, then Support, then the shortcut guide, as the rail's Help does", async () => {
    const { createHelpMenu } = await menusOn("darwin");
    const help = (options?: Parameters<typeof createHelpMenu>[0]) => {
      const { submenu } = createHelpMenu(options);
      return Array.isArray(submenu) ? rows(submenu) : [];
    };
    expect({
      appWindow: help({ reportProblem: vi.fn(), shortcutGuide: vi.fn() }),
      otherWindow: help(),
    }).toMatchInlineSnapshot(`
      {
        "appWindow": [
          "Send Feedback…",
          "Support",
          "---",
          "Keyboard Shortcuts",
        ],
        "otherWindow": [
          "Support",
        ],
      }
    `);
  });
});

describe("the app menu's update item", () => {
  it("checks for updates, and offers to restart while one is ready", async () => {
    const { setMenuUpdateReady, withAppMenu } = await menusOn("darwin");
    const label = () => {
      const submenu = withAppMenu([])[0]?.submenu;
      return Array.isArray(submenu) ? submenu[1]?.label : undefined;
    };

    expect(label()).toBe("Check for Updates…");
    expect(setMenuUpdateReady(true)).toBe(true);
    expect(setMenuUpdateReady(true)).toBe(false);
    expect(label()).toBe("Restart to Update");
    expect(setMenuUpdateReady(false)).toBe(true);
    expect(label()).toBe("Check for Updates…");
  });
});
