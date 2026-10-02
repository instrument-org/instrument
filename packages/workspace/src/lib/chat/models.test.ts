import {
  type AIGatewayModelURI,
  fetchModelResultsForProviders,
} from "@instrument-org/ai-gateway";
import { AIProviderConfigIdSchema } from "@instrument-org/shared";
import { describe, expect, it, vi } from "vitest";

import { type TaskId } from "../../schemas/task-id";
import { createMockAIGatewayModel } from "../../test/helpers/mock-ai-gateway-model";
import { type WorkspaceConfig } from "../../types";
import { getTaskState } from "../task-record";
import {
  completeModelURI,
  listRunnableModels,
  modelTable,
  ownProviderConfigId,
} from "./models";

vi.mock("@instrument-org/ai-gateway", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchModelResultsForProviders: vi.fn().mockResolvedValue([]),
}));

vi.mock("../task-record", () => ({ getTaskState: vi.fn() }));

const OUR_CONFIG = { id: "instrument", type: "instrument" };
const THEIR_CONFIG = { id: "01KZRQW31V881NZGHACNRGFTXP", type: "openrouter" };

vi.mock("../workspace-config", () => ({
  getWorkspaceConfig: () =>
    ({
      captureException: vi.fn(),
      getAIProviderConfigs: () => [OUR_CONFIG, THEIR_CONFIG],
      modelCache: {},
      rootDir: "/tmp/workspace",
      tasksDir: "/tmp/workspace/tasks",
      // A partial config: only what the listing and the task directory read.
    }) as unknown as WorkspaceConfig,
}));

const TASK_ID = "conversation" as TaskId;

function taskStateWith(selectedModelURI: string | undefined) {
  vi.mocked(getTaskState).mockResolvedValue({ selectedModelURI });
}

describe("listRunnableModels", () => {
  it("asks the conversation's own provider and no other", async () => {
    await listRunnableModels(AIProviderConfigIdSchema.parse(THEIR_CONFIG.id));
    expect(vi.mocked(fetchModelResultsForProviders).mock.calls[0]?.[0]).toEqual(
      [THEIR_CONFIG],
    );
  });
});

describe("ownProviderConfigId", () => {
  it("is the provider config the conversation's own model runs on", async () => {
    taskStateWith(
      `anthropic/claude-sonnet-5?provider=openrouter&providerConfigId=${THEIR_CONFIG.id}`,
    );
    expect(await ownProviderConfigId(TASK_ID)).toBe(THEIR_CONFIG.id);
  });

  it("is nothing until the conversation has been messaged", async () => {
    taskStateWith(undefined);
    expect(await ownProviderConfigId(TASK_ID)).toBeUndefined();
  });
});

describe("modelTable", () => {
  const flash = {
    ...createMockAIGatewayModel({
      author: "zai-org",
      canonicalId: "glm-5.3-flash",
      name: "GLM 5.3 Flash",
    }),
    releasedAt: "2026-08-26",
  };
  const qwen = {
    ...createMockAIGatewayModel({
      author: "qwen",
      canonicalId: "qwen3.8-27b",
      name: "Qwen3.8 27B",
    }),
    releasedAt: "2026-08-17",
  };

  it("names a model author/id, without the provider its URI carries", () => {
    expect(modelTable([flash, qwen], ["model", "name", "released"]))
      .toMatchInlineSnapshot(`
      "model                  name           released
      zai-org/glm-5.3-flash  GLM 5.3 Flash  2026-08-26
      qwen/qwen3.8-27b       Qwen3.8 27B    2026-08-17
      "
    `);
  });

  it("leaves out a column the provider answers for no model", () => {
    expect(modelTable([flash, qwen], ["model", "released", "price"])).toBe(
      modelTable([flash, qwen], ["model", "released"]),
    );
    expect(
      modelTable(
        [{ ...flash, pricing: { input: 0.1, output: 0.4 } }, qwen],
        ["model", "price"],
      ),
    ).toMatchInlineSnapshot(`
      "model                  $/M in/out
      zai-org/glm-5.3-flash  0.1/0.4
      qwen/qwen3.8-27b       ?
      "
    `);
  });
});

describe("completeModelURI", () => {
  const params = {
    provider: THEIR_CONFIG.type,
    providerConfigId: THEIR_CONFIG.id,
  } as AIGatewayModelURI.Params;

  it("puts a bare author/id on the conversation's own provider", () => {
    expect(completeModelURI("zai-org/glm-5.3-flash", params)).toBe(
      `zai-org/glm-5.3-flash?provider=openrouter&providerConfigId=${THEIR_CONFIG.id}`,
    );
  });

  it("hands a whole URI back as it is", () => {
    const uri = `anthropic/claude-sonnet-5?provider=openrouter&providerConfigId=${THEIR_CONFIG.id}`;
    expect(completeModelURI(uri, params)).toBe(uri);
  });

  it.each(["glm-5.3-flash", "a/b/c", "zai-org/"])(
    "refuses %j, which is not author/id",
    (name) => {
      expect(() => completeModelURI(name, params)).toThrow("author/id");
    },
  );
});
