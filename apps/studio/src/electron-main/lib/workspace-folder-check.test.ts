import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  FOLDER_REFUSAL_COPY,
  type FolderRefusal,
  folderRefusalSentence,
} from "../../shared/workspace-folder-refusal";
import {
  type FolderFacts,
  type FolderPlatform,
  folderRefusal,
  folderRefusalHere,
  installDirOf,
} from "./workspace-folder-check";

const FACTS: Record<FolderPlatform, FolderFacts> = {
  darwin: {
    home: "/Users/casey",
    installDir: "/Applications/Instrument.app",
    otherWorkspaces: ["/Users/casey/Projects/Lab"],
    platform: "darwin",
    userDataDir: "/Users/casey/Library/Application Support/Instrument",
  },
  linux: {
    home: "/home/casey",
    installDir: "/opt/Instrument",
    otherWorkspaces: ["/home/casey/Projects/Lab"],
    platform: "linux",
    userDataDir: "/home/casey/.config/Instrument",
  },
  win32: {
    home: "C:\\Users\\casey",
    installDir: "C:\\Users\\casey\\AppData\\Local\\Programs\\Instrument",
    otherWorkspaces: ["C:\\Users\\casey\\Projects\\Lab"],
    platform: "win32",
    systemDrive: "C:",
    userDataDir: "C:\\Users\\casey\\AppData\\Roaming\\Instrument",
  },
};

describe("folderRefusal", () => {
  it.each<[FolderPlatform, string, FolderRefusal]>([
    ["darwin", "/Users/casey", "home"],
    ["darwin", "/users/CASEY/", "home"],
    ["darwin", "/Users", "around-home"],
    ["darwin", "/", "around-home"],
    ["darwin", "/System/Volumes/Data", "system"],
    ["darwin", "/Library/Fonts", "system"],
    ["darwin", "/usr/local/work", "system"],
    ["darwin", "/bin", "system"],
    ["darwin", "/Applications", "system"],
    ["darwin", "/private/etc/ssh", "system"],
    ["darwin", "/Applications/Instrument.app/Contents", "own-data"],
    ["darwin", "/Users/casey/Library", "apps-data"],
    ["darwin", "/Users/casey/library/Mobile Documents", "apps-data"],
    [
      "darwin",
      "/Users/casey/Library/Application Support/Instrument/workspace",
      "own-data",
    ],
    ["darwin", "/Users/casey/Library/Application Support", "apps-data"],
    ["darwin", "/Users/casey/Library/CloudStorage", "apps-data"],
    ["darwin", "/Users/casey/Library/Mobile Documents", "apps-data"],
    ["darwin", "/Users/casey/.instrument", "own-data"],
    ["darwin", "/Users/casey/.Instrument/work", "own-data"],
    ["darwin", "/Volumes", "drive"],
    ["darwin", "/Volumes/Backup", "drive"],
    ["darwin", "/Users/casey/Projects/Lab/notes", "other-workspace"],
    ["darwin", "/Users/casey/projects", "other-workspace"],

    ["linux", "/home/casey", "home"],
    ["linux", "/home", "around-home"],
    ["linux", "/", "around-home"],
    ["linux", "/usr/share", "system"],
    ["linux", "/etc", "system"],
    ["linux", "/opt/tools", "system"],
    ["linux", "/var/lib/work", "system"],
    ["linux", "/opt/Instrument/resources", "own-data"],
    ["linux", "/home/casey/.config", "apps-data"],
    ["linux", "/home/casey/.local/share/Instrument", "apps-data"],
    ["linux", "/home/casey/.cache/work", "apps-data"],
    ["linux", "/home/casey/.config/Instrument/workspace", "own-data"],
    ["linux", "/home/casey/.instrument", "own-data"],
    ["linux", "/mnt/usb", "drive"],
    ["linux", "/media/casey/USB", "drive"],
    ["linux", "/run/media/casey/USB", "drive"],
    ["linux", "/home/casey/Projects/Lab/notes", "other-workspace"],
    ["linux", "/home/casey/Projects", "other-workspace"],

    ["win32", "C:\\Users\\casey", "home"],
    ["win32", "c:\\users\\CASEY\\", "home"],
    ["win32", "C:\\Users", "around-home"],
    ["win32", "C:\\", "around-home"],
    ["win32", "D:\\", "drive"],
    ["win32", "\\\\server\\share", "drive"],
    ["win32", "C:\\Windows", "system"],
    ["win32", "C:\\windows\\System32", "system"],
    ["win32", "C:\\Program Files\\Tools", "system"],
    ["win32", "C:\\Program Files (x86)", "system"],
    ["win32", "C:\\ProgramData\\Work", "system"],
    ["win32", "C:\\Users\\casey\\AppData", "apps-data"],
    ["win32", "C:\\Users\\casey\\appdata\\Local\\Work", "apps-data"],
    [
      "win32",
      "C:\\Users\\casey\\AppData\\Local\\Programs\\Instrument\\resources",
      "own-data",
    ],
    ["win32", "C:\\Users\\casey\\AppData\\Roaming\\Instrument", "own-data"],
    ["win32", "C:\\Users\\casey\\.instrument", "own-data"],
    ["win32", "C:\\Users\\casey\\Projects\\Lab\\notes", "other-workspace"],
    ["win32", "C:\\Users\\casey\\Projects", "other-workspace"],
  ])("%s refuses %s as %s", (platform, folder, refusal) => {
    expect(folderRefusal(folder, FACTS[platform])).toBe(refusal);
  });

  it.each<[FolderPlatform, string]>([
    ["darwin", "/Users/casey/Instrument"],
    ["darwin", "/Users/casey/Documents/Instrument"],
    ["darwin", "/Users/casey/Projects/Lab Notes"],
    ["darwin", "/Users/casey/.instrument-work"],
    ["darwin", "/Volumes/Backup/Instrument"],
    ["darwin", "/Users/Shared/Instrument"],
    [
      "darwin",
      "/Users/casey/Library/Mobile Documents/com~apple~CloudDocs/Instrument",
    ],
    ["darwin", "/Users/casey/Library/CloudStorage/Dropbox/Instrument"],
    ["linux", "/home/casey/Instrument"],
    ["linux", "/home/casey/Documents/Instrument"],
    ["linux", "/home/Casey"],
    ["linux", "/home/casey/Library"],
    ["linux", "/media/casey/USB/Instrument"],
    ["linux", "/srv/instrument"],
    ["win32", "C:\\Users\\casey\\Instrument"],
    ["win32", "C:\\Users\\casey\\Documents\\Instrument"],
    ["win32", "D:\\Instrument"],
    ["win32", "C:\\Users\\casey\\OneDrive\\Instrument"],
  ])("%s takes %s", (platform, folder) => {
    expect(folderRefusal(folder, FACTS[platform])).toBeUndefined();
  });

  it("reads the system folders from the system drive", () => {
    const facts = { ...FACTS.win32, systemDrive: "D:" };
    expect(folderRefusal("D:\\Windows", facts)).toBe("system");
    expect(folderRefusal("C:\\Windows", facts)).toBeUndefined();
  });

  it("refuses a folder the system says is a disk’s top", () => {
    expect(
      folderRefusal("/Users/casey/Mounted", {
        ...FACTS.darwin,
        volumeRoot: true,
      }),
    ).toBe("drive");
  });
});

