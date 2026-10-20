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
const activity = { purpose: "emoji-suggestion" as const };
const answer = { answers: {}, model: "typesafe/jev-1.13" };

describe("askDecisionModel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(async () => {
    // Ends any minute left alone by a test, so the next starts reachable.
    vi.advanceTimersByTime(60_000);
    requestDecision.mockResolvedValueOnce(answer);
    await askDecisionModel({ body, configs, activity });
    requestDecision.mockReset();
    vi.useRealTimers();
  });

  it("sends nothing with no provider that reaches the model", async () => {
    expect(decisionModelAvailable([])).toBe(false);
    await expect(
      askDecisionModel({ body, configs: [], activity }),
    ).resolves.toBe(undefined);
    expect(requestDecision).not.toHaveBeenCalled();
  });

  it("leaves the model alone for a minute after the provider refuses", async () => {
    requestDecision.mockRejectedValueOnce(
      new DecisionRequestError("no provider for instrument/decision", 503),
    );
    await expect(
      askDecisionModel({ body, configs, activity }),
    ).rejects.toThrow();
    expect(decisionModelAvailable(configs)).toBe(false);
    await expect(askDecisionModel({ body, configs, activity })).resolves.toBe(
      undefined,
    );
    expect(requestDecision).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000);
    expect(decisionModelAvailable(configs)).toBe(true);
  });

  // A signed-in account with no plan, running on its own ChatGPT or Claude:
  // every ask is refused, which is no fault and no reason to ask again soon.
  it.each([
    { refusal: '{"error":{"code":"subscription-required"}}', status: 402 },
    { refusal: '{"error":{"code":"usage-limit-exceeded"}}', status: 429 },
  ])(
    "answers nothing for ten minutes after the plan refuses ($status)",
    async ({ refusal, status }) => {
      requestDecision.mockRejectedValueOnce(
        new DecisionRequestError(`refused (${status}): ${refusal}`, status),
      );
      await expect(askDecisionModel({ body, configs, activity })).resolves.toBe(
        undefined,
      );
      vi.advanceTimersByTime(9 * 60_000);
      expect(decisionModelAvailable(configs)).toBe(false);
      vi.advanceTimersByTime(60_000);
      expect(decisionModelAvailable(configs)).toBe(true);
      expect(requestDecision).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps asking after a request the provider calls malformed", async () => {
    requestDecision.mockRejectedValueOnce(
      new DecisionRequestError("too many options", 400),
    );
    await expect(
      askDecisionModel({ body, configs, activity }),
    ).rejects.toThrow();
    expect(decisionModelAvailable(configs)).toBe(true);
  });
});
