import { describe, expect, it } from "vitest";

import { type SessionMessage } from "../schemas/session/message";
import {
  computeContextBudget,
  contextOccupancyFromMessages,
} from "./context-budget";

describe("computeContextBudget", () => {
  it.each([
    { contextLength: undefined, name: "no context length", occupied: 50_000 },
    {
      contextLength: Number.NaN,
      name: "context length is NaN",
      occupied: 50_000,
    },
    { contextLength: 0, name: "the window is zero", occupied: 0 },
  ])("reports unknown when $name", ({ contextLength, occupied }) => {
    expect(computeContextBudget({ contextLength, occupied })).toEqual({
      occupied: 0,
      remaining: 0,
      status: "unknown",
      usable: 0,
    });
  });

  it("counts a fresh session with no reported usage as spending nothing", () => {
    expect(
      computeContextBudget({ contextLength: 200_000, occupied: undefined }),
    ).toMatchInlineSnapshot(`
      {
        "occupied": 0,
        "remaining": 168000,
        "status": "ok",
        "usable": 168000,
      }
    `);
  });

  it.each([
    { expected: "ok", occupied: 0 },
    { expected: "ok", occupied: 142_799 },
    // 85% of a 168,000 usable window.
    { expected: "warn", occupied: 142_800 },
    { expected: "warn", occupied: 167_999 },
    { expected: "exhausted", occupied: 168_000 },
    { expected: "exhausted", occupied: 500_000 },
  ])(
    "is $expected when $occupied tokens of a 200k window are spent",
    ({ expected, occupied }) => {
      expect(
        computeContextBudget({ contextLength: 200_000, occupied }).status,
      ).toBe(expected);
    },
  );

  it("subtracts the reserve so the model keeps room to answer", () => {
    expect(computeContextBudget({ contextLength: 200_000, occupied: 10_000 }))
      .toMatchInlineSnapshot(`
      {
        "occupied": 10000,
        "remaining": 158000,
        "status": "ok",
        "usable": 168000,
      }
    `);
  });

  it("caps the reserve at a fraction of the window so a small one still measures", () => {
    // A flat 32,000 reserve would leave this window at zero and report unknown,
    // which would silently switch the feature off in exactly the setup that
    // exists to exercise it.
    expect(computeContextBudget({ contextLength: 6000, occupied: 5000 }))
      .toMatchInlineSnapshot(`
      {
        "occupied": 5000,
        "remaining": 0,
        "status": "exhausted",
        "usable": 4800,
      }
    `);
  });

  it("never reports negative headroom once the window is overspent", () => {
    expect(computeContextBudget({ contextLength: 200_000, occupied: 300_000 }))
      .toMatchInlineSnapshot(`
      {
        "occupied": 300000,
        "remaining": 0,
        "status": "exhausted",
        "usable": 168000,
      }
    `);
  });

  it("treats a shrunken development window as a real one, so the path is reachable cheaply", () => {
    expect(
      computeContextBudget({
        contextLength: 8000,
        occupied: 7000,
        reserveTokens: 1000,
      }),
    ).toMatchInlineSnapshot(`
      {
        "occupied": 7000,
        "remaining": 0,
        "status": "exhausted",
        "usable": 7000,
      }
    `);
  });
});

describe("contextOccupancyFromMessages", () => {
  const assistant = (inputTokens: number | undefined) =>
    ({
      metadata: {
        usage:
          inputTokens === undefined
            ? undefined
            : {
                inputTokenDetails: {},
                inputTokens,
                outputTokenDetails: {},
              },
      },
      parts: [],
      role: "assistant",
    }) as unknown as SessionMessage.WithParts;

  const user = () =>
    ({
      metadata: {},
      parts: [],
      role: "user",
    }) as unknown as SessionMessage.WithParts;

  it("returns nothing for a session the model has not answered yet", () => {
    expect(contextOccupancyFromMessages([user()])).toBeUndefined();
  });

  it("reads the newest assistant turn rather than summing the session", () => {
    // Summing would give 180,000, which is roughly the prefix counted once per
    // turn and would trip a 200k window that is barely half spent.
    expect(
      contextOccupancyFromMessages([
        user(),
        assistant(20_000),
        user(),
        assistant(60_000),
        user(),
        assistant(100_000),
      ]),
    ).toBe(100_000);
  });

  it("falls back past a turn the provider never counted", () => {
    expect(
      contextOccupancyFromMessages([
        user(),
        assistant(60_000),
        user(),
        assistant(undefined),
      ]),
    ).toBe(60_000);
  });

  it("ignores a NaN token count rather than propagating it", () => {
    expect(
      contextOccupancyFromMessages([
        user(),
        assistant(60_000),
        user(),
        assistant(Number.NaN),
      ]),
    ).toBe(60_000);
  });
});
