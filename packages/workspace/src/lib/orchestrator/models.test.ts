import { fetchModelResultsForProviders } from "@instrument-org/ai-gateway";
import { AIProviderConfigIdSchema } from "@instrument-org/shared";
import { describe, expect, it, vi } from "vitest";

import { type TaskId } from "../../schemas/task-id";
import { type WorkspaceConfig } from "../../types";
import { getTaskState } from "../task-record";
import { listRunnableModels, ownProviderConfigId } from "./models";

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
