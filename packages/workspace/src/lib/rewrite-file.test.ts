import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { rewriteFileSync } from "./rewrite-file";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "rewrite-file-"));
});

afterEach(() => {
  fs.rmSync(dir, { force: true, recursive: true });
});

describe("rewriteFileSync", () => {
  it("builds the file from what it holds, and leaves no temp file", () => {
    const file = path.join(dir, "nested", "NOTE.md");
    rewriteFileSync(file, (current) => `${current ?? "none"}|first`);
    rewriteFileSync(file, (current) => `${current ?? "none"}|second`);

    expect(fs.readFileSync(file, "utf8")).toBe("none|first|second");
    expect(fs.readdirSync(path.dirname(file))).toEqual(["NOTE.md"]);
  });

  it("never writes through a link left at its temp name", () => {
    const file = path.join(dir, "TOPIC.md");
    const elsewhere = path.join(dir, "elsewhere");
    fs.writeFileSync(elsewhere, "kept");
    fs.symlinkSync(
      elsewhere,
      path.join(dir, `.~TOPIC.md.${process.pid.toString()}.tmp`),
    );

    rewriteFileSync(file, () => "written");

    expect(fs.readFileSync(elsewhere, "utf8")).toBe("kept");
    expect(fs.lstatSync(file).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(file, "utf8")).toBe("written");
  });

  it("builds again from the newer text when the file changes under it", () => {
    const file = path.join(dir, "TOPIC.md");
    fs.writeFileSync(file, "color: red\nold body");
    const seen: (string | undefined)[] = [];

    rewriteFileSync(file, (current) => {
      seen.push(current);
      if (seen.length === 1) {
        // Someone else saves while this write is being built.
        fs.writeFileSync(file, "color: red\nbody edited meanwhile");
      }
      return (current ?? "").replace("red", "blue");
    });

    expect(seen).toEqual([
      "color: red\nold body",
      "color: red\nbody edited meanwhile",
    ]);
    expect(fs.readFileSync(file, "utf8")).toBe(
      "color: blue\nbody edited meanwhile",
    );
  });

  it("writes its last build when the file keeps changing", () => {
    const file = path.join(dir, "busy.md");
    let builds = 0;

    rewriteFileSync(file, () => {
      builds += 1;
      fs.writeFileSync(file, `someone else ${builds.toString()}`);
      return `mine ${builds.toString()}`;
    });

    expect(builds).toBe(3);
    expect(fs.readFileSync(file, "utf8")).toBe("mine 3");
  });

  it("leaves the file as it was when building the write throws", () => {
    const file = path.join(dir, "kept.md");
    fs.writeFileSync(file, "kept");

    expect(() =>
      rewriteFileSync(file, () => {
        throw new Error("no");
      }),
    ).toThrow("no");
    expect(fs.readdirSync(dir)).toEqual(["kept.md"]);
    expect(fs.readFileSync(file, "utf8")).toBe("kept");
  });
});
