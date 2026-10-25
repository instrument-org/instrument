import { describe, expect, it } from "vitest";

import {
  instrumentFolderOf,
  keptInPlaceReason,
  SYSTEM_FOLDER_REASON,
} from "./instrument-folders";
import { type Os } from "./os-conventions";

const WORKSPACES: Record<Os, string> = {
  linux: "/home/linux-user/Instrument",
  mac: "/Users/mac-user/Instrument",
  windows: "C:\\Users\\windows-user\\Instrument",
};

describe("instrumentFolderOf", () => {
  it.each<[Os, string, string | undefined]>([
    ["mac", "/Users/mac-user/Instrument", "workspace"],
    ["mac", "/Users/mac-user/Instrument/", "workspace"],
    ["mac", "/users/MAC-USER/instrument", "workspace"],
    ["mac", "/Users/mac-user", "around"],
    ["mac", "/", "around"],
    ["mac", "/Users/mac-user/Instrument/Topics", "key:Topics"],
    ["mac", "/Users/mac-user/Instrument/topics", "key:Topics"],
    ["mac", "/Users/mac-user/Instrument/MEMORY", "key:Memory"],
    ["mac", "/Users/mac-user/Instrument/.instrument", "private"],
    ["mac", "/Users/mac-user/Instrument/.Instrument", "private"],
    ["mac", "/Users/mac-user/Instrument/Topics/Travel", undefined],
    ["mac", "/Users/mac-user/Instrument/Projects/Chats", undefined],
    ["mac", "/Users/mac-user/Instrument/.instrument/chats", undefined],
    ["mac", "/Users/mac-user/Instrument/Notes", undefined],
    ["mac", "/Users/mac-user/Instrument Old", undefined],
    ["mac", "/Users/mac-user/Instrument Old/Chats", undefined],
    ["mac", "/Users/mac-user/Instrument/Projects/../Skills", "key:Skills"],
    ["windows", "C:\\Users\\windows-user\\Instrument", "workspace"],
    ["windows", "c:/users/windows-user/instrument/", "workspace"],
    ["windows", "C:\\Users", "around"],
    ["windows", "C:\\", "around"],
    ["windows", "C:\\Users\\windows-user\\Instrument\\Drafts", "key:Drafts"],
    ["windows", "C:\\Users\\windows-user\\Instrument\\apps.", "key:Apps"],
    [
      "windows",
      "\\\\?\\C:\\Users\\windows-user\\Instrument\\Chats",
      "key:Chats",
    ],
    ["windows", "C:\\Users\\windows-user\\Instrument\\Work\\Chats", undefined],
    ["windows", "D:\\Users\\windows-user\\Instrument\\Chats", undefined],
    ["linux", "/home/linux-user/Instrument", "workspace"],
    ["linux", "/home/linux-user", "around"],
    ["linux", "/home/linux-user/Instrument/Skills", "key:Skills"],
    // Another case is another folder on Linux, and the person's.
    ["linux", "/home/linux-user/Instrument/skills", undefined],
    ["linux", "/home/linux-user/instrument", undefined],
    ["linux", "/home/linux-user/Instrument/.instrument", "private"],
    ["linux", "/home/linux-user/Instrument/Apps/Calendar", undefined],
  ])("on %s, %s is %s", (os, hostPath, expected) => {
    const folder = instrumentFolderOf(hostPath, {
      os,
      workspace: WORKSPACES[os],
    });
    expect(
      folder && (folder.kind === "key" ? `key:${folder.name}` : folder.kind),
    ).toBe(expected);
  });
});

// A workspace at a disk's top, which setup warns of but allows.
it.each<[Os, string, string, string | undefined]>([
  ["windows", "D:\\", "D:\\Topics", "key:Topics"],
  ["windows", "D:\\", "d:\\.instrument", "private"],
  ["windows", "D:\\", "D:\\Projects\\Topics", undefined],
  ["linux", "/", "/Skills", "key:Skills"],
  ["mac", "/", "/Chats", "key:Chats"],
  ["mac", "/", "/Users", undefined],
])(
  "on %s with the workspace at %s, %s is %s",
  (os, workspace, hostPath, expected) => {
    const folder = instrumentFolderOf(hostPath, { os, workspace });
    expect(
      folder && (folder.kind === "key" ? `key:${folder.name}` : folder.kind),
    ).toBe(expected);
  },
);

describe("keptInPlaceReason", () => {
  const facts = {
    home: "/Users/mac-user",
    os: "mac",
    workspace: WORKSPACES.mac,
  } as const;

  it("says why each folder can’t be renamed or deleted", () => {
    expect(
      [
        "/Users/mac-user/Documents",
        "/Users/mac-user/Instrument",
        "/Users/mac-user/Projects",
        "/Users/mac-user/Instrument/Topics",
        "/Users/mac-user/Instrument/memory",
        "/Users/mac-user/Instrument/.instrument",
        "/Users/mac-user/Instrument/Topics/Travel",
      ].map((hostPath) => keptInPlaceReason(hostPath, facts)),
    ).toMatchInlineSnapshot(`
      [
        "Your computer needs this folder, so you can’t rename or delete it.",
        "This is your Instrument workspace, so you can’t rename or delete it.",
        undefined,
        "Instrument saves your topics in this folder, so you can’t rename or delete it.",
        "Instrument saves your memories in this folder, so you can’t rename or delete it.",
        "Instrument saves its own data in this folder, so you can’t rename or delete it.",
        undefined,
      ]
    `);
  });

  it("knows the system's folders before the workspace is known", () => {
    expect(
      keptInPlaceReason("/Users/mac-user/Desktop", {
        home: "/Users/mac-user",
        os: "mac",
      }),
    ).toBe(SYSTEM_FOLDER_REASON);
    expect(
      keptInPlaceReason("/Users/mac-user/Instrument", {
        home: "/Users/mac-user",
        os: "mac",
      }),
    ).toBeUndefined();
  });

  it("finds a workspace inside a system folder kept as a system folder", () => {
    expect(
      keptInPlaceReason("/Users/mac-user/Documents", {
        ...facts,
        workspace: "/Users/mac-user/Documents/Instrument",
      }),
    ).toBe(SYSTEM_FOLDER_REASON);
  });
});
