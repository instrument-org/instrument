import mockFs from "mock-fs";
import fs from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";

import {
  beginSkillChangeTracking,
  consumeSkillChanges,
} from "../lib/workspace-skill-index";
import { grantFolder } from "../lib/chat/grants";
import { workDir } from "../lib/work-dir";
import { getWorkspaceSkillsDir } from "../lib/workspace-skills-dir";
import { StoreId } from "../schemas/store-id";
import { ChatIdSchema } from "../schemas/chat-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import {
  createMockChatConfig,
  MOCK_WORKSPACE_DIRS,
} from "../test/helpers/mock-chat-config";
import { runTool } from "../test/helpers/run-tool";
import { WriteFile } from "./write-file";

const model = createMockAIGatewayModel();
const chatId = createMockChatConfig(ChatIdSchema.parse("test"), {
  model,
});

function makeExecuteArgs(
  input: Parameters<typeof WriteFile.execute>[0]["input"],
) {
  return {
    input,
    model,
    signal: AbortSignal.timeout(10_000),
    chatId,
  };
}

describe("WriteFile - toModelOutput", () => {
  afterEach(() => {
    mockFs.restore();
  });

  it("returns a bare success line for a new file", async () => {
    mockFs({ [MOCK_WORKSPACE_DIRS.work]: { [chatId]: {} } });

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
      [MOCK_WORKSPACE_DIRS.work]: {
        [chatId]: { "index.ts": "const x = 1;" },
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

  it("writes the chat's own folder by its full path", async () => {
    mockFs({ [MOCK_WORKSPACE_DIRS.work]: { [chatId]: {} } });

    const result = await runTool(
      WriteFile,
      makeExecuteArgs({
        content: "report",
        explanation: "test",
        filePath: `${workDir(chatId)}/output/report.md`,
      }),
    );
    expect(result._unsafeUnwrap().filePath).toBe("./output/report.md");
  });

  it("attributes a workspace skill write to the executing session", async () => {
    mockFs({
      [MOCK_WORKSPACE_DIRS.root]: {
        skills: {},
        tasks: { [chatId]: {} },
      },
    });
    const sessionId = StoreId.newSessionId();
    const turn = { id: chatId, sessionId };
    await beginSkillChangeTracking(turn);

    const result = await runTool(WriteFile, {
      ...makeExecuteArgs({
        content: "---\ndescription: Brief\n---\n\nBody.\n",
        explanation: "test",
        filePath: `${getWorkspaceSkillsDir()}/brief/SKILL.md`,
      }),
      sessionId,
    });

    expect(result.isOk()).toBe(true);
    await expect(consumeSkillChanges(turn)).resolves.toEqual({
      created: ["brief"],
      removed: [],
      updated: [],
    });
  });

  it("writes into a granted folder by its full path", async () => {
    mockFs({
      "/ext/Docs": {},
      [MOCK_WORKSPACE_DIRS.chats]: { [chatId]: {} },
      [MOCK_WORKSPACE_DIRS.work]: { [chatId]: {} },
    });
    await grantFolder({ chatId, path: "/ext/Docs", source: "attached" });

    const result = await runTool(WriteFile, {
      ...makeExecuteArgs({
        content: "written by the agent",
        explanation: "test",
        filePath: "/ext/Docs/report.md",
      }),
    });

    expect(result.isOk()).toBe(true);
    await expect(fs.readFile("/ext/Docs/report.md", "utf8")).resolves.toBe(
      "written by the agent",
    );
  });
});
