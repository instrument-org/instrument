import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  type MovedPath,
  readMovedPaths,
  recordMovedPaths,
  remapMovedPath,
} from "./moved-paths";
import { withTempDir } from "../test/helpers/temp-dir";

const root = withTempDir("moved-paths");

/** A file under the test's folder, made with its parents. */
function touch(...segments: string[]): string {
  const file = path.join(root.path, ...segments);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "");
  return file;
}

function at(...segments: string[]): string {
  return path.join(root.path, ...segments);
}

describe("remapMovedPath", () => {
  it("leaves a path that is still there where it is", () => {
    const moves: MovedPath[] = [{ from: at("chats"), to: at("work") }];
    const stayed = touch("chats", "a", "attachments", "cat.png");
    touch("work", "a", "attachments", "cat.png");

    expect(remapMovedPath(stayed, moves)).toBe(stayed);
  });

  it("finds a path that is gone under the place its folder moved to", () => {
    const moves: MovedPath[] = [{ from: at("chats"), to: at("work") }];

    expect(remapMovedPath(at("chats", "a", "work", "report.md"), moves)).toBe(
      at("work", "a", "work", "report.md"),
    );
  });

  it("takes the deepest move that holds the path", () => {
    const moves: MovedPath[] = [
      { from: at("chats"), to: at("work") },
      { from: at("chats", "a", "downloads"), to: at("elsewhere") },
    ];

    expect(remapMovedPath(at("chats", "a", "downloads", "x.pdf"), moves)).toBe(
      at("elsewhere", "x.pdf"),
    );
  });

  it("follows a folder moved twice", () => {
    const moves: MovedPath[] = [
      { from: at("old-root"), to: at("new-root") },
      { from: at("new-root", "chats"), to: at("work") },
    ];

    expect(remapMovedPath(at("old-root", "chats", "a", "x.md"), moves)).toBe(
      at("work", "a", "x.md"),
    );
  });

  it.each([
    ["a path under no move", ["outside", "x.md"]],
    ["a folder's sibling that shares its prefix", ["chats-old", "x.md"]],
  ])("leaves %s as it is", (_case, segments) => {
    const moves: MovedPath[] = [{ from: at("chats"), to: at("work") }];

    expect(remapMovedPath(at(...segments), moves)).toBe(at(...segments));
  });

  // A chat's old folder went two ways: its work to the work folder, then its
  // records into the workspace's `.instrument/`.
  describe("a folder whose entries went to two places", () => {
    const moves = (): MovedPath[] => [
      { from: at("chats"), to: at("work") },
      { from: at("chats"), to: at(".instrument", "chats") },
    ];

    it.each([
      [
        "what a chat was sent, kept with its records",
        ["chats", "a", "attachments", "cat.png"],
        [".instrument", "chats", "a", "attachments", "cat.png"],
      ],
      [
        "what it made, moved with its work",
        ["chats", "a", "work", "report.md"],
        ["work", "a", "work", "report.md"],
      ],
    ])("finds %s where it is", (_case, stored, now) => {
      touch(...now);

      expect(remapMovedPath(at(...stored), moves())).toBe(at(...now));
    });

    it("answers with the first move's place when neither holds the path", () => {
      expect(remapMovedPath(at("chats", "a", "gone.md"), moves())).toBe(
        at("work", "a", "gone.md"),
      );
    });

    it("follows the second place through a later move of its own", () => {
      const now = touch("synced", "chats", "a", "attachments", "cat.png");

      expect(
        remapMovedPath(at("chats", "a", "attachments", "cat.png"), [
          ...moves(),
          { from: at(".instrument", "chats"), to: at("synced", "chats") },
        ]),
      ).toBe(now);
    });
  });

  it("names the folder a moved folder itself went to", () => {
    const moves: MovedPath[] = [{ from: at("chats"), to: at("work") }];

    expect(remapMovedPath(at("chats"), moves)).toBe(at("work"));
  });
});

describe("recordMovedPaths", () => {
  it("adds a move once, however often it is recorded", () => {
    const machineDir = at("machine");
    const move = { from: at("chats"), to: at("machine", "work") };

    recordMovedPaths(machineDir, [move]);
    recordMovedPaths(machineDir, [move]);

    expect(readMovedPaths(machineDir)).toEqual([move]);
    expect(
      JSON.parse(
        fs.readFileSync(path.join(machineDir, "moved-paths.json"), "utf8"),
      ),
    ).toEqual({ moves: [move] });
  });

  it("keeps the moves recorded before and reads back each one added", () => {
    const machineDir = at("machine");
    const first = { from: at("chats"), to: at("machine", "work") };
    const second = { from: at("old-root"), to: at("new-root") };

    recordMovedPaths(machineDir, [first]);
    recordMovedPaths(machineDir, [second]);

    expect(readMovedPaths(machineDir)).toEqual([first, second]);
  });

  it("reads no moves where none were recorded, or the record is not one", () => {
    const machineDir = at("machine");

    expect(readMovedPaths(machineDir)).toEqual([]);

    touch("machine", "moved-paths.json");
    fs.writeFileSync(path.join(machineDir, "moved-paths.json"), "{ not json");

    expect(readMovedPaths(machineDir)).toEqual([]);
  });
});
