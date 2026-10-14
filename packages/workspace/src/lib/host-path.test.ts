import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  realHostPath,
  withoutShellEscapes,
  withoutTrailingDots,
} from "./host-path";

describe("withoutTrailingDots", () => {
  it.each([
    ["C:\\ws\\.instrument.\\chats", "C:\\ws\\.instrument\\chats"],
    ["C:\\ws\\.instrument \\chats", "C:\\ws\\.instrument\\chats"],
    ["C:\\ws\\.instrument. .", "C:\\ws\\.instrument"],
    ["C:/ws/.instrument../a.db", "C:/ws/.instrument/a.db"],
    ["C:\\ws\\..\\x", "C:\\ws\\..\\x"],
    ["C:\\ws\\...\\x", "C:\\ws\\...\\x"],
    ["C:\\ws\\a.b\\x", "C:\\ws\\a.b\\x"],
    ["C:\\ws\\.instrument", "C:\\ws\\.instrument"],
  ])("reads %s as Windows opens it, %s", (given, opened) => {
    expect(withoutTrailingDots(given, "win32")).toBe(opened);
  });

  it("keeps the name as given elsewhere", () => {
    expect(withoutTrailingDots("/ws/.instrument./a", "darwin")).toBe(
      "/ws/.instrument./a",
    );
  });
});

describe("withoutShellEscapes", () => {
  it.each([
    [String.raw`/a/Instrument Preview \(x\)/b`, "/a/Instrument Preview (x)/b"],
    [String.raw`/a/App\ Support/\[y\]`, "/a/App Support/[y]"],
    [String.raw`/a/back\\slash`, String.raw`/a/back\slash`],
    ["/a/plain", "/a/plain"],
  ])("reads %s as %s", (given, unescaped) => {
    expect(withoutShellEscapes(given, "darwin")).toBe(unescaped);
  });

  it("keeps a Windows path's backslashes", () => {
    expect(withoutShellEscapes(String.raw`C:\ws\(x)`, "win32")).toBe(
      String.raw`C:\ws\(x)`,
    );
  });
});

describe("realHostPath", () => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "real-host-path-")),
  );
  const target = path.join(root, "a", "b");
  fs.mkdirSync(target, { recursive: true });
  fs.symlinkSync(target, path.join(root, "link"));

  afterAll(() => {
    fs.rmSync(root, { force: true, recursive: true });
  });

  it.each([
    ["a folder", target, target],
    ["a link", path.join(root, "link"), target],
    [
      "a file not made yet through a link",
      path.join(root, "link", "new", "x"),
      path.join(target, "new", "x"),
    ],
    ["a path with steps up", path.join(target, "..", "b"), target],
  ])("follows %s to where it is", (_case, given, real) => {
    expect(realHostPath(given)).toBe(real);
  });

  it.runIf(process.platform === "darwin")(
    "takes a Mac path off the Data volume",
    () => {
      expect(realHostPath(`/System/Volumes/Data${target}`)).toBe(target);
    },
  );
});
