import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { execa } from "execa";
import { describe, expect, it } from "vitest";

import {
  type NativeReach,
  refusalNote,
  refusedPathIn,
  bwrapAvailable,
  seatbeltAvailable,
  seatbeltProfile,
  wrapNativeCommand,
} from "./native-sandbox";
import { type Rule } from "./permissions/rules";

function reachOver(home: string, rules: Rule[]): NativeReach {
  return {
    readOnly: [],
    readWrite: [],
    rules: { home, rules, withoutAsking: false },
  };
}

describe("seatbeltProfile", () => {
  it("closes home to changes, then applies rules shallow to deep", () => {
    const profile = seatbeltProfile(
      reachOver("/nope/home", [
        { level: "allow", path: "/nope/home/Documents/Acme", source: "grant" },
        { level: "ask", path: "/nope/home/Documents", source: "place" },
        { dotEntries: true, level: "ask", path: "/nope/home", source: "place" },
        { level: "never", path: '/nope/home/with "quote"', source: "place" },
      ]),
    );
    expect(
      profile
        .split("\n")
        .filter(
          (line) =>
            !line.includes("/.cache") &&
            !line.includes("Library/") &&
            !/\/\.(npm|local|config|gitconfig)/.test(line),
        ),
    ).toMatchInlineSnapshot(`
      [
        "(version 1)",
        "(allow default)",
        "(deny file-write* (subpath "/nope/home"))",
        "(deny file-read* file-write* (subpath "/nope/home/Documents"))",
        "(deny file-read* file-write* (regex #"^/nope/home/\\.[^/]+(/|$)"))",
        "(deny file-read* file-write* (subpath "/nope/home/with \\"quote\\""))",
        "(allow file-read* file-write* (subpath "/nope/home/Documents/Acme"))",
        "(allow file-read-metadata (literal "/nope"))",
        "(allow file-read-metadata (literal "/nope/home"))",
        "(allow file-read-metadata (literal "/nope/home/Documents"))",
        "(allow file-read-metadata (literal "/nope/home/Library"))",
      ]
    `);
  });
});

describe("refusedPathIn", () => {
  const reach = reachOver("/Users/someone", [
    { level: "never", path: "/Users/someone/.ssh", source: "place" },
    { level: "ask", path: "/Users/someone/Documents", source: "place" },
  ]);

  it.each([
    ["cat: /Users/someone/.ssh/id_ed25519: Operation not permitted", "never"],
    [
      "PermissionError: [Errno 1] Operation not permitted: '/Users/someone/Documents/Acme/a.csv'",
      "ask",
    ],
    // bubblewrap leaves a closed folder empty, so its refusal reads as missing.
    ["cat: /Users/someone/.ssh/config: No such file or directory", "never"],
    ["cat: /Users/someone/notes.md: No such file or directory", undefined],
  ])("%s", (output, level) => {
    expect(refusedPathIn(output, reach)?.reach.level).toBe(level);
  });

  it("asks for the folder one level into the place", () => {
    const refused = refusedPathIn(
      "Operation not permitted: '/Users/someone/Documents/Acme/a.csv'",
      reach,
    );
    expect(
      refused && refusalNote(refused, "/Users/someone"),
    ).toMatchInlineSnapshot(
      `"~/Documents/Acme/a.csv needs the person's yes first. Ask for ~/Documents/Acme with request_folder, then run the command again."`,
    );
  });
});

describe.runIf(seatbeltAvailable())("a wrapped command on this Mac", () => {
  const home = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "native-sandbox-")),
  );
  const closed = path.join(home, "closed");
  const asks = path.join(home, "Documents");
  const granted = path.join(asks, "Acme");
  for (const dir of [closed, granted]) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path.join(closed, "key"), "s");
  writeFileSync(path.join(asks, "other.txt"), "o");
  writeFileSync(path.join(granted, "brief.md"), "b");
  writeFileSync(path.join(home, "notes.md"), "n");
  mkdirSync(path.join(home, ".hidden"));
  writeFileSync(path.join(home, ".hidden", "x"), "h");
  const reach = reachOver(home, [
    { level: "never", path: closed, source: "place" },
    { level: "ask", path: asks, source: "place" },
    { dotEntries: true, level: "ask", path: home, source: "place" },
    { level: "allow", path: granted, source: "grant" },
  ]);

  async function run(file: string, args: string[]) {
    const spawned = wrapNativeCommand(file, args, reach);
    expect(spawned.reach).toBeDefined();
    return execa(spawned.file, spawned.args, { reject: false });
  }

  it.each([
    ["reads a file nothing holds", ["cat", path.join(home, "notes.md")], 0],
    ["reads in a granted folder", ["cat", path.join(granted, "brief.md")], 0],
    [
      "writes in a granted folder",
      ["sh", "-c", `echo x > ${path.join(granted, "new")}`],
      0,
    ],
    ["refuses a closed folder", ["cat", path.join(closed, "key")], 1],
    ["refuses a place that asks", ["cat", path.join(asks, "other.txt")], 1],
    ["refuses a hidden folder", ["cat", path.join(home, ".hidden", "x")], 1],
    [
      "refuses a change nothing allows",
      ["sh", "-c", `echo x > ${path.join(home, "new")}`],
      1,
    ],
  ])("%s", async (_name, [command = "", ...args], exitCode) => {
    const result = await run(`/bin/${command}`, args);
    expect(result.exitCode === 0 ? 0 : 1).toBe(exitCode);
  });

  it("holds a node child the command starts", async () => {
    const result = await run(process.execPath, [
      "-e",
      `require("child_process").execFileSync("/bin/cat", [${JSON.stringify(path.join(closed, "key"))}], { stdio: "inherit" })`,
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Operation not permitted");
  });
});

describe.runIf(bwrapAvailable())("a wrapped command on this Linux", () => {
  const home = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "native-sandbox-")),
  );
  const closed = path.join(home, "closed");
  const asks = path.join(home, "Documents");
  const granted = path.join(asks, "Acme");
  for (const dir of [closed, granted]) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path.join(closed, "key"), "s");
  writeFileSync(path.join(asks, "other.txt"), "o");
  writeFileSync(path.join(granted, "brief.md"), "b");
  writeFileSync(path.join(home, "notes.md"), "n");
  mkdirSync(path.join(home, ".hidden"));
  writeFileSync(path.join(home, ".hidden", "x"), "h");
  const reach = reachOver(home, [
    { level: "never", path: closed, source: "place" },
    { level: "ask", path: asks, source: "place" },
    { dotEntries: true, level: "ask", path: home, source: "place" },
    { level: "allow", path: granted, source: "grant" },
  ]);

  it.each([
    ["reads a file nothing holds", `cat ${path.join(home, "notes.md")}`, 0],
    ["reads in a granted folder", `cat ${path.join(granted, "brief.md")}`, 0],
    ["writes in a granted folder", `echo x > ${path.join(granted, "new")}`, 0],
    ["refuses a closed folder", `cat ${path.join(closed, "key")}`, 1],
    ["refuses a place that asks", `cat ${path.join(asks, "other.txt")}`, 1],
    ["refuses a hidden folder", `cat ${path.join(home, ".hidden", "x")}`, 1],
    [
      "refuses a change nothing allows",
      `echo x > ${path.join(home, "new")}`,
      1,
    ],
  ])("%s", async (_name, script, exitCode) => {
    const spawned = wrapNativeCommand("/bin/sh", ["-c", script], reach);
    const result = await execa(spawned.file, spawned.args, { reject: false });
    expect(result.exitCode === 0 ? 0 : 1).toBe(exitCode);
  });
});
