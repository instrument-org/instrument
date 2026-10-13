import { describe, expect, it } from "vitest";

import {
  copyName,
  newFolderName,
  type Os,
  OS_CONVENTIONS,
  osOf,
  windowsDriveName,
} from "./os-conventions";

const OSES: Os[] = ["mac", "windows", "linux"];

describe("OS_CONVENTIONS", () => {
  it("holds each system's words and keys", () => {
    expect(OS_CONVENTIONS).toMatchInlineSnapshot(`
      {
        "linux": {
          "appFiles": "Hidden folders like .config",
          "commandKey": "ctrlKey",
          "computer": "This Computer",
          "computerKind": "computer",
          "fileManager": "File Manager",
          "files": {
            "parentFolderKey": "altKey",
            "renameKey": "F2",
            "trashKey": {
              "key": "Delete",
              "withCommandKey": false,
            },
          },
          "folderPickerTitle": "Select Folder",
          "inFileManager": "your file manager",
          "keyJoiner": "+",
          "modifierKeys": {
            "alt": "Alt",
            "command": "Super",
            "control": "Ctrl",
            "shift": "Shift",
          },
          "passwordStore": null,
          "quickLook": "Preview",
          "returnKey": "Enter",
          "showInFileManager": "Show in File Manager",
          "thisComputer": "this computer",
          "trash": "Trash",
        },
        "mac": {
          "appFiles": "Library and hidden folders",
          "commandKey": "metaKey",
          "computer": "This Mac",
          "computerKind": "Mac",
          "fileManager": "Finder",
          "files": {
            "parentFolderKey": "metaKey",
            "renameKey": "Enter",
            "trashKey": {
              "key": "Backspace",
              "withCommandKey": true,
            },
          },
          "folderPickerTitle": undefined,
          "inFileManager": "Finder",
          "keyJoiner": "",
          "modifierKeys": {
            "alt": "⌥",
            "command": "⌘",
            "control": "⌃",
            "shift": "⇧",
          },
          "passwordStore": "Keychain",
          "quickLook": "Quick Look",
          "returnKey": "↩",
          "showInFileManager": "Show in Finder",
          "thisComputer": "this Mac",
          "trash": "Trash",
        },
        "windows": {
          "appFiles": "AppData",
          "commandKey": "ctrlKey",
          "computer": "This PC",
          "computerKind": "PC",
          "fileManager": "File Explorer",
          "files": {
            "parentFolderKey": "altKey",
            "renameKey": "F2",
            "trashKey": {
              "key": "Delete",
              "withCommandKey": false,
            },
          },
          "folderPickerTitle": undefined,
          "inFileManager": "File Explorer",
          "keyJoiner": "+",
          "modifierKeys": {
            "alt": "Alt",
            "command": "Win",
            "control": "Ctrl",
            "shift": "Shift",
          },
          "passwordStore": null,
          "quickLook": "Preview",
          "returnKey": "Enter",
          "showInFileManager": "Show in File Explorer",
          "thisComputer": "this PC",
          "trash": "Recycle Bin",
        },
      }
    `);
  });
});

describe("osOf", () => {
  it.each([
    ["darwin", "mac"],
    ["win32", "windows"],
    ["linux", "linux"],
    ["freebsd", "linux"],
  ])("reads %s as %s", (platform, os) => {
    expect(osOf(platform)).toBe(os);
  });
});

describe("the names the file manager gives", () => {
  it("counts new folders and copies the way each system's does", () => {
    expect(
      OSES.map(
        (os) =>
          `${os}: ${[1, 2, 3].map((n) => newFolderName(os, n)).join(", ")} | ${[
            1, 2,
          ]
            .map((n) => `${copyName(os, "notes", n)}.txt`)
            .join(", ")}`,
      ),
    ).toMatchInlineSnapshot(`
      [
        "mac: untitled folder, untitled folder 2, untitled folder 3 | notes copy.txt, notes copy 2.txt",
        "windows: New folder, New folder (2), New folder (3) | notes - Copy.txt, notes - Copy (2).txt",
        "linux: Untitled Folder, Untitled Folder 2, Untitled Folder 3 | notes (copy).txt, notes (copy 2).txt",
      ]
    `);
  });
});

describe("windowsDriveName", () => {
  it("names a drive the way File Explorer lists it", () => {
    expect([
      windowsDriveName({ kind: "fixed", label: "", letter: "C:" }),
      windowsDriveName({ kind: "fixed", label: "Data", letter: "D:" }),
      windowsDriveName({ kind: "removable", label: " ", letter: "E:" }),
      windowsDriveName({ kind: "removable", label: "KINGSTON", letter: "F:" }),
      windowsDriveName({ kind: "optical", label: "", letter: "G:" }),
      windowsDriveName({
        kind: "network",
        label: "",
        letter: "Z:",
        share: "\\\\nas\\Public",
      }),
      windowsDriveName({
        kind: "network",
        label: "",
        letter: "Y:",
        share: "\\\\nas\\media\\Movies\\",
      }),
      windowsDriveName({ kind: "network", label: "", letter: "X:" }),
    ]).toMatchInlineSnapshot(`
      [
        "Local Disk (C:)",
        "Data (D:)",
        "USB Drive (E:)",
        "KINGSTON (F:)",
        "DVD Drive (G:)",
        "Public (\\\\nas) (Z:)",
        "Movies (\\\\nas\\media) (Y:)",
        "Network Drive (X:)",
      ]
    `);
  });
});
