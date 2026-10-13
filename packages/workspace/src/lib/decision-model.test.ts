import { type AIGatewayProviderConfig } from "@instrument-org/ai-gateway";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requestDecision = vi.hoisted(() => vi.fn());

vi.mock("@instrument-org/ai-gateway", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@instrument-org/ai-gateway")>()),
  requestDecision,
}));
vi.mock("../logic/server/url", () => ({
  getWorkspaceServerURL: () => "http://127.0.0.1:0",
}));

const { DecisionRequestError } = await import("@instrument-org/ai-gateway");
const { askDecisionModel, decisionModelAvailable } =
  await import("./decision-model");

// Only the type matters to which providers can reach the model.
const configs = [
  { type: "openrouter" },
] as unknown as AIGatewayProviderConfig.Type[];
const body = { questions: {}, state: {} };
const usage = { purpose: "emoji-suggestion" as const };
const answer = { answers: {}, model: "typesafe/jev-1.13" };

describe("askDecisionModel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(async () => {
    // Ends any minute left alone by a test, so the next starts reachable.
    vi.advanceTimersByTime(60_000);
    requestDecision.mockResolvedValueOnce(answer);
    await askDecisionModel({ body, configs, usage });
    requestDecision.mockReset();
    vi.useRealTimers();
  });

  it("sends nothing with no provider that reaches the model", async () => {
    expect(decisionModelAvailable([])).toBe(false);
    await expect(askDecisionModel({ body, configs: [], usage })).resolves.toBe(
      undefined,
    );
    expect(requestDecision).not.toHaveBeenCalled();
  });

  it("leaves the model alone for a minute after the provider refuses", async () => {
    requestDecision.mockRejectedValueOnce(
      new DecisionRequestError("no provider for instrument/decision", 503),
    );
    await expect(askDecisionModel({ body, configs, usage })).rejects.toThrow();
    expect(decisionModelAvailable(configs)).toBe(false);
    await expect(askDecisionModel({ body, configs, usage })).resolves.toBe(
      undefined,
    );
    expect(requestDecision).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000);
    expect(decisionModelAvailable(configs)).toBe(true);
  });

  it("keeps asking after a request the provider calls malformed", async () => {
    requestDecision.mockRejectedValueOnce(
      new DecisionRequestError("too many options", 400),
    );
    await expect(askDecisionModel({ body, configs, usage })).rejects.toThrow();
    expect(decisionModelAvailable(configs)).toBe(true);
  });
});
