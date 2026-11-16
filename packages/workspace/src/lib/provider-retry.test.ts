import { describe, expect, it } from "vitest";

import { readRetryHeaders, retryDelayMs } from "./provider-retry";

describe("readRetryHeaders", () => {
  const now = Date.parse("2026-11-16T12:00:00Z");

  it.each<{
    expected: ReturnType<typeof readRetryHeaders>;
    headers: Record<string, string> | undefined;
    name: string;
  }>([
    { expected: {}, headers: undefined, name: "no headers" },
    { expected: {}, headers: { "content-type": "json" }, name: "none of them" },
    {
      expected: { retryAfterMs: 20_000 },
      headers: { "retry-after": "20" },
      name: "retry-after in seconds",
    },
    {
      expected: { retryAfterMs: 1500 },
      headers: { "retry-after": "20", "retry-after-ms": "1500" },
      name: "retry-after-ms ahead of retry-after",
    },
    {
      expected: { retryAfterMs: 90_000 },
      headers: { "retry-after": "Mon, 16 Nov 2026 12:01:30 GMT" },
      name: "retry-after as a date",
    },
    {
      expected: { retryAfterMs: 0 },
      headers: { "retry-after": "Mon, 16 Nov 2026 11:00:00 GMT" },
      name: "a date already past",
    },
    {
      expected: {},
      headers: { "retry-after": "soon" },
      name: "a value that is neither",
    },
    {
      expected: { shouldRetry: false },
      headers: { "X-Should-Retry": "false" },
      name: "x-should-retry false, in any case",
    },
    {
      expected: { retryAfterMs: 2000, shouldRetry: true },
      headers: { "retry-after-ms": "2000", "x-should-retry": "true" },
      name: "both",
    },
  ])("reads $name", ({ expected, headers }) => {
    expect(readRetryHeaders(headers, now)).toEqual(expected);
  });
});

describe("retryDelayMs", () => {
  const noJitter = () => 0;

  it("doubles from the base and stops at ten seconds", () => {
    expect(
      [1, 2, 3, 4, 5, 6].map((retryCount) =>
        retryDelayMs({
          baseMs: 1000,
          random: noJitter,
          retryAfterMs: undefined,
          retryCount,
        }),
      ),
    ).toEqual([1000, 2000, 4000, 8000, 10_000, 10_000]);
  });

  it("takes at most a tenth off at random, never adding to it", () => {
    expect(
      retryDelayMs({
        baseMs: 1000,
        random: () => 1,
        retryAfterMs: undefined,
        retryCount: 1,
      }),
    ).toBe(900);
  });

  it("waits what the provider asked, exactly", () => {
    expect(
      retryDelayMs({
        baseMs: 1000,
        random: () => 1,
        retryAfterMs: 20_000,
        retryCount: 1,
      }),
    ).toBe(20_000);
  });
});
