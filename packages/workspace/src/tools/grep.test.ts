import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { FolderAttachment } from "../schemas/folder-attachment";
import { TaskDirSchema } from "../schemas/paths";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { runTool } from "../test/helpers/run-tool";
import { TOOLS } from "./all";
import { Grep } from "./grep";

const model = createMockAIGatewayModel();

function createFixturesTaskConfig() {
  return createMockTaskConfigForDir(
    TaskDirSchema.parse(
      path.join(import.meta.dirname, "../../fixtures/file-system"),
    ),
    { model },
  );
}

// Sort matches deterministically for testing
function sortMatchesForTesting(
  matches: { lineNum: number; lineText: string; path: string }[],
) {
  return matches.sort((a, b) => {
    // First sort by path
    if (a.path !== b.path) {
      return a.path.localeCompare(b.path);
    }
    // Then by line number
    if (a.lineNum !== b.lineNum) {
      return a.lineNum - b.lineNum;
    }
    // Finally by line text
    return a.lineText.localeCompare(b.lineText);
  });
}

describe("Grep", () => {
  describe("toModelOutput", () => {
    it("should return 'No matches found' when there are no matches", () => {
      const result = Grep.toModelOutput({
        input: {
          pattern: "",
        },
        output: {
          hasErrors: false,
          matches: [],
          totalMatches: 0,
          truncated: false,
        },
        toolCallId: "123",
      });
      expect(result).toMatchInlineSnapshot(`
        {
          "type": "text",
          "value": "No matches found",
        }
      `);
    });

    it("should format matches grouped by file and sorted by modification time", () => {
      const result = Grep.toModelOutput({
        input: {
          pattern: "",
        },
        output: {
          hasErrors: false,
          matches: [
            // Older file first in input (should be moved to end after sorting)
            {
              isContext: false,
              lineNum: 5,
              lineText: "export const baz = 'qux';",
              modifiedAt: 1_234_567_880_000, // older
              path: "src/file2.ts",
            },
            // Newer file matches (should be moved to beginning after sorting)
            {
              isContext: false,
              lineNum: 10,
              lineText: "const foo = 'bar';",
              modifiedAt: 1_234_567_890_000, // newer
              path: "src/file1.ts",
            },
            {
              isContext: false,
              lineNum: 20,
              lineText: "console.log(foo);",
              modifiedAt: 1_234_567_890_000, // newer
              path: "src/file1.ts",
            },
          ],
          totalMatches: 3,
          truncated: false,
        },
        toolCallId: "123",
      });
      expect(result).toMatchInlineSnapshot(`
        {
          "type": "text",
          "value": "Found 3 matches
        src/file1.ts:
          Line 10: const foo = 'bar';
          Line 20: console.log(foo);

        src/file2.ts:
          Line 5: export const baz = 'qux';",
        }
      `);
    });

    it("marks context lines with a dash and leaves them out of the count", () => {
      const result = Grep.toModelOutput({
        input: {
          pattern: "",
        },
        output: {
          hasErrors: false,
          matches: [
            {
              isContext: true,
              lineNum: 9,
              lineText: "// setup",
              modifiedAt: 1_234_567_890_000,
              path: "src/file1.ts",
            },
            {
              isContext: false,
              lineNum: 10,
              lineText: "const foo = 'bar';",
              modifiedAt: 1_234_567_890_000,
              path: "src/file1.ts",
            },
            {
              isContext: true,
              lineNum: 11,
              lineText: "return foo;",
              modifiedAt: 1_234_567_890_000,
              path: "src/file1.ts",
            },
          ],
          totalMatches: 1,
          truncated: false,
        },
        toolCallId: "123",
      });
      expect(result).toMatchInlineSnapshot(`
        {
          "type": "text",
          "value": "Found 1 matches
        src/file1.ts:
          Line 9- // setup
          Line 10: const foo = 'bar';
          Line 11- return foo;",
        }
      `);
    });

    it("should show truncation warning when results are truncated", () => {
      const result = Grep.toModelOutput({
        input: {
          pattern: "",
        },
        output: {
          hasErrors: false,
          matches: [
            {
              isContext: false,
              lineNum: 10,
              lineText: "const foo = 'bar';",
              modifiedAt: 1_234_567_890_000,
              path: "src/file1.ts",
            },
          ],
          totalMatches: 150,
          truncated: true,
        },
        toolCallId: "123",
      });
      expect(result).toMatchInlineSnapshot(`
        {
          "type": "text",
          "value": "Found 1 matches
        src/file1.ts:
          Line 10: const foo = 'bar';

        (Results truncated: showing 100 of 150 matches (50 hidden). Consider using a more specific path or pattern.)",
        }
      `);
    });

    it("should handle single match in single file", () => {
      const result = Grep.toModelOutput({
        input: {
          pattern: "",
        },
        output: {
          hasErrors: false,
          matches: [
            {
              isContext: false,
              lineNum: 42,
              lineText: "const answer = 42;",
              modifiedAt: 1_234_567_890_000,
              path: "src/single.ts",
            },
          ],
          totalMatches: 1,
          truncated: false,
        },
        toolCallId: "123",
      });
      expect(result).toMatchInlineSnapshot(`
        {
          "type": "text",
          "value": "Found 1 matches
        src/single.ts:
          Line 42: const answer = 42;",
        }
      `);
    });
  });

  describe("execute", () => {
    it("should find matches for a specific pattern in fixtures", async () => {
      const result = await runTool(TOOLS.Grep, {
        agentName: "main",
        input: {
          explanation: "Looking for async functions",
          pattern: "async function",
        },
        model,
        signal: AbortSignal.timeout(10_000),
        spawnAgent: vi.fn(),
        taskId: createFixturesTaskConfig(),
        taskState: {},
      });

      expect(result.isOk()).toBe(true);
      expect(
        sortMatchesForTesting(
          result
            ._unsafeUnwrap()
            // Omit modifiedAt as it's not deterministic
            .matches.map(({ modifiedAt: _modifiedAt, ...rest }) => rest),
        ),
      ).toMatchInlineSnapshot(`
        [
          {
            "isContext": false,
            "lineNum": 4,
            "lineText": "- async functions",
            "path": "./grep-test-2.txt",
          },
          {
            "isContext": false,
            "lineNum": 21,
            "lineText": "async function testGrep() {",
            "path": "./grep-test-2.txt",
          },
          {
            "isContext": false,
            "lineNum": 4,
            "lineText": "- async functions",
            "path": "./grep-test.txt",
          },
          {
            "isContext": false,
            "lineNum": 21,
            "lineText": "async function testGrep() {",
            "path": "./grep-test.txt",
          },
        ]
      `);
    });

    it("returns surrounding lines marked as context when context is set", async () => {
      const result = await runTool(TOOLS.Grep, {
        agentName: "main",
        input: {
          context: 1,
          explanation: "Looking for async functions with surrounding lines",
          include: "grep-test.txt",
          pattern: "async function testGrep",
        },
        model,
        signal: AbortSignal.timeout(10_000),
        spawnAgent: vi.fn(),
        taskId: createFixturesTaskConfig(),
        taskState: {},
      });

      const output = result._unsafeUnwrap();
      expect(output.matches.map(({ modifiedAt: _modifiedAt, ...rest }) => rest))
        .toMatchInlineSnapshot(`
        [
          {
            "isContext": true,
            "lineNum": 20,
            "lineText": "Some example patterns to search for:",
            "path": "./grep-test.txt",
          },
          {
            "isContext": false,
            "lineNum": 21,
            "lineText": "async function testGrep() {",
            "path": "./grep-test.txt",
          },
          {
            "isContext": true,
            "lineNum": 22,
            "lineText": "  console.log("Testing grep functionality");",
            "path": "./grep-test.txt",
          },
        ]
      `);
      // Context lines must not consume the match budget.
      expect(output.totalMatches).toBe(1);
    });

    it("does not search the private dir when scanning the task root", async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "grep-private-"));
      const dir = path.join(tmpDir, "test");
      try {
        await fs.mkdir(path.join(dir, ".instrument"), { recursive: true });
        await fs.writeFile(
          path.join(dir, ".instrument", "state.json"),
          '{"attachedFolders":"UNIQUE_PRIVATE_MARKER"}',
        );
        await fs.writeFile(
          path.join(dir, "visible.txt"),
          "UNIQUE_PRIVATE_MARKER",
        );

        const result = await runTool(TOOLS.Grep, {
          agentName: "main",
          input: {
            explanation: "Searching the task root",
            pattern: "UNIQUE_PRIVATE_MARKER",
          },
          model,
          signal: AbortSignal.timeout(10_000),
          spawnAgent: vi.fn(),
          taskId: createMockTaskConfigForDir(TaskDirSchema.parse(dir), {
            model,
          }),
          taskState: {},
        });

        const paths = result._unsafeUnwrap().matches.map((m) => m.path);
        expect(paths).toEqual(["./visible.txt"]);
      } finally {
        await fs.rm(tmpDir, { force: true, recursive: true });
      }
    });

    it("should return no matches when pattern is not found", async () => {
      const result = await runTool(TOOLS.Grep, {
        agentName: "main",
        input: {
          explanation: "Looking for non-existent pattern",
          pattern: "nonexistent-pattern-xyz123",
        },
        model,
        signal: AbortSignal.timeout(10_000),
        spawnAgent: vi.fn(),
        taskId: createFixturesTaskConfig(),
        taskState: {},
      });

      const value = result._unsafeUnwrap();
      expect(value.matches).toEqual([]);
      expect(value.totalMatches).toBe(0);
      expect(value.truncated).toBe(false);
    });

    it("should use smart case to match case insensitively for lowercase patterns", async () => {
      const result = await runTool(TOOLS.Grep, {
        agentName: "main",
        input: {
          pattern: "handles",
        },
        model,
        signal: AbortSignal.timeout(10_000),
        spawnAgent: vi.fn(),
        taskId: createFixturesTaskConfig(),
        taskState: {},
      });

      expect(result.isOk()).toBe(true);
      expect(
        sortMatchesForTesting(
          result
            ._unsafeUnwrap()
            // Omit modifiedAt as it's not deterministic
            .matches.map(({ modifiedAt: _modifiedAt, ...rest }) => rest),
        ),
      ).toMatchInlineSnapshot(`
        [
          {
            "isContext": false,
            "lineNum": 16,
            "lineText": "- Handles multiple matches correctly",
            "path": "./grep-test-2.txt",
          },
          {
            "isContext": false,
            "lineNum": 18,
            "lineText": "- Properly handles special characters",
            "path": "./grep-test-2.txt",
          },
          {
            "isContext": false,
            "lineNum": 16,
            "lineText": "- Handles multiple matches correctly",
            "path": "./grep-test.txt",
          },
          {
            "isContext": false,
            "lineNum": 18,
            "lineText": "- Properly handles special characters",
            "path": "./grep-test.txt",
          },
          {
            "isContext": false,
            "lineNum": 7,
            "lineText": "This ensures grep handles multiple nested directories correctly.",
            "path": "./nested/another/file.txt",
          },
        ]
      `);
    });

    it("should use smart case to match case sensitively for uppercase patterns", async () => {
      const result = await runTool(TOOLS.Grep, {
        agentName: "main",
        input: {
          pattern: "Handles",
        },
        model,
        signal: AbortSignal.timeout(10_000),
        spawnAgent: vi.fn(),
        taskId: createFixturesTaskConfig(),
        taskState: {},
      });

      expect(result.isOk()).toBe(true);
      expect(
        sortMatchesForTesting(
          result
            ._unsafeUnwrap()
            // Omit modifiedAt as it's not deterministic
            .matches.map(({ modifiedAt: _modifiedAt, ...rest }) => rest),
        ),
      ).toMatchInlineSnapshot(`
        [
          {
            "isContext": false,
            "lineNum": 16,
            "lineText": "- Handles multiple matches correctly",
            "path": "./grep-test-2.txt",
          },
          {
            "isContext": false,
            "lineNum": 16,
            "lineText": "- Handles multiple matches correctly",
            "path": "./grep-test.txt",
          },
        ]
      `);
    });

    it("should match all text after the first colon", async () => {
      const result = await runTool(TOOLS.Grep, {
        agentName: "main",
        input: {
          pattern: "zzz",
        },
        model,
        signal: AbortSignal.timeout(10_000),
        spawnAgent: vi.fn(),
        taskId: createFixturesTaskConfig(),
        taskState: {},
      });

      expect(result.isOk()).toBe(true);
      expect(
        sortMatchesForTesting(
          result
            ._unsafeUnwrap()
            // Omit modifiedAt as it's not deterministic
            .matches.map(({ modifiedAt: _modifiedAt, ...rest }) => rest),
        ),
      ).toMatchInlineSnapshot(`
        [
          {
            "isContext": false,
            "lineNum": 4,
            "lineText": "      "exclude": ["zzz-test-2.txt"]",
            "path": "./json-file.json",
          },
        ]
      `);
    });

    it("should handle nested folders with vertical bars", async () => {
      const result = await runTool(TOOLS.Grep, {
        agentName: "main",
        input: {
          pattern: "vertical\\|bar",
        },
        model,
        signal: AbortSignal.timeout(10_000),
        spawnAgent: vi.fn(),
        taskId: createFixturesTaskConfig(),
        taskState: {},
      });

      expect(result.isOk()).toBe(true);
      expect(
        sortMatchesForTesting(
          result
            ._unsafeUnwrap()
            // Omit modifiedAt as it's not deterministic
            .matches.map(({ modifiedAt: _modifiedAt, ...rest }) => rest),
        ),
      ).toMatchInlineSnapshot(`
        [
          {
            "isContext": false,
            "lineNum": 4,
            "lineText": "- vertical|bars|everywhere",
            "path": "./nested/another/file.txt",
          },
          {
            "isContext": false,
            "lineNum": 6,
            "lineText": "- vertical|bar|separator",
            "path": "./nested/level1/test-deep.txt",
          },
        ]
      `);
    });

    it("should search within a specific subdirectory when path is provided", async () => {
      const result = await runTool(TOOLS.Grep, {
        agentName: "main",
        input: {
          path: "./nested",
          pattern: "vertical\\|bar",
        },
        model,
        signal: AbortSignal.timeout(10_000),
        spawnAgent: vi.fn(),
        taskId: createFixturesTaskConfig(),
        taskState: {},
      });

      expect(result.isOk()).toBe(true);
      expect(
        sortMatchesForTesting(
          result
            ._unsafeUnwrap()
            // Omit modifiedAt as it's not deterministic
            .matches.map(({ modifiedAt: _modifiedAt, ...rest }) => rest),
        ),
      ).toMatchInlineSnapshot(`
        [
          {
            "isContext": false,
            "lineNum": 4,
            "lineText": "- vertical|bars|everywhere",
            "path": "./nested/another/file.txt",
          },
          {
            "isContext": false,
            "lineNum": 6,
            "lineText": "- vertical|bar|separator",
            "path": "./nested/level1/test-deep.txt",
          },
        ]
      `);
    });

    it("collapses the task dir in matched line text, leaving home paths as data", async () => {
      // A matched line can carry a task-dir path a script resolved and wrote to
      // a file; it must not leak the task layout back to the model. An unrelated
      // home path stays untouched.
      const fixturesPath = path.join(
        import.meta.dirname,
        "../../fixtures/file-system",
      );
      const home = os.homedir();
      const probePath = path.join(fixturesPath, "grep-redact-probe.txt");
      await fs.writeFile(
        probePath,
        `MARKER_XYZ path ${fixturesPath}/output and ${home}/Library\n`,
      );

      try {
        const result = await runTool(TOOLS.Grep, {
          agentName: "main",
          input: { explanation: "probe", pattern: "MARKER_XYZ" },
          model,
          signal: AbortSignal.timeout(10_000),
          spawnAgent: vi.fn(),
          taskId: createFixturesTaskConfig(),
          taskState: {},
        });

        const value = result._unsafeUnwrap();
        expect(value.matches).toHaveLength(1);
        const [match] = value.matches;
        expect(match?.lineText).toBe(
          `MARKER_XYZ path ./output and ${home}/Library`,
        );
        expect(match?.lineText).not.toContain(fixturesPath);
      } finally {
        await fs.rm(probePath, { force: true });
      }
    });

    it("searches a read-only attached folder by mount path, returning mount paths", async () => {
      // The attached folder is a distinct directory (a subfolder of the task
      // fixtures) so its host path maps back to the /mnt mount, not the task.
      const attachedPath = path.join(
        import.meta.dirname,
        "../../fixtures/file-system/nested",
      );
      const attachedFolders: Record<string, FolderAttachment.Type> = {
        "test-folder": {
          createdAt: Date.now(),
          id: FolderAttachment.IdSchema.parse("test-folder-id"),
          name: "Test Folder",
          path: TaskDirSchema.parse(attachedPath),
          source: "user",
        },
      };

      const result = await runTool(TOOLS.Grep, {
        agentName: "main",
        input: {
          path: "/mnt/Test Folder",
          pattern: "vertical\\|bar",
        },
        model,
        signal: AbortSignal.timeout(10_000),
        spawnAgent: vi.fn(),
        taskId: createFixturesTaskConfig(),
        taskState: { attachedFolders },
      });

      expect(result.isOk()).toBe(true);
      expect(
        sortMatchesForTesting(
          result
            ._unsafeUnwrap()
            .matches.map(({ modifiedAt: _modifiedAt, ...rest }) => rest),
        ),
      ).toMatchInlineSnapshot(`
        [
          {
            "isContext": false,
            "lineNum": 4,
            "lineText": "- vertical|bars|everywhere",
            "path": "/mnt/Test Folder/another/file.txt",
          },
          {
            "isContext": false,
            "lineNum": 6,
            "lineText": "- vertical|bar|separator",
            "path": "/mnt/Test Folder/level1/test-deep.txt",
          },
        ]
      `);
    });
  });
});
