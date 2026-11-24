import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NO_FAVORITE_CHANGES, favoritePlaces } from "@/shared/favorite-places";

import {
  adoptSystemSidebarOnce,
  gtkBookmarkFolders,
  quickAccessFolders,
} from "./system-sidebar";

const { computer, stored } = vi.hoisted(() => ({
  /** The places the computer lists under Favorites by default. */
  computer: { favorites: [] as { kind: string; name: string; path: string }[] },
  /** The machine preferences, in memory. */
  stored: new Map<string, unknown>(),
}));
vi.mock("@instrument-org/workspace/electron", () => ({
  computerPlaces: () => Promise.resolve(computer),
}));
vi.mock("../stores/machine/preferences", () => ({
  getMachinePreferences: () => ({
    get: (key: string) => stored.get(key),
    set: (key: string, value: unknown) => stored.set(key, value),
  }),
}));
vi.mock("@/electron-main/lib/electron-logger", () => ({
  logger: { warn: vi.fn() },
}));

describe("quickAccessFolders", () => {
  it.each([
    [
      '["C:\\\\Users\\\\windows-user\\\\Desktop","D:\\\\Work"]',
      ["C:\\Users\\windows-user\\Desktop", "D:\\Work"],
    ],
    [
      '"C:\\\\Users\\\\windows-user\\\\Desktop"\r\n',
      ["C:\\Users\\windows-user\\Desktop"],
    ],
    ["[]", []],
    ["", []],
  ])("reads %j", (stdout, folders) => {
    expect(quickAccessFolders(stdout)).toEqual(folders);
  });
});

describe("gtkBookmarkFolders", () => {
  it("reads the local folders, labeled or not, and skips other addresses", () => {
    expect(
      gtkBookmarkFolders(
        [
          "file:///home/casey/code",
          "file:///home/casey/My%20Notes Notes",
          "sftp://server/home/casey",
          "",
        ].join("\n"),
      ),
    ).toEqual(["/home/casey/code", "/home/casey/My Notes"]);
  });
});

describe("adoptSystemSidebarOnce on Linux", () => {
  const platform = process.platform;
  let home: string;
  /** The Favorites section's rows, by name. */
  const rows = () =>
    favoritePlaces(
      computer.favorites.filter((place) => place.kind !== "output"),
      stored.get("favoriteChanges") as typeof NO_FAVORITE_CHANGES,
      (folder) => ({
        kind: "folder",
        name: path.basename(folder),
        path: folder,
      }),
    ).map((place) => place.name);

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "linux-user-"));
    const folders = ["Desktop", "Documents", "Downloads"];
    await Promise.all(
      [...folders, "code", "Notes"].map((name) =>
        fs.mkdir(path.join(home, name)),
      ),
    );
    computer.favorites = [
      {
        kind: "output",
        name: "Instrument",
        path: path.join(home, "Instrument"),
      },
      { kind: "home", name: "Home", path: home },
      ...folders.map((name) => ({
        kind: "folder",
        name,
        path: path.join(home, name),
      })),
    ];
    stored.clear();
    stored.set("favoriteChanges", NO_FAVORITE_CHANGES);
    vi.spyOn(os, "homedir").mockReturnValue(home);
    Object.defineProperty(process, "platform", { value: "linux" });
  });

  afterEach(async () => {
    Object.defineProperty(process, "platform", { value: platform });
    vi.restoreAllMocks();
    await fs.rm(home, { force: true, recursive: true });
  });

  it("leaves the defaults in Favorites, and the system's pins to read at the next launch, with no bookmarks file", async () => {
    await adoptSystemSidebarOnce();

    expect(rows()).toEqual(["Home", "Desktop", "Documents", "Downloads"]);
    expect(stored.get("systemSidebarAdopted")).toBeUndefined();
  });

  it("adds the bookmarked folders and keeps every default", async () => {
    await fs.mkdir(path.join(home, ".config", "gtk-3.0"), { recursive: true });
    await fs.writeFile(
      path.join(home, ".config", "gtk-3.0", "bookmarks"),
      ["code", "Notes"]
        .map((name) => `${pathToFileURL(path.join(home, name)).href}\n`)
        .join(""),
    );

    await adoptSystemSidebarOnce();

    expect(rows()).toEqual([
      "code",
      "Notes",
      "Home",
      "Desktop",
      "Documents",
      "Downloads",
    ]);
    expect(stored.get("systemSidebarAdopted")).toBe(true);
  });
});
