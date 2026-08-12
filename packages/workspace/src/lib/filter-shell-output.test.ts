import os from "node:os";
import { beforeEach, describe, expect, it } from "vitest";

import { type TaskDir, TaskDirSchema } from "../schemas/paths";
import {
  filterShellOutput,
  redactHostPaths,
  redactTaskDir,
  shouldFilterDebuggerMessage,
} from "./filter-shell-output";

describe("filterShellOutput", () => {
  const dir = TaskDirSchema.parse("/absolute/path/to/my task");

  it("replaces absolute path with relative path", () => {
    const output = `$ pnpm lint

> instrument-template-basic@0.0.0 lint ${dir}
> eslint .


${dir}/scripts/interleave-demo.ts
   6:1  warning  Unexpected console statement  no-console

✖ 1 problems (0 errors, 1 warnings)`;

    const result = filterShellOutput(output, dir);

    expect(result).toMatchInlineSnapshot(`
      "$ pnpm lint

      > instrument-template-basic@0.0.0 lint .
      > eslint .


      ./scripts/interleave-demo.ts
         6:1  warning  Unexpected console statement  no-console

      ✖ 1 problems (0 errors, 1 warnings)"
    `);
  });

  it("replaces multiple occurrences of absolute path", () => {
    const output = `${dir}/file1.ts
${dir}/file2.ts
${dir}/file3.ts`;

    const result = filterShellOutput(output, dir);

    expect(result).toMatchInlineSnapshot(`
      "./file1.ts
      ./file2.ts
      ./file3.ts"
    `);
  });

  it("normalizes backslash paths in output", () => {
    const output = String.raw`Converted -> output\smiley.png
${dir}\output\rainbow.pdf`;

    const result = filterShellOutput(output, dir);

    expect(result).toMatchInlineSnapshot(`
      "Converted -> output/smiley.png
      ./output/rainbow.pdf"
    `);
  });

  it("still redacts host paths when the separator rewrite is off, but leaves other backslashes alone", () => {
    const output = String.raw`${dir}\output\r.pdf matched /a\d+/ and "x\n"`;

    const result = filterShellOutput(output, dir, { rewriteSeparators: false });

    expect(result).toMatchInlineSnapshot(
      `".\\output\\r.pdf matched /a\\d+/ and "x\\n""`,
    );
  });

  it("redacts app dir variants case-insensitively", () => {
    const output = `${dir.toUpperCase()}/output/file.png`;

    const result = filterShellOutput(output, dir);

    expect(result).toMatchInlineSnapshot(`"./output/file.png"`);
  });

  it("redacts string-escaped Windows task dir paths from printed error objects", () => {
    // Cast: TaskDirSchema rejects win32 absolute paths when the test runs on
    // a posix host, but production Windows builds produce exactly this shape.
    const windowsDir =
      String.raw`C:\Users\user\AppData\Roaming\Instrument\workspace\tasks\my-task` as TaskDir;
    // Node prints error objects with escaped backslashes, e.g.
    // `path: 'C:\\Users\\...'`; that spelling must not leak the host dir.
    const output = String.raw`Error: ENOENT: no such file or directory {
  path: 'C:\\Users\\user\\AppData\\Roaming\\Instrument\\workspace\\tasks\\my-task\\attachments\\chart.svg'
}`;

    const result = filterShellOutput(output, windowsDir);

    expect(result).not.toContain(String.raw`C://Users`);
    expect(result).toMatchInlineSnapshot(`
      "Error: ENOENT: no such file or directory {
        path: './/attachments//chart.svg'
      }"
    `);
  });

  it("redacts the host home dir from runner/cache paths", () => {
    const home = os.homedir();
    const output = `Error: ENOENT
    at async file://${home}/Library/Caches/pnpm/dlx/abc123/jiti-cli.mjs:31:1`;

    const result = filterShellOutput(output, dir);

    expect(result).toBe(`Error: ENOENT
    at async file://~/Library/Caches/pnpm/dlx/abc123/jiti-cli.mjs:31:1`);
  });

  it("handles output without absolute path", () => {
    const output = `$ pnpm test

> test passed

✓ All tests passed`;

    const result = filterShellOutput(output, dir);

    expect(result).toMatchInlineSnapshot(`
      "$ pnpm test

      > test passed

      ✓ All tests passed"
    `);
  });

  it("handles empty output", () => {
    const result = filterShellOutput("", dir);

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
    expect(filterShellOutput(output, dir)).toBe(expected);
  });

  it.each([
    { output: "https://github.com/o/r.git" },
    { output: "Cloning into 'r'... see https://example.com/help@2x.png" },
  ])("leaves $output without userinfo untouched", ({ output }) => {
    expect(filterShellOutput(output, dir)).toBe(output);
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

    const result = filterShellOutput(output, dir);
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

describe("redactHostPaths", () => {
  const dir = TaskDirSchema.parse("/absolute/path/to/my task");

  it("collapses the task dir to '.' and the home dir to '~'", () => {
    const home = os.homedir();
    const text = `attachments: ${dir}/attachments\ncache: ${home}/Library/Caches/pnpm`;

    expect(redactHostPaths(text, dir)).toBe(
      "attachments: ./attachments\ncache: ~/Library/Caches/pnpm",
    );
  });

  it("redacts a /var task dir written in its /private firmlink spelling", () => {
    // A script that calls Path(...).resolve() canonicalizes /var -> /private/var.
    const varDir = TaskDirSchema.parse("/var/folders/dj/abc/T/tasks/my-task");
    const text =
      "Wrote report to /private/var/folders/dj/abc/T/tasks/my-task/output/r.txt";

    expect(redactHostPaths(text, varDir)).toBe(
      "Wrote report to ./output/r.txt",
    );
  });

  it("touches only host paths: leaves backslashes and URL credentials alone", () => {
    const text = String.raw`re=/a\b/ and https://user:tok@example.com`;

    expect(redactHostPaths(text, dir)).toBe(text);
  });
});

describe("redactTaskDir", () => {
  const dir = TaskDirSchema.parse("/absolute/path/to/my task");

  it("collapses the task dir but leaves an unrelated home path (file-content scope)", () => {
    const home = os.homedir();
    const text = `in: ${dir}/attachments  home: ${home}/elsewhere`;

    const result = redactTaskDir(text, dir);

    expect(result).toContain("in: ./attachments");
    expect(result).toContain(`${home}/elsewhere`);
    expect(result).not.toContain(dir);
  });

  it("handles the /private firmlink spelling of the task dir", () => {
    const varDir = TaskDirSchema.parse("/var/folders/dj/abc/T/tasks/my-task");

    expect(
      redactTaskDir(
        "wrote /private/var/folders/dj/abc/T/tasks/my-task/out",
        varDir,
      ),
    ).toBe("wrote ./out");
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
