import { InMemoryFs } from "just-bash";
import { describe, expect, it, vi } from "vitest";

import { TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfig } from "../../test/helpers/mock-task-config";
import { taskDir } from "../task-dir-utils";
import { getWorkspaceConfig } from "../workspace-config";
import {
  bridgeInlineCodePaths,
  extractFileAndScriptArgs,
  parseScriptRunnerArgs,
  resolvePathArgs,
  scriptFileVirtualPathError,
} from "./utils";

const taskId = createMockTaskConfig(TaskIdSchema.parse("test"));
const dir = taskDir(taskId);
const fs = new InMemoryFs();

function resolvePath(cwd: string) {
  return (p: string) => fs.resolvePath(cwd, p);
}

describe("resolvePathArgs native-binary bridge", () => {
  it("maps a /mnt path to a nonexistent task path, never the real folder", () => {
    const resolved = resolvePathArgs(["/mnt/Photos/clip.mov"], taskId, {
      cwd: "/task",
      fs,
    });
    // A native binary can never be handed the real read-only attached-folder
    // host path: only the bash and file-tool layers map /mnt to the real folder
    // (and only for reads). Here it stays inside the task dir, where it does not
    // exist, so the binary fails instead of touching the user's real files.
    expect(resolved).toEqual([`${dir}/mnt/Photos/clip.mov`]);
  });

  it("maps /task paths to the real task dir", () => {
    const resolved = resolvePathArgs(["/task/work/in.wav"], taskId, {
      cwd: "/task",
      fs,
    });
    expect(resolved).toEqual([`${dir}/work/in.wav`]);
  });

  it("quarantines any other virtual absolute path into the task dir", () => {
    const resolved = resolvePathArgs(["/tmp/scratch.txt"], taskId, {
      cwd: "/task",
      fs,
    });
    expect(resolved).toEqual([`${dir}/tmp/scratch.txt`]);
  });

  it("quarantines a /task/.instrument path so native binaries can't read task internals", () => {
    const resolved = resolvePathArgs(["/task/.instrument/state.json"], taskId, {
      cwd: "/task",
      fs,
    });
    // Must NOT resolve to the real private file (`${dir}/.instrument/...`); the
    // private dir quarantines like /mnt, to a nonexistent nested path so the
    // binary fails not-found instead of reading task.db/state.json/settings.
    expect(resolved).toEqual([`${dir}/task/.instrument/state.json`]);
    expect(resolved[0]).not.toBe(`${dir}/.instrument/state.json`);
  });

  it("quarantines the writable /connectors mount too", () => {
    // /connectors is writable for bash and the file tools, but its real host
    // dir must never be handed to a native subprocess.
    const resolved = resolvePathArgs(
      ["/connectors/linear/connector.json"],
      taskId,
      {
        cwd: "/task",
        fs,
      },
    );
    expect(resolved).toEqual([`${dir}/connectors/linear/connector.json`]);
  });
});

