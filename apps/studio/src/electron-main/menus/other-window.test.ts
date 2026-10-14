import { type MenuItemConstructorOptions } from "electron";
import { afterEach, expect, it, vi } from "vitest";

import { matchesAccelerator } from "./match-accelerator";

vi.mock("@/electron-main/app-command", () => ({ sendAppCommand: vi.fn() }));
vi.mock("@/electron-main/stores/workspace/preferences", () => ({
  isDeveloperMode: () => false,
}));
vi.mock("./utils", () => ({}));

const PLATFORM = process.platform;

afterEach(() => {
  Object.defineProperty(process, "platform", { value: PLATFORM });
});

/** What the View menu on `platform` does with a press, as the command it asks for. */
async function viewMenuOn(platform: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { value: platform });
  vi.resetModules();
  const { createOtherWindowViewMenu } = await import("./other-window");
  const zoom = vi.fn<(type: string) => void>();
  const { submenu } = createOtherWindowViewMenu({ zoom });
  const rows: MenuItemConstructorOptions[] = Array.isArray(submenu)
    ? submenu
    : [];
  const isMac = platform === "darwin";
  return (press: { code: string; key: string; shift?: boolean }) => {
    zoom.mockClear();
    const input = {
      alt: false,
      control: !isMac,
      meta: isMac,
      shift: press.shift ?? false,
      ...press,
    };
    const row = rows.find(
      ({ accelerator }) =>
        typeof accelerator === "string" &&
        matchesAccelerator(input, accelerator, { isMac }),
    );
    // Electron hands a click the item, window and event, which these rows
    // never read.
    (row?.click as (() => void) | undefined)?.();
    return zoom.mock.calls[0]?.[0] ?? null;
  };
}

it.each(["darwin", "win32", "linux"] as const)(
  "zooms in on %s from the equals key with or without Shift, and from the numpad",
  async (platform) => {
    const zoomFor = await viewMenuOn(platform);
    expect(zoomFor({ code: "Equal", key: "=" })).toBe("zoomIn");
    expect(zoomFor({ code: "Equal", key: "+", shift: true })).toBe("zoomIn");
    expect(zoomFor({ code: "NumpadAdd", key: "+" })).toBe("zoomIn");
    expect(zoomFor({ code: "Minus", key: "-" })).toBe("zoomOut");
  },
);
