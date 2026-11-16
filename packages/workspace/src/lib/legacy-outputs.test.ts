import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { moveLegacyOutputsToFiles } from "./legacy-outputs";
import { legacyTaskRecordsDir } from "./migrate-legacy-tasks";
import { movedOutputOf } from "./moved-outputs";
import { workspaceLayout } from "./workspace-layout";

let base: string;
let rootDir: string;
let machineDir: string;
let workFoldersDir: string;
let filesDir: string;

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "outputs-")));
  rootDir = path.join(base, "workspace");
  machineDir = path.join(base, "machine");
  workFoldersDir = path.join(base, "work");
  filesDir = path.join(base, "Files");
});

afterEach(() => {
  fs.rmSync(base, { force: true, recursive: true });
});

function write(file: string, contents = "") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

/** A chat made from a 1.x task called `name`, with `files` in its work folder. */
function convertedChat(
  chatId: string,
  name: string | undefined,
  files: Record<string, string>,
) {
  fs.mkdirSync(path.join(workspaceLayout(rootDir).chatsDir, chatId), {
    recursive: true,
  });
  if (name !== undefined) {
    write(
      path.join(legacyTaskRecordsDir(rootDir, chatId), "settings.json"),
      JSON.stringify({ name }),
    );
  }
  for (const [file, contents] of Object.entries(files)) {
    write(path.join(workFoldersDir, chatId, file), contents);
  }
}

function listed(dir: string): string[] {
  return fs.readdirSync(dir, { recursive: true, encoding: "utf8" }).toSorted();
}

function move() {
  return moveLegacyOutputsToFiles({
    filesDir,
    machineDir,
    rootDir,
    workFoldersDir,
  });
}

describe("moveLegacyOutputsToFiles", () => {
  it("moves a 1.x task's output into a Files folder named for its chat", () => {
    convertedChat("squares", "Red and blue squares PDF", {
      "output/charts/one.png": "1",
      "output/squares.pdf": "pdf",
      "work/make.py": "py",
    });

    expect(move().failed).toBe(0);

    expect(listed(filesDir)).toEqual([
      "Red and blue squares PDF",
      "Red and blue squares PDF/charts",
      "Red and blue squares PDF/charts/one.png",
      "Red and blue squares PDF/squares.pdf",
    ]);
    expect(listed(path.join(workFoldersDir, "squares"))).toEqual([
      "work",
      "work/make.py",
    ]);
    for (const relative of ["output/squares.pdf", "output/charts/one.png"]) {
      expect(movedOutputOf({ chatId: "squares", machineDir, relative })).toBe(
        path.join(
          filesDir,
          "Red and blue squares PDF",
          relative.slice("output/".length),
        ),
      );
    }
    expect(
      movedOutputOf({
        chatId: "squares",
        machineDir,
        relative: "work/make.py",
      }),
    ).toBeUndefined();
  });

  it("joins a folder already there, numbering a name it holds", () => {
    write(path.join(filesDir, "Report", "summary.md"), "mine");
    convertedChat("report", "Report", {
      "output/data.csv": "csv",
      "output/summary.md": "theirs",
    });

    move();

    expect(listed(path.join(filesDir, "Report"))).toEqual([
      "data.csv",
      "summary-2.md",
      "summary.md",
    ]);
    expect(
      fs.readFileSync(path.join(filesDir, "Report", "summary.md"), "utf8"),
    ).toBe("mine");
    expect(
      movedOutputOf({
        chatId: "report",
        machineDir,
        relative: "output/summary.md",
      }),
    ).toBe(path.join(filesDir, "Report", "summary-2.md"));
  });

  it("makes no folder for a task that handed nothing over", () => {
    convertedChat("empty", "Nothing made", { "work/notes.txt": "x" });
    fs.mkdirSync(path.join(workFoldersDir, "empty", "output"));

    move();

    expect(fs.existsSync(filesDir)).toBe(false);
    expect(listed(path.join(workFoldersDir, "empty"))).toEqual([
      "work",
      "work/notes.txt",
    ]);
  });

  it("leaves the output/ of a chat no 1.x task was made into", () => {
    convertedChat("native", undefined, { "output/mine.txt": "x" });

    move();

    expect(fs.existsSync(filesDir)).toBe(false);
    expect(listed(path.join(workFoldersDir, "native"))).toEqual([
      "output",
      "output/mine.txt",
    ]);
  });

  it("finds nothing more to move when run again", () => {
    convertedChat("squares", "Squares", { "output/squares.pdf": "pdf" });
    move();

    expect(move()).toEqual({ done: [], failed: 0 });
    expect(listed(filesDir)).toEqual(["Squares", "Squares/squares.pdf"]);
  });
});
