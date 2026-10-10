import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { execa } from "execa";
import { describe, expect, it } from "vitest";

import {
  credentialPlaces,
  deniedPlaceIn,
  deniedPlaceNote,
  seatbeltAvailable,
  seatbeltProfile,
  wrapNativeCommand,
} from "./native-sandbox";

describe("seatbeltProfile", () => {
  it("allows by default and denies each place, quoted", () => {
    expect(seatbeltProfile(["/nope/a", '/nope/with "quote"']))
      .toMatchInlineSnapshot(`
      "(version 1)
      (allow default)
      (deny file-read* file-write* (subpath "/nope/a"))
      (deny file-read* file-write* (subpath "/nope/with \\"quote\\""))"
    `);
  });
});

describe("deniedPlaceIn", () => {
  const denied = ["/Users/someone/.ssh", "/Users/someone/.aws"];

  it.each([
    ["cat: /Users/someone/.ssh/id_ed25519: Operation not permitted", denied[0]],
    [
      "PermissionError: [Errno 1] Operation not permitted: '/Users/someone/.aws/credentials'",
      denied[1],
    ],
    ["cat: /Users/someone/notes.txt: Operation not permitted", undefined],
    ["/Users/someone/.ssh/config: No such file or directory", undefined],
  ])("%s", (output, expected) => {
    expect(deniedPlaceIn(output, denied)).toBe(expected);
  });

  it("names the place from the home folder", () => {
    expect(deniedPlaceNote("/Users/someone/.ssh", "/Users/someone")).toMatch(
      /^~\/\.ssh is kept out of reach/,
    );
  });
});

describe.runIf(seatbeltAvailable())("a wrapped command on this Mac", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "native-sandbox-"));
  const secret = path.join(root, "secret");
  mkdirSync(secret);
  writeFileSync(path.join(secret, "key"), "s");
  writeFileSync(path.join(root, "open"), "o");

  async function run(file: string, args: string[]) {
    const spawned = wrapNativeCommand(file, args, [secret]);
    expect(spawned.sandboxed).toBe(true);
    return execa(spawned.file, spawned.args, { reject: false });
  }

  it("reads outside the denied place", async () => {
    const result = await run("/bin/cat", [path.join(root, "open")]);
    expect(result.stdout).toBe("o");
  });

  it.each([
    ["/bin/cat", [path.join(secret, "key")]],
    ["/bin/ls", [secret]],
    ["/bin/sh", ["-c", `echo x > ${path.join(secret, "new")}`]],
  ])("refuses %s inside it", async (file, args) => {
    const result = await run(file, args);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Operation not permitted");
  });

  it("holds a node child the command starts", async () => {
    const result = await run(process.execPath, [
      "-e",
      `require("child_process").execFileSync("/bin/cat", [${JSON.stringify(path.join(secret, "key"))}], { stdio: "inherit" })`,
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Operation not permitted");
  });
});

it("lists credential places inside the home folder", () => {
  expect(credentialPlaces("/h").every((place) => place.startsWith("/h/"))).toBe(
    true,
  );
});
