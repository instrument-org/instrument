import { beforeEach, describe, expect, it } from "vitest";

import {
  filterShellOutput,
  shouldFilterDebuggerMessage,
} from "./filter-shell-output";

describe("filterShellOutput", () => {
  it("normalizes backslash paths in output", () => {
    const output = String.raw`Converted -> output\smiley.png
C:\work\output\rainbow.pdf`;

    const result = filterShellOutput(output, { rewriteSeparators: true });

    expect(result).toMatchInlineSnapshot(`
      "Converted -> output/smiley.png
      C:/work/output/rainbow.pdf"
    `);
  });

  it("leaves a script's own escape sequences alone on a posix host", () => {
    // The rewrite exists for paths a Windows-native tool prints. Where no such
    // tool can run, every backslash in output is content: JSON, a regex, a
    // LaTeX macro. Rewriting them made valid output look corrupted.
    const result = filterShellOutput(
      String.raw`{"body":"line\nline","re":"/a\d+/"}`,
    );

    expect(result).toMatchInlineSnapshot(
      `"{"body":"line\\nline","re":"/a\\d+/"}"`,
    );
  });

  it("leaves backslashes alone when the separator rewrite is off", () => {
    const output = String.raw`out\r.pdf matched /a\d+/ and "x\n"`;

    expect(filterShellOutput(output, { rewriteSeparators: false })).toBe(
      output,
    );
  });

  it("handles output without absolute path", () => {
    const output = `$ pnpm test

> test passed

✓ All tests passed`;

    const result = filterShellOutput(output);

    expect(result).toMatchInlineSnapshot(`
      "$ pnpm test

      > test passed

      ✓ All tests passed"
    `);
  });

  it("handles empty output", () => {
    const result = filterShellOutput("");

    expect(result).toMatchInlineSnapshot(`""`);
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
      expected: "origin\thttps://***@example.com/r (fetch)",
      output: "origin\thttps://x-access-token:secret@example.com/r (fetch)",
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
      expected: "-https://***@github.com/o/r.git",
      output: "-https://user:ghp_secretToken@github.com/o/r.git",
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
  ])("leaves $output without userinfo untouched", ({ output }) => {
    expect(filterShellOutput(output)).toBe(output);
  });

  it("filters debugger messages from output", () => {
    const output = `
    Error: Tool call execution failed for 'tool-bash': Command failed with exit code 1: pnpm dlx jiti scripts/test-06-dependencies.ts

    Debugger attached.
    Debugger attached.
    ✓ Test 6: Dependency Imports and Zod Validation
    ✓ Valid user parsed: { id: 1, email: 'user@example.com', age: 30, active: true }
    ✓ Caught validation errors:
    TypeError: Cannot read properties of undefined (reading 'forEach')
    Waiting for the debugger to disconnect...
    Waiting for the debugger to disconnect...`;

    const result = filterShellOutput(output);
    expect(result).toMatchInlineSnapshot(`
      "
          Error: Tool call execution failed for 'tool-bash': Command failed with exit code 1: pnpm dlx jiti scripts/test-06-dependencies.ts

          ✓ Test 6: Dependency Imports and Zod Validation
          ✓ Valid user parsed: { id: 1, email: 'user@example.com', age: 30, active: true }
          ✓ Caught validation errors:
          TypeError: Cannot read properties of undefined (reading 'forEach')
      "
    `);
  });
});
describe("shouldFilterDebuggerMessage", () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it("filters debugger attached message in development", () => {
    process.env.NODE_ENV = "development";
    expect(shouldFilterDebuggerMessage("Debugger attached.")).toBe(true);
  });

  it("filters waiting for debugger message in development", () => {
    process.env.NODE_ENV = "development";
    expect(
      shouldFilterDebuggerMessage("Waiting for the debugger to disconnect..."),
    ).toBe(true);
  });

  it("filters debugger messages in test environment", () => {
    process.env.NODE_ENV = "test";
    expect(shouldFilterDebuggerMessage("Debugger attached.")).toBe(true);
    expect(
      shouldFilterDebuggerMessage("Waiting for the debugger to disconnect..."),
    ).toBe(true);
  });

  it("does not filter debugger messages in production", () => {
    process.env.NODE_ENV = "production";
    expect(shouldFilterDebuggerMessage("Debugger attached.")).toBe(false);
    expect(
      shouldFilterDebuggerMessage("Waiting for the debugger to disconnect..."),
    ).toBe(false);
  });

  it("does not filter other messages", () => {
    process.env.NODE_ENV = "development";
    expect(shouldFilterDebuggerMessage("Some other message")).toBe(false);
  });
});
