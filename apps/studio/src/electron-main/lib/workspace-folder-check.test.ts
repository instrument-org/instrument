import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  FOLDER_REFUSAL_COPY,
  FOLDER_WARNING_COPY,
  type FolderRefusal,
  folderRefusalSentence,
  type FolderWarning,
  folderWarningSentence,
} from "../../shared/workspace-folder-refusal";
import {
  folderConcern,
  folderConcernHere,
  type FolderFacts,
  type FolderPlatform,
  installDirOf,
} from "./workspace-folder-check";

const FACTS: Record<FolderPlatform, FolderFacts> = {
  darwin: {
    home: "/Users/casey",
    installDir: "/Applications/Instrument.app",
    otherWorkspaces: ["/Users/casey/Projects/Lab"],
    platform: "darwin",
    signInDirs: ["/Users/casey/.ssh", "/Users/casey/Library/LaunchAgents"],
    temporaryDirs: ["/private/var/folders/xy/T", "/private/tmp"],
    userDataDir: "/Users/casey/Library/Application Support/Instrument",
  },
  linux: {
    home: "/home/casey",
    installDir: "/opt/Instrument",
    otherWorkspaces: ["/home/casey/Projects/Lab"],
    platform: "linux",
    signInDirs: ["/home/casey/.ssh", "/home/casey/.config/gh"],
    temporaryDirs: ["/tmp", "/var/tmp"],
    userDataDir: "/home/casey/.config/Instrument",
  },
  win32: {
    home: "C:\\Users\\casey",
    installDir: "C:\\Users\\casey\\AppData\\Local\\Programs\\Instrument",
    otherWorkspaces: ["C:\\Users\\casey\\Projects\\Lab"],
    platform: "win32",
    signInDirs: ["C:\\Users\\casey\\.ssh"],
    systemDrive: "C:",
    temporaryDirs: ["C:\\Users\\casey\\AppData\\Local\\Temp"],
    userDataDir: "C:\\Users\\casey\\AppData\\Roaming\\Instrument",
  },
};

