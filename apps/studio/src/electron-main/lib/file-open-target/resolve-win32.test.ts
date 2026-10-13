import { describe, expect, it, vi } from "vitest";

import { win32AppName } from "./resolve-win32";

vi.mock("electron", () => ({ app: {} }));
vi.mock("../app-protocol", () => ({}));

describe("win32AppName", () => {
  it.each([
    ["Windows Explorer", "C:\\Windows\\explorer.exe", "File Explorer"],
    ["Windows Explorer", "C:\\WINDOWS\\Explorer.EXE", "File Explorer"],
    ["Notepad", "C:\\Windows\\System32\\notepad.exe", "Notepad"],
    ["Photos", "C:\\Program Files\\WindowsApps\\photos.exe", "Photos"],
  ])("names %s at %s as %s", (appName, exePath, named) => {
    expect(win32AppName(appName, exePath)).toBe(named);
  });
});
