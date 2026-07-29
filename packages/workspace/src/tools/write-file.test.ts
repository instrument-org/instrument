import mockFs from "mock-fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  beginMountChangeTracking,
  consumeMountChanges,
} from "../lib/workspace-mount-index";
import { FolderAttachment } from "../schemas/folder-attachment";
import { AbsolutePathSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { TaskIdSchema } from "../schemas/task-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import {
  createMockTaskConfig,
  MOCK_WORKSPACE_DIRS,
} from "../test/helpers/mock-task-config";
import { runTool } from "../test/helpers/run-tool";
import { WriteFile } from "./write-file";

const model = createMockAIGatewayModel();
const taskId = createMockTaskConfig(TaskIdSchema.parse("test"), {
  model,
});

function makeExecuteArgs(
  input: Parameters<typeof WriteFile.execute>[0]["input"],
) {
  return {
    agentName: "main" as const,
    input,
    model,
    signal: AbortSignal.timeout(10_000),
    spawnAgent: vi.fn(),
    taskId,
    taskState: {},
  };
}

describe("WriteFile - toModelOutput", () => {
  afterEach(() => {
    mockFs.restore();
  });

  it("returns a bare success line for a new file", async () => {
    mockFs({ [MOCK_WORKSPACE_DIRS.tasks]: { [taskId]: {} } });

    const input = {
      content: "const x = 2;",
      explanation: "test",
      filePath: "./index.ts",
    };
    const result = await runTool(WriteFile, makeExecuteArgs(input));
    const output = result._unsafeUnwrap();
    expect(WriteFile.toModelOutput({ input, output, toolCallId: "test" }))
      .toMatchInlineSnapshot(`
        {
          "type": "text",
          "value": "Successfully wrote new file ./index.ts",
        }
      `);
  });

  it("returns a bare success line for an overwritten file", async () => {
    mockFs({
      [MOCK_WORKSPACE_DIRS.tasks]: {
        [taskId]: { "index.ts": "const x = 1;" },
      },
    });

    const input = {
      content: "const x = 2;",
      explanation: "test",
      filePath: "./index.ts",
    };
    const result = await runTool(WriteFile, makeExecuteArgs(input));
    const output = result._unsafeUnwrap();
    expect(WriteFile.toModelOutput({ input, output, toolCallId: "test" }))
      .toMatchInlineSnapshot(`
        {
          "type": "text",
          "value": "Successfully overwrote existing file ./index.ts",
        }
      `);
  });
});

describe("WriteFile - path policy", () => {
  afterEach(() => {
    mockFs.restore();
  });

  it("writes /task/... virtual paths to the real task location", async () => {
    mockFs({ [MOCK_WORKSPACE_DIRS.tasks]: { [taskId]: {} } });

    const result = await runTool(
      WriteFile,
      makeExecuteArgs({
        content: "report",
        explanation: "test",
        filePath: "/task/output/report.md",
      }),
    );
    expect(result._unsafeUnwrap().filePath).toBe("./output/report.md");
  });

  it.each([
    {
      content: "---\ndescription: Brief\n---\n\nBody.\n",
      created: "brief",
      filePath: "/skills/brief/SKILL.md",
      kind: "skills" as const,
    },
    {
      content: '{ "slug": "notion" }',
      created: "notion",
      filePath: "/connectors/notion/connector.json",
      kind: "connectors" as const,
    },
  ])(
    "attributes a workspace $kind write to the executing session",
    async ({ content, created, filePath, kind }) => {
      mockFs({
        "/tmp/workspace": {
          connectors: {},
          skills: {},
          tasks: { [taskId]: {} },
        },
      });
      const sessionId = StoreId.newSessionId();
      const turn = { id: taskId, sessionId };
      await beginMountChangeTracking(turn);

      const result = await runTool(WriteFile, {
        ...makeExecuteArgs({ content, explanation: "test", filePath }),
        sessionId,
      });

      expect(result.isOk()).toBe(true);
      const changes = await consumeMountChanges(turn);
      expect(changes[kind]).toEqual({
        created: [created],
        removed: [],
        updated: [],
      });
    },
  );

  it("rejects writes into a read-only attached mount", async () => {
    mockFs({ [MOCK_WORKSPACE_DIRS.tasks]: { [taskId]: {} } });

    const result = await runTool(WriteFile, {
      ...makeExecuteArgs({
        content: "nope",
        explanation: "test",
        filePath: "/mnt/Docs/report.md",
      }),
      taskState: {
        attachedFolders: {
          docs: {
            createdAt: 0,
            id: FolderAttachment.IdSchema.parse("docs-id"),
            name: "Docs",
            path: AbsolutePathSchema.parse("/ext/Docs"),
            source: "user",
          },
        },
      },
    });
    const error = result._unsafeUnwrapErr();
    expect(error.message).toContain("read-only");
    expect(error.message).toContain("copy");
  });
});
