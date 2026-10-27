import { asSchema } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { instrumentAgent } from "../agents/instrument";
import { ChatIdSchema } from "../schemas/chat-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";

/**
 * The tool definitions a request carries, serialized as a provider sends
 * them: each tool's name, description and input JSON Schema. They are the
 * start of the prefix a provider caches, so a change to any byte of them
 * misses the cache for every chat on its next turn. This pins them whole.
 *
 * A chat and each of its tasks are sessions of the one agent, and a tool is
 * built from the model and the chat alone, never the session or its role:
 * a task's request starts with its chat's definitions, which is what lets
 * the provider's cache serve the conversation it forks.
 */
async function serializedTools(
  model: ReturnType<typeof createMockAIGatewayModel>,
) {
  const chatId = ChatIdSchema.parse("tool-definitions");
  const tools = await instrumentAgent.getTools();
  return JSON.stringify(
    await Promise.all(
      tools.map(async (tool) => {
        const built = await tool.aiSDKTool({ chatId, model });
        return {
          description: built.description,
          inputSchema: await asSchema(built.inputSchema).jsonSchema,
          name: tool.name,
        };
      }),
    ),
    null,
    2,
  );
}

describe("the model's tool definitions", () => {
  // Pinned to a Mac, as the bash description's own test is: the
  // definitions read the same on every platform, which that test checks.
  beforeEach(() => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // A model that reads images and one that reads text alone: `read_file`
  // says which media the model can take.
  it.each([
    ["text", ["inputText", "outputText", "tools"] as const],
    ["vision", ["inputText", "inputImage", "outputText", "tools"] as const],
  ])("are the same bytes for a %s model", async (kind, features) => {
    const model = createMockAIGatewayModel({ features: [...features] });
    await expect(await serializedTools(model)).toMatchFileSnapshot(
      `./__snapshots__/tool-definitions.${kind}.json`,
    );
  });
});