describe("installDirOf", () => {
  it.each<[FolderPlatform, string, string]>([
    [
      "darwin",
      "/Applications/Instrument.app/Contents/MacOS/Instrument",
      "/Applications/Instrument.app",
    ],
    ["darwin", "/usr/local/bin/node", "/usr/local/bin"],
    ["linux", "/opt/Instrument/instrument", "/opt/Instrument"],
    [
      "win32",
      "C:\\Users\\casey\\AppData\\Local\\Programs\\Instrument\\Instrument.exe",
      "C:\\Users\\casey\\AppData\\Local\\Programs\\Instrument",
    ],
  ])("%s runs %s from %s", (platform, executable, dir) => {
    expect(installDirOf(executable, platform)).toBe(dir);
  });
});

describe("folderRefusalHere", () => {
  let root: string;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "folder-")));
  });

  afterEach(() => {
    fs.rmSync(root, { force: true, recursive: true });
  });

  it("follows a link to the folder it names", () => {
    const userDataDir = path.join(root, "userData");
    fs.mkdirSync(path.join(userDataDir, "inside"), { recursive: true });
    fs.symlinkSync(path.join(userDataDir, "inside"), path.join(root, "link"));
    expect(
      folderRefusalHere({
        folder: path.join(root, "link"),
        otherWorkspaces: [],
        userDataDir,
      }),
    ).toBe("own-data");
  });

  it("refuses the home folder on this computer", () => {
    expect(
      folderRefusalHere({
        folder: os.homedir(),
        otherWorkspaces: [],
        userDataDir: path.join(root, "userData"),
      }),
    ).toBe("home");
  });
});

describe("folder refusal copy", () => {
  it("says why and what to pick instead in one sentence", () => {
    expect(folderRefusalSentence("home")).toBe(
      "Your home folder has everything in it, so pick or make a folder inside it.",
    );
    for (const { instead, why } of Object.values(FOLDER_REFUSAL_COPY)) {
      expect(why).not.toMatch(/[.,]$/);
      expect(instead).toMatch(/^[a-z]/);
    }
  });
});
