import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { windowsCommandLine } from "../native-sandbox";
import { batchFileLaunch, programsOnPath } from "./path-program";

let tmpDir: string;
let first: string;
let second: string;

async function writeProgram(dir: string, name: string, mode: number) {
  await fs.writeFile(path.join(dir, name), "#!/bin/sh\n", { mode });
}

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "path-program-"));
  first = path.join(tmpDir, "first");
  second = path.join(tmpDir, "second");
  await fs.mkdir(first);
  await fs.mkdir(second);
  await writeProgram(first, "both", 0o755);
  await writeProgram(second, "both", 0o755);
  await writeProgram(first, "plain", 0o644);
  await writeProgram(second, "plain", 0o755);
  await fs.mkdir(path.join(first, "dir"));
});

afterAll(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe.skipIf(process.platform === "win32")("programsOnPath", () => {
  it.each([
    ["both", ["first", "second"]],
    // Not executable in the first folder, so the second's is the program.
    ["plain", ["second"]],
    ["dir", []],
    ["missing", []],
    ["", []],
    ["first/both", []],
  ])("%s is found in %j", async (name, folders) => {
    const found = await programsOnPath(name, {
      path: [first, "relative/bin", "", second].join(":"),
    });
    expect(found).toEqual(
      folders.map((folder) => path.join(tmpDir, folder, name)),
    );
  });
});

describe("programsOnPath on Windows", () => {
  const files = new Set([
    String.raw`C:\Tools\code.cmd`,
    String.raw`C:\Tools\rg.exe`,
    String.raw`C:\Windows\System32\rg.exe`,
    String.raw`C:\Tools\notes.txt`,
  ]);
  const lookup = (name: string, pathExt?: string) =>
    programsOnPath(name, {
      isProgram: (hostPath) => Promise.resolve(files.has(hostPath)),
      path: String.raw`C:\Tools;C:\Windows\System32`,
      pathExt,
      platform: "win32",
    });

  it.each([
    [
      "rg",
      [String.raw`C:\Tools\rg.exe`, String.raw`C:\Windows\System32\rg.exe`],
    ],
    ["code", [String.raw`C:\Tools\code.cmd`]],
    [
      "rg.exe",
      [String.raw`C:\Tools\rg.exe`, String.raw`C:\Windows\System32\rg.exe`],
    ],
    ["notes", []],
  ])("%s", async (name, expected) => {
    expect(await lookup(name, ".COM;.EXE;.BAT;.CMD")).toEqual(expected);
  });

  it("tries only what PATHEXT lists", async () => {
    expect(await lookup("code", ".EXE")).toEqual([]);
    expect(await lookup("notes", ".TXT")).toEqual([
      String.raw`C:\Tools\notes.txt`,
    ]);
  });
});

describe("batchFileLaunch", () => {
  const cmd = String.raw`C:\Windows\System32\cmd.exe`;
  const yarn = String.raw`C:\Program Files\nodejs\yarn.cmd`;

  it.each([
    [
      ["--version"],
      String.raw`/d /s /c ""C:\Program Files\nodejs\yarn.cmd" ^"--version^""`,
    ],
    [
      ["a&b", "x|y", "<in>", "50%", "^"],
      String.raw`/d /s /c ""C:\Program Files\nodejs\yarn.cmd" ^"a^&b^" ^"x^|y^" ^"^<in^>^" ^"50^%^" ^"^^^""`,
    ],
    [
      ['say "hi"', "a b", ""],
      String.raw`/d /s /c ""C:\Program Files\nodejs\yarn.cmd" ^"say \^"hi\^"^" ^"a b^" ^"^""`,
    ],
  ])("hands cmd.exe %j as one line", (args, line) => {
    const [file, fileArgs] = batchFileLaunch(cmd, yarn, args);
    expect(file).toBe(cmd);
    // Joined verbatim, as both Node and the MXC request join it.
    expect(windowsCommandLine(fileArgs, true)).toBe(line);
  });
});
