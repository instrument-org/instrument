import { type MenuItemConstructorOptions } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getName: () => "Instrument" } }));
vi.mock("@/electron-main/lib/open-external", () => ({ openExternal: vi.fn() }));
vi.mock("@/electron-main/rpc/publisher", () => ({
  publisher: { publish: vi.fn() },
}));
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

describe("the app menu and the Window menu", () => {
  it("bind each system's own chords, and none it keeps for itself", async () => {
    const menus: Record<string, unknown> = {};
    for (const platform of ["darwin", "win32", "linux"] as const) {
      const { createAppMenu, createWindowMenu } = await menusOn(platform);
      const submenu = createAppMenu().submenu;
      menus[platform] = {
        app: rows(Array.isArray(submenu) ? submenu : []),
        window: rows(createWindowMenu()),
      };
    }
    expect(menus).toMatchInlineSnapshot(`
      {
        "darwin": {
          "app": [
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
          "window": [
            "windowMenu",
          ],
        },
        "linux": {
          "app": [
            "about",
            "Check for Updates…",
            "---",
            "settings",
            "---",
            "quit (CmdOrCtrl+Q)",
          ],
          "window": [],
        },
        "win32": {
          "app": [
            "about",
            "Check for Updates…",
            "---",
            "settings",
            "---",
            "quit (CmdOrCtrl+Q)",
          ],
          "window": [],
        },
      }
    `);
  });
});