describe("folderConcern", () => {
  it.each<[FolderPlatform, string, FolderRefusal]>([
    ["darwin", "/Users/casey", "home"],
    ["darwin", "/users/CASEY/", "home"],
    ["darwin", "/Applications/Instrument.app", "own-data"],
    ["darwin", "/Applications/Instrument.app/Contents", "own-data"],
    [
      "darwin",
      "/Users/casey/Library/Application Support/Instrument/workspace",
      "own-data",
    ],
    ["darwin", "/Users/casey/.instrument", "own-data"],
    ["darwin", "/Users/casey/.Instrument/work", "own-data"],
    // Another flavor's data folder, whichever flavor asks.
    ["darwin", "/Users/casey/.instrument-dev", "own-data"],
    ["darwin", "/Users/casey/.instrument-preview/work", "own-data"],
    ["darwin", "/Users/casey/Projects/Lab/notes", "other-workspace"],
    ["darwin", "/Users/casey/projects", "other-workspace"],

    ["linux", "/home/casey", "home"],
    ["linux", "/opt/Instrument/resources", "own-data"],
    ["linux", "/home/casey/.config/Instrument/workspace", "own-data"],
    ["linux", "/home/casey/.instrument", "own-data"],
    ["linux", "/home/casey/Projects/Lab/notes", "other-workspace"],
    ["linux", "/home/casey/Projects", "other-workspace"],

    ["win32", "C:\\Users\\casey", "home"],
    ["win32", "c:\\users\\CASEY\\", "home"],
    [
      "win32",
      "C:\\Users\\casey\\AppData\\Local\\Programs\\Instrument\\resources",
      "own-data",
    ],
    ["win32", "C:\\Users\\casey\\AppData\\Roaming\\Instrument", "own-data"],
    ["win32", "C:\\Users\\casey\\.instrument", "own-data"],
    ["win32", "C:\\Users\\casey\\Projects\\Lab\\notes", "other-workspace"],
    ["win32", "C:\\Users\\casey\\Projects", "other-workspace"],
  ])("%s refuses %s as %s", (platform, folder, reason) => {
    expect(folderConcern(folder, FACTS[platform])).toEqual({
      kind: "refused",
      reason,
    });
  });

  it.each<[FolderPlatform, string, FolderWarning]>([
    ["darwin", "/Users", "around-home"],
    ["darwin", "/", "around-home"],
    ["darwin", "/System/Volumes/Data", "system"],
    ["darwin", "/Library/Fonts", "system"],
    ["darwin", "/usr/local/work", "system"],
    ["darwin", "/bin", "system"],
    ["darwin", "/Applications", "system"],
    ["darwin", "/private/etc/ssh", "system"],
    ["darwin", "/Users/casey/Library", "apps-data"],
    ["darwin", "/Users/casey/library/Mobile Documents", "apps-data"],
    ["darwin", "/Users/casey/Library/Application Support", "apps-data"],
    ["darwin", "/Users/casey/Library/CloudStorage", "apps-data"],
    ["darwin", "/Users/casey/Library/Mobile Documents", "apps-data"],
    ["darwin", "/Volumes", "drive"],
    ["darwin", "/Volumes/Backup", "drive"],
    ["darwin", "/Users/casey/Documents", "personal"],
    ["darwin", "/users/casey/desktop/", "personal"],
    ["darwin", "/Users/casey/Downloads", "personal"],
    [
      "darwin",
      "/Users/casey/Library/Mobile Documents/com~apple~CloudDocs",
      "personal",
    ],
    ["darwin", "/private/tmp/work", "temporary"],
    ["darwin", "/private/var/folders/xy/T", "temporary"],
    ["darwin", "/Users/casey/.ssh", "sign-ins"],
    ["darwin", "/Users/casey/Library/LaunchAgents", "sign-ins"],
    ["darwin", "/Users/casey/.instrument-work", "apps-data"],

    ["linux", "/home", "around-home"],
    ["linux", "/", "around-home"],
    ["linux", "/usr/share", "system"],
    ["linux", "/etc", "system"],
    ["linux", "/opt/tools", "system"],
    ["linux", "/var/lib/work", "system"],
    ["linux", "/home/casey/.config", "apps-data"],
    ["linux", "/home/casey/.local/share/Instrument", "apps-data"],
    ["linux", "/home/casey/.cache/work", "apps-data"],
    ["linux", "/mnt/usb", "drive"],
    ["linux", "/media/casey/USB", "drive"],
    ["linux", "/run/media/casey/USB", "drive"],
    ["linux", "/home/casey/Documents", "personal"],
    ["linux", "/home/casey/Downloads", "personal"],
    ["linux", "/tmp", "temporary"],
    ["linux", "/var/tmp/work", "temporary"],
    ["linux", "/home/casey/.ssh/keys", "sign-ins"],
    ["linux", "/home/casey/.config/gh", "sign-ins"],
    ["linux", "/home/casey/.notes", "apps-data"],

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
    ["win32", "C:\\Users\\casey\\Documents", "personal"],
    ["win32", "c:\\users\\casey\\DESKTOP", "personal"],
    ["win32", "C:\\Users\\casey\\AppData\\Local\\Temp\\Work", "temporary"],
    ["win32", "C:\\Users\\casey\\.ssh", "sign-ins"],
  ])("%s warns of %s as %s", (platform, folder, reason) => {
    const facts = { ...FACTS[platform], otherWorkspaces: [] };
    expect(folderConcern(folder, facts)).toEqual({
      kind: "warning",
      reason,
    });
  });

  it.each<[FolderPlatform, string]>([
    ["darwin", "/Users/casey/Instrument"],
    ["darwin", "/Users/casey/Documents/Instrument"],
    ["darwin", "/Users/casey/Projects/Lab Notes"],
    ["darwin", "/Users/casey/Documents/Notes/Instrument"],
    ["darwin", "/Users/casey/Desktop/Instrument"],
    ["darwin", "/Users/casey/Mounted"],
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
    ["linux", "/home/casey/Downloads/Instrument"],
    ["win32", "C:\\Users\\casey\\Instrument"],
    ["win32", "C:\\Users\\casey\\Documents\\Instrument"],
    ["win32", "C:\\Users\\casey\\Downloads\\Instrument"],
    ["win32", "D:\\Instrument"],
    ["win32", "C:\\Users\\casey\\OneDrive\\Instrument"],
  ])("%s takes %s", (platform, folder) => {
    expect(folderConcern(folder, FACTS[platform])).toBeUndefined();
  });

  it.each<FolderPlatform>(["darwin", "linux", "win32"])(
    "%s refuses a folder around home with another workspace in it, before warning of where it is",
    (platform) => {
      const around = path[platform === "win32" ? "win32" : "posix"].dirname(
        FACTS[platform].home,
      );
      expect(folderConcern(around, FACTS[platform])).toEqual({
        kind: "refused",
        reason: "other-workspace",
      });
    },
  );

  it("warns of a folder around the app's data", () => {
    expect(
      folderConcern("/srv", {
        ...FACTS.linux,
        userDataDir: "/srv/instrument-data",
      }),
    ).toEqual({ kind: "warning", reason: "apps-data" });
  });

  it("reads the system folders from the system drive", () => {
    const facts = { ...FACTS.win32, systemDrive: "D:" };
    expect(folderConcern("D:\\Windows", facts)).toEqual({
      kind: "warning",
      reason: "system",
    });
    expect(folderConcern("C:\\Windows", facts)).toBeUndefined();
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

describe("folderConcernHere", () => {
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
      folderConcernHere({
        folder: path.join(root, "link"),
        otherWorkspaces: [],
        userDataDir,
      }),
    ).toEqual({ kind: "refused", reason: "own-data" });
  });

  it("refuses the home folder on this computer", () => {
    expect(
      folderConcernHere({
        folder: os.homedir(),
        otherWorkspaces: [],
        userDataDir: path.join(root, "userData"),
      }),
    ).toEqual({ kind: "refused", reason: "home" });
  });
});

describe("folder copy", () => {
  it("says why and what to pick instead in one sentence", () => {
    expect(folderRefusalSentence("home")).toBe(
      "Your home folder has everything in it, so pick or make a folder inside it.",
    );
    for (const { instead, why } of Object.values(FOLDER_REFUSAL_COPY)) {
      expect(why).not.toMatch(/[.,]$/);
      expect(instead).toMatch(/^[a-z]/);
    }
  });

  it("says why a place is risky and why that matters", () => {
    expect(folderWarningSentence("system")).toMatchInlineSnapshot(
      `"Your computer keeps its system files in that folder. Chats can change anything in your Instrument folder, so it’s safer to use a folder just for Instrument."`,
    );
    for (const why of Object.values(FOLDER_WARNING_COPY)) {
      expect(why).toMatch(/^[A-Z].*\.$/);
    }
  });
});