describe("bridgeInlineCodePaths", () => {
  it.each([
    {
      code: 'fs.readFileSync("/task/attachments/chart.svg")',
      expected: 'fs.readFileSync("./attachments/chart.svg")',
      label: "double-quoted /task path from the task root",
      taskCwd: dir,
    },
    {
      code: "sharp('/task/work/in.png')",
      expected: "sharp('./work/in.png')",
      label: "single-quoted /task path from the task root",
      taskCwd: dir,
    },
    {
      code: "const root = `/task/${name}`;",
      expected: "const root = `./${name}`;",
      label: "backtick-quoted /task path from the task root",
      taskCwd: dir,
    },
    {
      code: 'open("/task/attachments/chart.svg")',
      expected: 'open("../../../attachments/chart.svg")',
      label: "quoted /task path from a nested cwd",
      taskCwd: `${dir}/work/skills/sharp-images`,
    },
    {
      code: 'const root = "/task"; use(root + "/output/x.png");',
      expected: 'const root = "."; use(root + "/output/x.png");',
      label: "bare /task string closed by its quote",
      taskCwd: dir,
    },
    {
      code: "parts.split(/task/).map(run)",
      expected: "parts.split(/task/).map(run)",
      label: "JS regex literal is not a string and stays untouched",
      taskCwd: dir,
    },
    {
      code: 'load("/taskmaster/config.json")',
      expected: 'load("/taskmaster/config.json")',
      label: "paths merely starting with /task text stay untouched",
      taskCwd: dir,
    },
    {
      code: "text.replace(/mnt/g, 'x')",
      expected: "text.replace(/mnt/g, 'x')",
      label: "JS regex literal /mnt/ does not trigger the mount error",
      taskCwd: dir,
    },
  ])("$label", ({ code, expected, taskCwd }) => {
    const result = bridgeInlineCodePaths(code, taskId, taskCwd);
    expect(result).toEqual({ code: expected });
    if ("code" in result) {
      expect(result.code).not.toContain(dir);
    }
  });

  it("strips a bare quoted /task from the task root without leaving an empty path", () => {
    // "." not "" so string concatenation like root + "/x" stays a valid
    // relative path.
    const result = bridgeInlineCodePaths('cd("/task")', taskId, dir);
    expect(result).toEqual({ code: 'cd(".")' });
  });

  it("fails fast on quoted /mnt paths with copy-first guidance", () => {
    const result = bridgeInlineCodePaths(
      'ffprobe("/mnt/Photos/clip.mov")',
      taskId,
      dir,
    );
    expect(result).toHaveProperty("error");
    if ("error" in result) {
      expect(result.error).toContain("Copy the file into the task first");
      expect(result.error).not.toContain(dir);
    }
  });

  it("fails fast on quoted /task/.instrument paths instead of rewriting them", () => {
    const result = bridgeInlineCodePaths(
      'fs.readFileSync("/task/.instrument/state.json")',
      taskId,
      dir,
    );
    expect(result).toHaveProperty("error");
    if ("error" in result) {
      expect(result.error).toContain(".instrument");
      expect(result.error).not.toContain(dir);
    }
  });
});

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
        label: "dot-dot traversal from nested cwd reaches task root",
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
      const taskCwd = `${dir}${cwd === "/" ? "" : cwd}`;
      const result = extractFileAndScriptArgs(
        [input],
        [input],
        taskId,
        taskCwd,
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
      const taskCwd = `${dir}${cwd === "/" ? "" : cwd}`;
      const result = extractFileAndScriptArgs(
        [file],
        args,
        taskId,
        taskCwd,
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

describe("scriptFileVirtualPathError", () => {
  it.each([
    {
      expected: "Copy the file into the task first",
      label: "quoted /mnt literal gets copy-first guidance",
      source: 'open("/mnt/Photos/clip.mov")',
    },
    {
      expected: ".instrument",
      label: "quoted private-dir literal is refused",
      source: 'open("/task/.instrument/state.json")',
    },
    {
      expected: "task-relative path",
      label: "quoted /task absolute literal points at relative paths",
      source: 'open("/task/output/report.txt", "w")',
    },
  ])("$label", ({ expected, source }) => {
    expect(scriptFileVirtualPathError(source)).toContain(expected);
  });

  it.each([
    {
      label: "task-relative path is fine",
      source: 'open("output/report.txt", "w")',
    },
    {
      label: "JS regex literal is not a quoted string",
      source: "text.split(/task/).map(run)",
    },
    {
      label: "/task embedded mid-string is not a path literal",
      source: 'print("saved to /task/output")',
    },
    {
      label: "a lookalike prefix stays untouched",
      source: 'load("/taskmaster/config.json")',
    },
  ])("$label returns undefined", ({ source }) => {
    expect(scriptFileVirtualPathError(source)).toBeUndefined();
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
