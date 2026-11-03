import { describe, expect, it } from "vitest";

import {
  filterShellOutput,
  shellSpelledSlashedPaths,
} from "./filter-shell-output";

describe("filterShellOutput", () => {
  it("respells drive paths and leaves every other backslash", () => {
    const output = String.raw`Converted -> C:\work\output\rainbow.pdf
saved D:/photos/a.png and E:\
a\b\c regex \d+\s {"x":"line\nline"} output\smiley.png`;

    const result = filterShellOutput(output, { rewriteSeparators: true });

    expect(result).toBe(String.raw`Converted -> /c/work/output/rainbow.pdf
saved /d/photos/a.png and /e
a\b\c regex \d+\s {"x":"line\nline"} output\smiley.png`);
  });

  it("respells folder names with spaces, PATH lists and escaped paths", () => {
    const output = String.raw`C:\Program Files\Oculus\a.dll was loaded
PATH=C:\a;C:\Program Files\b;D:\c
{"exe":"C:\\Users\\sam\\node.exe"}`;

    expect(filterShellOutput(output, { rewriteSeparators: true }))
      .toBe(String.raw`/c/Program Files/Oculus/a.dll was loaded
PATH=/c/a;/c/Program Files/b;/d/c
{"exe":"/c/Users/sam/node.exe"}`);
  });

  it("leaves backslashes alone when the separator rewrite is off", () => {
    const output = String.raw`out\r.pdf matched /a\d+/ and {"body":"line\nline"}`;

    expect(filterShellOutput(output, { rewriteSeparators: false })).toBe(
      output,
    );
  });

  it.each([
    {
      expected: "https://***@github.com/o/r.git",
      output: "https://ghp_secretToken@github.com/o/r.git",
    },
    {
      expected: "https://***@github.com/o/r.git",
      output: "https://user:ghp_secretToken@github.com/o/r.git",
    },
    {
      // A token with no username, the usual spelling for a PAT in a remote.
      expected: "https://***@github.com/o/r.git",
      output: "https://:ghp_secretToken@github.com/o/r.git",
    },
    {
      expected: "protocol=https\nusername=***\npassword=***",
      output: "protocol=https\nusername=victim\npassword=ghp_secretToken",
    },
    {
      // Glued to the text before it, which is how a wrapped or concatenated
      // line arrives. The scheme has to be matchable from inside a token.
      expected: "remote:https://***@github.com/o/r.git",
      output: "remote:https://user:ghp_secretToken@github.com/o/r.git",
    },
    {
      expected: `${"a".repeat(50)}https://***@github.com/o/r.git`,
      output: `${"a".repeat(50)}https://user:ghp_secretToken@github.com/o/r.git`,
    },
  ])("redacts credentials in $output", ({ expected, output }) => {
    expect(filterShellOutput(output)).toBe(expected);
  });

  it.each([
    { output: "https://github.com/o/r.git" },
    { output: "Cloning into 'r'... see https://example.com/help@2x.png" },
    { output: "✓ All tests passed\n" },
  ])("leaves $output without credentials untouched", ({ output }) => {
    expect(filterShellOutput(output)).toBe(output);
  });

  it("drops the debugger's lines and keeps the command's own newlines", () => {
    const output =
      "a\nDebugger attached.\nb\nWaiting for the debugger to disconnect...\n";

    expect(filterShellOutput(output)).toBe("a\nb\n");
  });
});

describe("shellSpelledSlashedPaths", () => {
  it("respells the drive on a path printed with slashes", () => {
    const output = `C:/Users/sam/Docs/note.md:NEEDLE here
D:/photos/a.png
C:/`;

    expect(shellSpelledSlashedPaths(output, "win32"))
      .toBe(`/c/Users/sam/Docs/note.md:NEEDLE here
/d/photos/a.png
/c`);
  });

  it("leaves a backslash in a line quoted from a file", () => {
    const output = String.raw`C:/work/escapes.ts:1:const re = /a\d+/, nl = "x\n", p = "C:\win\x";`;

    expect(shellSpelledSlashedPaths(output, "win32")).toBe(
      String.raw`/c/work/escapes.ts:1:const re = /a\d+/, nl = "x\n", p = "C:\win\x";`,
    );
  });

  it("respells the path in a --json record and leaves its escapes", () => {
    const output = String.raw`{"type":"match","data":{"path":{"text":"C:/work/a.ts"},"lines":{"text":"re: /a\\d+/\n"}}}`;

    expect(shellSpelledSlashedPaths(output, "win32")).toBe(
      String.raw`{"type":"match","data":{"path":{"text":"/c/work/a.ts"},"lines":{"text":"re: /a\\d+/\n"}}}`,
    );
  });

  it("leaves output as it came where a tool prints no drive", () => {
    const output = "/Users/sam/Docs/note.md:NEEDLE here\n";

    expect(shellSpelledSlashedPaths(output, "darwin")).toBe(output);
    expect(shellSpelledSlashedPaths("C:/Users/sam/a.md", "darwin")).toBe(
      "C:/Users/sam/a.md",
    );
  });
});
