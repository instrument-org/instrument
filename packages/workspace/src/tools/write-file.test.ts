import mockFs from "mock-fs";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  beginSetupChangeTracking,
  consumeSetupChanges,
} from "../lib/setup-changes";
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

function makeExecuteArgs(input: { content: string; filePath: string }) {
  return {
    input: { explanation: "test", ...input },
    model,
    signal: AbortSignal.timeout(10_000),
    chatId,
  };
}

describe("WriteFile", () => {
  afterEach(() => {
    mockFs.restore();
  });

  it("tells a new file from an overwritten one", async () => {
    mockFs({ [MOCK_WORKSPACE_DIRS.work]: { [chatId]: {} } });

    const write = async (content: string) => {
      const args = makeExecuteArgs({ content, filePath: "./index.ts" });
      const output = (await runTool(WriteFile, args))._unsafeUnwrap();
      return WriteFile.toModelOutput({
        input: args.input,
        output,
        toolCallId: "test",
      });
    };

    expect([await write("const x = 1;"), await write("const x = 2;")])
      .toMatchInlineSnapshot(`
        [
          {
            "type": "text",
            "value": "Successfully wrote new file ./index.ts",
          },
          {
            "type": "text",
            "value": "Successfully overwrote existing file ./index.ts",
          },
        ]
      `);
    await expect(
      fs.readFile(path.join(workDir(chatId), "index.ts"), "utf8"),
    ).resolves.toBe("const x = 2;");
  });

  it("writes the chat's own folder by its full path, making the folders it needs", async () => {
    mockFs({ [MOCK_WORKSPACE_DIRS.work]: { [chatId]: {} } });

    const result = await runTool(
      WriteFile,
      makeExecuteArgs({
        content: "report",
        filePath: `${workDir(chatId)}/output/report.md`,
      }),
    );
    expect(result._unsafeUnwrap().filePath).toBe("./output/report.md");
    await expect(
      fs.readFile(path.join(workDir(chatId), "output/report.md"), "utf8"),
    ).resolves.toBe("report");
  });

  it("writes into a granted folder by its full path", async () => {
    mockFs({
      "/ext/Docs": {},
      [MOCK_WORKSPACE_DIRS.chats]: { [chatId]: {} },
      [MOCK_WORKSPACE_DIRS.work]: { [chatId]: {} },
    });
    await grantFolder({ chatId, path: "/ext/Docs", source: "attached" });

    const result = await runTool(
      WriteFile,
      makeExecuteArgs({
        content: "written by the agent",
        filePath: "/ext/Docs/report.md",
      }),
    );

    expect(result._unsafeUnwrap().filePath).toBe("/ext/Docs/report.md");
    await expect(fs.readFile("/ext/Docs/report.md", "utf8")).resolves.toBe(
      "written by the agent",
    );
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
    beginSetupChangeTracking(turn);

    const result = await runTool(WriteFile, {
      ...makeExecuteArgs({
        content: "---\ndescription: Brief\n---\n\nBody.\n",
        filePath: `${getWorkspaceSkillsDir()}/brief/SKILL.md`,
      }),
      sessionId,
    });

    expect(result.isOk()).toBe(true);
    await expect(consumeSetupChanges(turn)).resolves.toEqual([
      { change: "added", kind: "skill", name: "brief" },
    ]);
  });
});
