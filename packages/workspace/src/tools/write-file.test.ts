import mockFs from "mock-fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TaskIdSchema } from "../schemas/task-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import {
  createMockAppConfig,
  MOCK_WORKSPACE_DIRS,
} from "../test/helpers/mock-app-config";
import { runTool } from "../test/helpers/run-tool";
import { WriteFile } from "./write-file";

const model = createMockAIGatewayModel();
const taskId = createMockAppConfig(TaskIdSchema.parse("test"), {
  model,
});

function makeExecuteArgs(
  input: Parameters<typeof WriteFile.execute>[0]["input"],
) {
  return {
    agentName: "main" as const,
    input,
    model,
    projectState: {},
    signal: AbortSignal.timeout(10_000),
    spawnAgent: vi.fn(),
    taskId,
  };
}

describe("WriteFile - toModelOutput", () => {
  afterEach(() => {
    mockFs.restore();
  });

  it("returns a bare success line for a new file", async () => {
    mockFs({ [MOCK_WORKSPACE_DIRS.projects]: { [taskId]: {} } });

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
      [MOCK_WORKSPACE_DIRS.projects]: {
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
