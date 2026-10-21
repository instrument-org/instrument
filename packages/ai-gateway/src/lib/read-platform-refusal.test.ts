import { describe, expect, it } from "vitest";

import { readPlatformRefusal } from "./read-platform-refusal";

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
