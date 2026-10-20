import { beforeEach, describe, expect, it, vi } from "vitest";

const token = vi.hoisted(() => ({ value: "token-a" as null | string }));
vi.mock("../platform-api/utils", () => ({ getToken: () => token.value }));

const {
  isHostedFeatureAvailable,
  noteHostedRefusal,
  recordHostedFeatures,
  setHostedFeaturesReader,
} = await import("./hosted-features");

const NOW = Date.parse("2026-10-20T12:00:00Z");
const RESET = "2026-11-19T12:00:00.000Z";

describe("hosted features", () => {
  beforeEach(() => {
    token.value = "token-a";
  });

  it("knows nothing before a status read", () => {
    token.value = "token-fresh";
    expect(isHostedFeatureAvailable("decisions", NOW)).toBeUndefined();
  });

  it("refuses a spent feature until its reset, and a plan-only one until the next read", () => {
    recordHostedFeatures({
      decisions: {
        available: false,
        code: "usage-limit-exceeded",
        resetsAt: RESET,
      },
      models: {
        available: false,
        code: "subscription-required",
        reason: "trial-available",
      },
      search: { available: true },
    });

    expect(isHostedFeatureAvailable("decisions", NOW)).toBe(false);
    expect(isHostedFeatureAvailable("decisions", Date.parse(RESET))).toBe(true);
    expect(isHostedFeatureAvailable("models", Date.parse(RESET) + 1)).toBe(
      false,
    );
    expect(isHostedFeatureAvailable("search", NOW)).toBe(true);
    expect(isHostedFeatureAvailable("dictation", NOW)).toBeUndefined();
  });

  it("never answers for another sign-in", () => {
    recordHostedFeatures({ decisions: { available: false } });
    token.value = "token-b";

    expect(isHostedFeatureAvailable("decisions", NOW)).toBeUndefined();
  });

  it("reads the status again after a plan refusal, at most every 30 seconds", () => {
    const read = vi.fn(() => Promise.resolve());
    setHostedFeaturesReader(read);
    const refusal = {
      at: NOW,
      code: "usage-limit-exceeded",
      details: {},
      path: "v1/decision",
      status: 429,
    };

    noteHostedRefusal(refusal, NOW);
    noteHostedRefusal(refusal, NOW + 10_000);
    noteHostedRefusal(
      { ...refusal, code: "rate-limit-exceeded" },
      NOW + 60_000,
    );
    noteHostedRefusal(refusal, NOW + 31_000);

    expect(read).toHaveBeenCalledTimes(2);
  });
});
