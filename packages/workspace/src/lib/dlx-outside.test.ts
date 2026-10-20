import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { dlxPlan, dlxProgram } from "./dlx-outside";

describe("dlxPlan", () => {
  it.each([
    [
      "a package run by its own name",
      ["cowsay@1.6.0", "hi"],
      { args: ["hi"], command: "cowsay", packages: ["cowsay@1.6.0"] },
    ],
    [
      "a scoped package",
      ["@scope/tool", "--flag"],
      { args: ["--flag"], command: "tool", packages: ["@scope/tool"] },
    ],
    [
      "a program named apart from its package",
      ["-p", "skills@latest", "--package=other", "skills", "add", "x"],
      {
        args: ["add", "x"],
        command: "skills",
        packages: ["skills@latest", "other"],
      },
    ],
  ])("reads %s", (_case, args, expected) => {
    expect(dlxPlan(args)).toMatchObject(expected);
  });

  it.each([
    ["an option of dlx's it does not read", ["-c", "echo hi"]],
    ["a package from a path", ["./tool.tgz"]],
    ["a package from git", ["github:owner/repo"]],
    ["nothing to run", ["-p", "skills"]],
  ])("leaves %s to pnpm dlx", (_case, args) => {
    expect(dlxPlan(args)).toBeUndefined();
  });

  it("installs one set of packages in one folder, in any order", () => {
    expect(dlxPlan(["-p", "a", "-p", "b", "a"])?.dir).toBe(
      dlxPlan(["-p", "b", "-p", "a", "a"])?.dir,
    );
  });
});

describe("dlxProgram", () => {
  function installed(bin: unknown) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dlx-program-"));
    const folder = path.join(dir, "node_modules", "@scope", "tool");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(
      path.join(folder, "package.json"),
      JSON.stringify({ bin, name: "@scope/tool" }),
    );
    return { dir, folder };
  }

  it("runs a package's one program, or the one named", () => {
    const { dir, folder } = installed({ other: "o.js", tool: "cli.js" });
    expect(
      dlxProgram({ args: [], command: "tool", dir, packages: ["@scope/tool"] }),
    ).toBe(path.join(folder, "cli.js"));

    const single = installed("bin/run.mjs");
    expect(
      dlxProgram({
        args: [],
        command: "tool",
        dir: single.dir,
        packages: ["@scope/tool@2"],
      }),
    ).toBe(path.join(single.folder, "bin", "run.mjs"));
  });

  it("finds nothing for a program the package does not have", () => {
    const { dir } = installed({ a: "a.js", b: "b.js" });
    expect(
      dlxProgram({ args: [], command: "tool", dir, packages: ["@scope/tool"] }),
    ).toBeUndefined();
  });
});
