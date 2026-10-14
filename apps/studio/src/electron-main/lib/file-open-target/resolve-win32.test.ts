import { describe, expect, it, vi } from "vitest";

import { resolveWin32Target, win32AppName } from "./resolve-win32";

const runThrottledHelper = vi.hoisted(() =>
  vi.fn<(options: { args: string[]; file: string }) => Promise<string>>(),
);

vi.mock("electron", () => ({ app: {} }));
vi.mock("../app-protocol", () => ({}));
vi.mock("./helper-process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./helper-process")>()),
  runThrottledHelper,
}));

it("has PowerShell answer in UTF-8, so an app named with accents arrives whole", async () => {
  runThrottledHelper.mockResolvedValue("");
  await resolveWin32Target("C:\\Users\\me\\notes.txt");
  expect(runThrottledHelper.mock.calls[0]?.[0].args.at(-1)).toMatch(
    /^\[Console\]::OutputEncoding = New-Object System\.Text\.UTF8Encoding \$false\n/,
  );
});

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
