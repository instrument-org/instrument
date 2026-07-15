import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { FolderAttachment } from "../schemas/folder-attachment";
import { TaskDirSchema } from "../schemas/paths";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { runTool } from "../test/helpers/run-tool";
import { TOOLS } from "./all";

vi.mock(import("ulid"));
vi.mock(import("../lib/session-store-storage"));
vi.mock(import("../lib/get-current-date"));

const FIXTURES_PATH = path.join(
  import.meta.dirname,
  "../../fixtures/file-system",
);

const model = createMockAIGatewayModel();

function createFixturesTaskConfig() {
  return createMockTaskConfigForDir(FIXTURES_PATH, { model });
}

// Sort files deterministically for testing (ripgrep returns mtime-sorted)
function sortFilesForTesting(files: string[]) {
  return [...files].sort((a, b) => a.localeCompare(b));
}


describe("Glob", () => {
  it("should find files matching a specific pattern", async () => {
    const result = await runTool(TOOLS.Glob, {
      agentName: "main",
      input: {
        explanation: "Find ts files",
        pattern: "**/*.ts",
      },
      model,
      signal: AbortSignal.timeout(10_000),
      spawnAgent: vi.fn(),
      taskId: createFixturesTaskConfig(),
      taskState: {},
    });

    expect(sortFilesForTesting(result._unsafeUnwrap().files))
      .toMatchInlineSnapshot(`
      [
        "./a-folder/built-in.ts",
        "./a-folder/external-module.ts",
      ]
    `);
  });

  it("should find files in a subdirectory when path is provided", async () => {
    const result = await runTool(TOOLS.Glob, {
      agentName: "main",
      input: {
        explanation: "Find txt files in folder",
        path: "./folder",
        pattern: "*.txt",
      },
      model,
      signal: AbortSignal.timeout(10_000),
      spawnAgent: vi.fn(),
      taskId: createFixturesTaskConfig(),
      taskState: {},
    });

    expect(sortFilesForTesting(result._unsafeUnwrap().files))
      .toMatchInlineSnapshot(`
      [
        "./other2.txt",
        "./test3.txt",
      ]
    `);
  });

  it("globs a read-only attached folder by mount path, returning mount paths", async () => {
    // Distinct directory (a subfolder of the fixtures) so its host path maps
    // back to the /mnt mount, not the task. Results must be /mnt/... so a
    // follow-up read_file resolves to the same place.
    const attachedPath = path.join(
      import.meta.dirname,
      "../../fixtures/file-system/nested",
    );
    const attachedFolders: Record<string, FolderAttachment.Type> = {
      "test-folder": {
        createdAt: Date.now(),
        id: FolderAttachment.IdSchema.parse("test-folder-id"),
        name: "Attached",
        path: TaskDirSchema.parse(attachedPath),
        source: "user",
      },
    };

    const result = await runTool(TOOLS.Glob, {
      agentName: "main",
      input: {
        explanation: "Find txt files in attached folder",
        path: "/mnt/Attached",
        pattern: "**/*.txt",
      },
      model,
      signal: AbortSignal.timeout(10_000),
      spawnAgent: vi.fn(),
      taskId: createFixturesTaskConfig(),
      taskState: { attachedFolders },
    });

    expect(sortFilesForTesting(result._unsafeUnwrap().files))
      .toMatchInlineSnapshot(`
      [
        "/mnt/Attached/another/file.txt",
        "/mnt/Attached/level1/test-deep.txt",
      ]
    `);
  });

  it("should return empty array when no files match", async () => {
    const result = await runTool(TOOLS.Glob, {
      agentName: "main",
      input: {
        explanation: "Find nonexistent files",
        pattern: "*.nonexistent_extension_xyz",
      },
      model,
      signal: AbortSignal.timeout(10_000),
      spawnAgent: vi.fn(),
      taskId: createFixturesTaskConfig(),
      taskState: {},
    });

    const output = result._unsafeUnwrap();
    expect(output.files).toEqual([]);
    expect(output.totalFiles).toBe(0);
    expect(output.truncated).toBe(false);
  });

});
