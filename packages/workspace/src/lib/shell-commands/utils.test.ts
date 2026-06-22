import { InMemoryFs } from "just-bash";
import { describe, expect, it, vi } from "vitest";

import { TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfig } from "../../test/helpers/mock-task-config";
import { taskDir } from "../app-dir-utils";
import { getWorkspaceConfig } from "../workspace-config";
import { extractFileAndScriptArgs, parseScriptRunnerArgs } from "./utils";

const taskId = createMockTaskConfig(TaskIdSchema.parse("test"));
const dir = taskDir(taskId);
const fs = new InMemoryFs();

function resolvePath(cwd: string) {
  return (p: string) => fs.resolvePath(cwd, p);
}

describe("extractFileAndScriptArgs", () => {
  it("returns undefined when no positionals", () => {
    const result = extractFileAndScriptArgs(
      [],
      [],
      taskId,
      dir,
      resolvePath("/"),
    );
    expect(result).toBeUndefined();
  });

  describe("filePath resolution", () => {
    it.each([
      {
        cwd: "/",
        expected: "scripts/run.ts",
        input: "scripts/run.ts",
        label: "simple relative path from root cwd",
      },
      {
        cwd: "/",
        expected: "scripts/run.ts",
        input: "./scripts/run.ts",
        label: "dot-prefixed relative path from root cwd",
      },
      {
        cwd: "/",
        expected: "scripts/run.ts",
        input: "/scripts/run.ts",
        label: "virtual absolute path from root cwd",
      },
      {
        cwd: "/",
        expected: "etc/passwd",
        input: "../../../etc/passwd",
        label: "dot-dot traversal clamped to dir from root cwd",
      },
      {
        cwd: "/skills/sharp-images",
        expected: "scripts/resize.ts",
        input: "scripts/resize.ts",
        label: "simple relative path from nested cwd",
      },
      {
        cwd: "/skills/sharp-images",
        expected: "scripts/resize.ts",
        input: "/skills/sharp-images/scripts/resize.ts",
        label: "virtual absolute path from nested cwd resolves correctly",
      },
      {
        cwd: "/skills/sharp-images",
        expected: "../../output/image.png",
        input: "../../output/image.png",
        label: "dot-dot traversal from nested cwd reaches project root",
      },
      {
        cwd: "/skills/sharp-images",
        expected: "../../output/image.png",
        input: "/output/image.png",
        label: "virtual absolute root-level path from nested cwd",
      },
      {
        cwd: "/skills/sharp-images",
        expected: "../../etc/passwd",
        input: "../../../../../../../../etc/passwd",
        label: "deep dot-dot traversal clamped to dir",
      },
    ])("$label", ({ cwd, expected, input }) => {
      const appCwd = `${dir}${cwd === "/" ? "" : cwd}`;
      const result = extractFileAndScriptArgs(
        [input],
        [input],
        taskId,
        appCwd,
        resolvePath(cwd),
      );
      expect(result).toBeDefined();
      expect(result?.filePath).toBe(expected);
      expect(result?.filePath).not.toContain(dir);
    });
  });

  describe("scriptArgs resolution", () => {
    it.each([
      {
        cwd: "/",
        expected: ["user-provided/file.txt"],
        label: "path-like args with ./ prefix are resolved",
        scriptArgs: ["./user-provided/file.txt"],
      },
      {
        cwd: "/",
        expected: ["user-provided/file.txt"],
        label: "virtual absolute path args are resolved",
        scriptArgs: ["/user-provided/file.txt"],
      },
      {
        cwd: "/skills/sharp-images",
        expected: ["../../output/image.png"],
        label: "dot-dot traversal args are resolved",
        scriptArgs: ["../../output/image.png"],
      },
      {
        cwd: "/",
        expected: ["--width", "800", "--fit", "cover"],
        label: "flag values without path characters are left as-is",
        scriptArgs: ["--width", "800", "--fit", "cover"],
      },
      {
        cwd: "/",
        expected: ["--output", "output/result.png", "--quality", "80"],
        label: "flag values mixed with path args",
        scriptArgs: ["--output", "./output/result.png", "--quality", "80"],
      },
      {
        cwd: "/",
        expected: ["--output", "output/result.png"],
        label: "backslash path args are normalized and resolved",
        scriptArgs: ["--output", ".\\output\\result.png"],
      },
      {
        cwd: "/",
        expected: ["output/result.png"],
        label: "bare Windows-style relative path args are normalized",
        scriptArgs: ["output\\result.png"],
      },
      {
        cwd: "/",
        expected: ["C:/Users/user/Downloads/smiley.svg"],
        label: "Windows drive paths are treated as sandbox-relative paths",
        scriptArgs: ["C:\\Users\\user\\Downloads\\smiley.svg"],
      },
      {
        cwd: "/skills/sharp-images",
        expected: ["../../output/result.png"],
        label:
          "virtual absolute path from nested cwd becomes correct relative path",
        scriptArgs: ["/output/result.png"],
      },
    ])("$label", ({ cwd, expected, scriptArgs }) => {
      const file = "script.ts";
      const args = [file, ...scriptArgs];
      const appCwd = `${dir}${cwd === "/" ? "" : cwd}`;
      const result = extractFileAndScriptArgs(
        [file],
        args,
        taskId,
        appCwd,
        resolvePath(cwd),
      );
      expect(result).toBeDefined();
      expect(result?.scriptArgs).toEqual(expected);
      for (const arg of result?.scriptArgs ?? []) {
        expect(arg).not.toContain(dir);
      }
    });
  });
});

const KNOWN_OPTIONS = { v: { type: "boolean" } } as const;

describe("parseScriptRunnerArgs", () => {
  it("does not report unknown options that appear after the script file", () => {
    const captureException = vi.spyOn(getWorkspaceConfig(), "captureException");

    parseScriptRunnerArgs(
      "tsx",
      ["scripts/remove-background.ts", "--output", "out.png"],
      KNOWN_OPTIONS,
    );

    expect(captureException).not.toHaveBeenCalled();
    captureException.mockRestore();
  });

  it("reports unknown options that appear before the script file", () => {
    const captureException = vi.spyOn(getWorkspaceConfig(), "captureException");

    parseScriptRunnerArgs(
      "tsx",
      ["--unknown-flag", "scripts/run.ts"],
      KNOWN_OPTIONS,
    );

    expect(captureException).toHaveBeenCalledOnce();
    expect(captureException.mock.calls[0]?.[0]).toMatchInlineSnapshot(
      `[Error: [tsx] Unrecognized options ignored: --unknown-flag]`,
    );
    captureException.mockRestore();
  });
});
