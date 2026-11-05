import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { withFoldersPastClosedOnes } from "./rg";

let home: string;
let instrument: string;
let documents: string;

beforeAll(async () => {
  home = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "rg-past-closed-")),
  );
  documents = path.join(home, "Documents");
  instrument = path.join(documents, "Instrument");
  await fs.mkdir(instrument, { recursive: true });
  await fs.mkdir(path.join(home, "code"));
  await fs.writeFile(path.join(home, "notes.txt"), "needle\n");
});

afterAll(async () => {
  await fs.rm(home, { force: true, recursive: true });
});

function searched(
  args: string[],
  {
    closed = true,
    cwd = home,
    readsStdin = false,
  }: { closed?: boolean; cwd?: string; readsStdin?: boolean } = {},
) {
  return withFoldersPastClosedOnes(args, {
    folders: [home, instrument],
    hostCwd: cwd,
    isClosed: (hostPath) => closed && hostPath === documents,
    readsStdin,
  });
}

describe("a search that walks from above a closed folder", () => {
  it.each([
    [["-il", "landlord", "."]],
    [["x", ".", "-g", "*.ts"]],
    [["-e", "x", "."]],
    [["x", "--", "."]],
    [["x", "notes.txt", "."]],
  ])("also searches the folder past it: %j", (args) => {
    expect(searched(args)).toEqual([...args, instrument]);
  });

  it.each([
    [["-il", "landlord"]],
    [["-A", "3", "x"]],
    [["-e", "x"]],
    [["--files"]],
    [["--files", "-g", "*roof*"]],
  ])(
    "keeps the walk from where it stands when it names no path: %j",
    (args) => {
      expect(searched(args)).toEqual([...args, ".", instrument]);
    },
  );
});

describe("a search left as it is", () => {
  it.each([
    ["a plain file", ["x", "notes.txt"]],
    ["a plain file after a flag's value", ["-A", "3", "x", "notes.txt"]],
    ["a folder with nothing closed in it", ["x", "code"]],
    ["a pattern that names a folder", ["code"]],
    ["a pattern that names the folder it stands in", ["."]],
    ["a lone folder that may be the pattern", ["--files", "."]],
    ["a flag's value alone on disk", ["-g", ".", "x"]],
  ])("names %s", (_, args) => {
    expect(searched(args)).toEqual(args);
  });

  it("reads piped input, with no path named", () => {
    expect(searched(["x"], { readsStdin: true })).toEqual(["x"]);
    expect(searched(["-A", "3", "x"], { readsStdin: true })).toEqual([
      "-A",
      "3",
      "x",
    ]);
  });

  it("stands inside the folder already", () => {
    expect(searched(["x", "."], { cwd: instrument })).toEqual(["x", "."]);
    expect(searched(["x"], { cwd: instrument })).toEqual(["x"]);
  });

  it("gets there anyway, with nothing closed", () => {
    expect(searched(["x", "."], { closed: false })).toEqual(["x", "."]);
    expect(searched(["x"], { closed: false })).toEqual(["x"]);
  });
});

describe("a word that only looks like a path", () => {
  it("replaces the walk when a flag's value after the pattern names a folder above the closed one", () => {
    expect(searched(["x", "-g", "."])).toEqual(["x", "-g", ".", instrument]);
  });

  it("adds a search and keeps the path it names, when a flag's value is a folder above the closed one", () => {
    expect(searched(["-g", ".", "x", "code"])).toEqual([
      "-g",
      ".",
      "x",
      "code",
      instrument,
    ]);
  });
});
