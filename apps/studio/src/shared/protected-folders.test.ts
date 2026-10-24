import { describe, expect, it } from "vitest";

import { isProtectedFolder } from "./protected-folders";

describe("isProtectedFolder", () => {
  it.each([
    ["/", true],
    ["/Users", true],
    ["/Users/mac-user", true],
    ["/Users/mac-user/", true],
    ["/users/MAC-USER/desktop", true],
    ["/Users/mac-user/Documents", true],
    ["/Users/mac-user/Library", true],
    ["/Users/mac-user/Library/Mobile Documents/com~apple~CloudDocs", true],
    ["/Users/mac-user/Library/CloudStorage/Dropbox", true],
    ["/Volumes/Backup", true],
    ["/System/Library/CoreServices", true],
    ["/usr/local/bin", true],
    ["/Applications", true],
    ["/Applications/Notes.app", false],
    ["/Users/mac-user/Documents/Taxes", false],
    ["/Users/mac-user/Library/CloudStorage/Dropbox/Photos", false],
    ["/Users/mac-user/Library/Application Support", false],
    ["/Volumes/Backup/2026", false],
    ["/Users/mac-user/visual-answers", false],
    ["/private/tmp", true],
    ["/private/var/folders/xy/T/files-route-1", false],
    ["/tmp/scratch", false],
  ])("on a Mac, %s is %s", (path, expected) => {
    expect(
      isProtectedFolder(path, { home: "/Users/mac-user", os: "mac" }),
    ).toBe(expected);
  });

  it.each([
    ["C:\\", true],
    ["C:", true],
    ["D:\\", true],
    ["C:\\Users\\windows-user", true],
    ["c:\\users\\windows-user\\appdata", true],
    ["C:/Users/windows-user/Downloads", true],
    ["D:\\Windows\\System32", true],
    ["C:\\Program Files\\Instrument", true],
    ["\\\\server\\share", true],
    ["C:\\Users\\windows-user\\Documents\\Taxes", false],
    ["\\\\server\\share\\folder", false],
  ])("on Windows, %s is %s", (path, expected) => {
    expect(
      isProtectedFolder(path, {
        home: "C:\\Users\\windows-user",
        os: "windows",
      }),
    ).toBe(expected);
  });

  it.each([
    ["/home/linux-user", true],
    ["/home/linux-user/.config", true],
    ["/home/linux-user/Videos", true],
    ["/media/linux-user/USB", true],
    ["/run/media/linux-user/USB", true],
    ["/etc/ssh", true],
    ["/media/linux-user/USB/photos", false],
    ["/home/linux-user/desktop", false],
    ["/home/linux-user/code", false],
  ])("on Linux, %s is %s", (path, expected) => {
    expect(
      isProtectedFolder(path, { home: "/home/linux-user", os: "linux" }),
    ).toBe(expected);
  });
});
