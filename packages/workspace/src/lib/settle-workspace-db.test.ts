import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { withTempDir } from "../test/helpers/temp-dir";
import { settleWorkspaceDb } from "./settle-workspace-db";
import { writeStoreRowsSync } from "./store-table";

const temp = withTempDir("settle-workspace-db");

function dirs() {
  const machineDir = path.join(temp.path, "machine");
  const rootDir = path.join(temp.path, "workspace");
  return {
    databaseFile: path.join(machineDir, "workspace.db"),
    machineDir,
    rootDir,
    setAsideDir: path.join(rootDir, ".instrument", ".pre-chats", "window"),
    windowDir: path.join(rootDir, ".instrument", "window"),
  };
}

function write(file: string, contents: string | Uint8Array = "") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

/** Every file under `dir`, by its path from there. */
function tree(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .toSorted();
}

describe("settleWorkspaceDb", () => {
  it("makes workspace.db, once", () => {
    const { databaseFile, machineDir, rootDir } = dirs();

    expect(settleWorkspaceDb({ machineDir, rootDir })).toEqual({
      done: [],
      failed: 0,
    });
    expect(fs.existsSync(databaseFile)).toBe(true);

    expect(settleWorkspaceDb({ machineDir, rootDir })).toEqual({
      done: [],
      failed: 0,
    });
  });

  it("moves a workspace.db SQLite cannot read aside and makes it again", () => {
    const { databaseFile, machineDir, rootDir } = dirs();
    write(databaseFile, "not a database, not even close to one");

    const settled = settleWorkspaceDb({ machineDir, rootDir });

    expect(settled.failed).toBe(0);
    const aside = tree(machineDir).filter((name) =>
      name.includes(".unreadable-"),
    );
    expect(aside).toEqual([
      expect.stringMatching(/^workspace\.db\.unreadable-\d+$/),
    ]);
    expect(settled.done).toEqual([
      `moved aside ${databaseFile}, which SQLite could not read, to ${path.join(machineDir, aside[0] ?? "")}`,
    ]);
    expect(fs.readFileSync(path.join(machineDir, aside[0] ?? ""), "utf8")).toBe(
      "not a database, not even close to one",
    );
    const database = new DatabaseSync(databaseFile);
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM meta").get(),
    ).toEqual({ count: 0 });
    database.close();
  });

  describe("the window's former record folder", () => {
    it("removes a store that holds only its migration marker, and the folder", () => {
      const { machineDir, rootDir, windowDir } = dirs();
      fs.mkdirSync(windowDir, { recursive: true });
      const store = path.join(windowDir, "chat.db");
      writeStoreRowsSync(store, [["__migration_version__", 9]]);

      expect(settleWorkspaceDb({ machineDir, rootDir })).toEqual({
        done: [
          `removed ${store}, which held no records`,
          `removed ${windowDir}, the window's former record folder`,
        ],
        failed: 0,
      });
      expect(fs.existsSync(windowDir)).toBe(false);
      expect(settleWorkspaceDb({ machineDir, rootDir })).toEqual({
        done: [],
        failed: 0,
      });
    });

    it("sets aside a store that holds records, and anything else in the folder", () => {
      const { machineDir, rootDir, setAsideDir, windowDir } = dirs();
      fs.mkdirSync(windowDir, { recursive: true });
      writeStoreRowsSync(path.join(windowDir, "chat.db"), [
        ["__migration_version__", 9],
        [
          "browser-state:ses_01K7A000000000000000000001",
          { lastUsedAt: new Date(0), visitedHosts: ["example.com"] },
        ],
      ]);
      write(path.join(windowDir, "settings.json"), "{}");
      write(path.join(windowDir, "attachments", "note.txt"), "kept");

      const settled = settleWorkspaceDb({ machineDir, rootDir });

      expect(settled.failed).toBe(0);
      expect(fs.existsSync(windowDir)).toBe(false);
      expect(tree(setAsideDir)).toEqual([
        path.join("attachments", "note.txt"),
        "chat.db",
        "settings.json",
      ]);
      const aside = new DatabaseSync(path.join(setAsideDir, "chat.db"));
      expect(
        aside.prepare("SELECT key FROM sessions ORDER BY key").all(),
      ).toEqual([
        { key: "__migration_version__" },
        { key: "browser-state:ses_01K7A000000000000000000001" },
      ]);
      aside.close();
    });

    it("leaves an entry whose place aside is taken, and the folder with it, for the next launch", () => {
      const { machineDir, rootDir, setAsideDir, windowDir } = dirs();
      write(path.join(windowDir, "settings.json"), "the window's");
      write(path.join(setAsideDir, "settings.json"), "set aside before");

      const settled = settleWorkspaceDb({ machineDir, rootDir });

      expect(settled).toEqual({
        done: [
          `left ${path.join(windowDir, "settings.json")}: ${path.join(setAsideDir, "settings.json")} is already there`,
        ],
        failed: 1,
      });
      expect(
        fs.readFileSync(path.join(windowDir, "settings.json"), "utf8"),
      ).toBe("the window's");
    });
  });
});
