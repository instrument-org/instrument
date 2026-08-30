import { describe, expect, it } from "vitest";

import { type SessionMessage } from "../schemas/session/message";
import {
  computeContextBudget,
  contextOccupancyFromMessages,
} from "./context-budget";

/** The model being asked, in every case that is not about a switch. */
const MODEL = "model-being-asked";
const PREVIOUS_MODEL = "model-that-answered-earlier";

/** Occupancy as the model being asked reported it. */
const spent = (tokens: number, modelId: string = MODEL) => ({
  modelId,
  tokens,
});

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
    expect(
      computeContextBudget({
        contextLength,
        modelId: MODEL,
        occupancy: spent(occupied),
      }),
    ).toEqual({
      occupancySource: "none",
      occupied: 0,
      remaining: 0,
      status: "unknown",
      usable: 0,
    });
  });

  it("counts a fresh session with no reported usage as spending nothing", () => {
    expect(
      computeContextBudget({
        contextLength: 200_000,
        modelId: MODEL,
        occupancy: undefined,
      }),
    ).toMatchInlineSnapshot(`
      {
        "occupancySource": "none",
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
        computeContextBudget({
          contextLength: 200_000,
          modelId: MODEL,
          occupancy: spent(occupied),
        }).status,
      ).toBe(expected);
    },
  );

  it("subtracts the reserve so the model keeps room to answer", () => {
    expect(
      computeContextBudget({
        contextLength: 200_000,
        modelId: MODEL,
        occupancy: spent(10_000),
      }),
    ).toMatchInlineSnapshot(`
      {
        "occupancySource": "measured",
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
    expect(
      computeContextBudget({
        contextLength: 6000,
        modelId: MODEL,
        occupancy: spent(5000),
      }),
    ).toMatchInlineSnapshot(`
      {
        "occupancySource": "measured",
        "occupied": 5000,
        "remaining": 0,
        "status": "exhausted",
        "usable": 4800,
      }
    `);
  });

  it("never reports negative headroom once the window is overspent", () => {
    expect(
      computeContextBudget({
        contextLength: 200_000,
        modelId: MODEL,
        occupancy: spent(300_000),
      }),
    ).toMatchInlineSnapshot(`
      {
        "occupancySource": "measured",
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
        modelId: MODEL,
        occupancy: spent(7000),
        reserveTokens: 1000,
      }),
    ).toMatchInlineSnapshot(`
      {
        "occupancySource": "measured",
        "occupied": 7000,
        "remaining": 0,
        "status": "exhausted",
        "usable": 7000,
      }
    `);
  });

  describe("a count that came from a different model", () => {
    it("is reported as carried over rather than measured", () => {
      expect(
        computeContextBudget({
          contextLength: 200_000,
          modelId: MODEL,
          occupancy: spent(10_000, PREVIOUS_MODEL),
        }).occupancySource,
      ).toBe("carried-over");
    });

    it("still says what it says, and leaves acting on it to the caller", () => {
      // The number is a roomier model's, so held against this window it reads
      // as exhausted whether or not this model would agree. Saying so is what
      // gets the agent warned in time to write handoff notes; the source is
      // what stops a reset being taken on it.
      expect(
        computeContextBudget({
          contextLength: 200_000,
          modelId: MODEL,
          occupancy: spent(900_000, PREVIOUS_MODEL),
        }),
      ).toMatchInlineSnapshot(`
        {
          "occupancySource": "carried-over",
          "occupied": 900000,
          "remaining": 0,
          "status": "exhausted",
          "usable": 168000,
        }
      `);
    });
  });
});

describe("contextOccupancyFromMessages", () => {
  const assistant = (
    inputTokens: number | undefined,
    modelId: string = MODEL,
  ) =>
    ({
      metadata: {
        modelId,
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
    ).toEqual({ modelId: MODEL, tokens: 100_000 });
  });

  it("falls back past a turn the provider never counted", () => {
    expect(
      contextOccupancyFromMessages([
        user(),
        assistant(60_000),
        user(),
        assistant(undefined),
      ]),
    ).toEqual({ modelId: MODEL, tokens: 60_000 });
  });

  it("ignores a NaN token count rather than propagating it", () => {
    expect(
      contextOccupancyFromMessages([
        user(),
        assistant(60_000),
        user(),
        assistant(Number.NaN),
      ]),
    ).toEqual({ modelId: MODEL, tokens: 60_000 });
  });

  it("names the model that reported the count", () => {
    expect(
      contextOccupancyFromMessages([user(), assistant(60_000, PREVIOUS_MODEL)]),
    ).toEqual({ modelId: PREVIOUS_MODEL, tokens: 60_000 });
  });

  it("prefers the newest count over an older one from the model being asked", () => {
    // The older count is this model's, but it was measured before everything
    // since, so it describes a smaller history than the one that exists.
    expect(
      contextOccupancyFromMessages([
        user(),
        assistant(20_000),
        user(),
        assistant(90_000, PREVIOUS_MODEL),
      ]),
    ).toEqual({ modelId: PREVIOUS_MODEL, tokens: 90_000 });
  });
});
