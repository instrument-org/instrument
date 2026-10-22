import { describe, expect, it } from "vitest";

import { planRefusalIn, readPlatformRefusal } from "./read-platform-refusal";

describe("readPlatformRefusal", () => {
  it("reads a usage-limit refusal's code, fields, and Retry-After", async () => {
    const response = Response.json(
      {
        error: {
          code: "usage-limit-exceeded",
          message: "Usage limit reached.",
          resetsAt: "2026-10-03T23:00:00.000Z",
          retryable: false,
          window: "5h",
        },
      },
      { headers: { "retry-after": "3600" }, status: 429 },
    );

    expect(await readPlatformRefusal(response, "/responses")).toMatchObject({
      code: "usage-limit-exceeded",
      details: {
        resetsAt: "2026-10-03T23:00:00.000Z",
        retryable: false,
        window: "5h",
      },
      message: "Usage limit reached.",
      path: "/responses",
      retryAfterSeconds: 3600,
      status: 429,
    });
  });

  it.each([
    ["an upstream's own 429 body", { error: { code: 429, message: "slow" } }],
    ["a body with no error", { ok: false }],
  ])("is undefined for %s", async (_label, body) => {
    expect(
      await readPlatformRefusal(Response.json(body, { status: 429 }), "/x"),
    ).toBeUndefined();
  });
});

describe("planRefusalIn", () => {
  it.each([
    [
      "no plan, with what unlocks it",
      { error: { code: "subscription-required", reason: "trial-available" } },
      { code: "subscription-required", reason: "trial-available" },
    ],
    [
      "a spent window, without its other fields",
      {
        error: {
          code: "usage-limit-exceeded",
          resetsAt: "2026-10-23T09:12:00.000Z",
          window: "5h",
        },
      },
      { code: "usage-limit-exceeded", resetsAt: "2026-10-23T09:12:00.000Z" },
    ],
    [
      "a concurrency limit",
      { error: { code: "concurrency-limit" } },
      undefined,
    ],
    ["a provider's own 402", { error: { code: 402, message: "x" } }, undefined],
  ])("reads %s", (_label, body, expected) => {
    expect(planRefusalIn(JSON.stringify(body))).toEqual(expected);
  });

  it("is undefined for a body that is not JSON", () => {
    expect(planRefusalIn("Bad gateway")).toBeUndefined();
  });
});
