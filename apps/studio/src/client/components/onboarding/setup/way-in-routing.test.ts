import {
  claudePlanReport,
  describeResetTime,
  stepAfterConnect,
} from "@/client/components/onboarding/setup/way-in-routing";
import { describe, expect, it } from "vitest";

describe("claudePlanReport", () => {
  it.each([
    {
      expected: "paid",
      input: { plan: "max", signedInToPlan: true, usage: null },
      name: "a paid plan with no usage read",
    },
    {
      expected: "no-paid-plan",
      input: { plan: undefined, signedInToPlan: false, usage: null },
      name: "an API key sign-in",
    },
    {
      expected: "no-paid-plan",
      input: { plan: "free", signedInToPlan: true, usage: null },
      name: "a free plan",
    },
    {
      expected: "paid",
      input: {
        plan: "pro",
        signedInToPlan: true,
        usage: [{ resetsAt: undefined, used: 99 }],
      },
      name: "a plan with usage left",
    },
  ])("reads $name as $expected", ({ expected, input }) => {
    expect(claudePlanReport(input).kind).toBe(expected);
  });

  it("waits for the last spent window to start over", () => {
    expect(
      claudePlanReport({
        plan: "pro",
        signedInToPlan: true,
        usage: [
          { resetsAt: "2026-10-08T22:40:00.000Z", used: 100 },
          { resetsAt: "2026-10-12T09:00:00.000Z", used: 100 },
          { resetsAt: "2026-10-30T09:00:00.000Z", used: 40 },
        ],
      }),
    ).toMatchInlineSnapshot(`
      {
        "kind": "out-of-usage",
        "resetsAt": "2026-10-12T09:00:00.000Z",
      }
    `);
  });
});

describe("stepAfterConnect", () => {
  it.each([
    { expected: "free-account", kind: "paid" },
    { expected: "no-paid-plan", kind: "no-paid-plan" },
  ] as const)("sends $kind to $expected", ({ expected, kind }) => {
    expect(
      stepAfterConnect({ provider: "chatgpt", report: { kind } }).step,
    ).toBe(expected);
  });

  it("marks setup out of usage", () => {
    expect(
      stepAfterConnect({
        provider: "claude",
        report: { kind: "out-of-usage", resetsAt: undefined },
      }),
    ).toMatchInlineSnapshot(`
      {
        "answers": {
          "connectTrouble": {
            "provider": "claude",
            "reason": "out-of-usage",
            "resetsAt": undefined,
          },
          "isOutOfUsage": true,
        },
        "step": "out-of-usage",
      }
    `);
  });
});

describe("describeResetTime", () => {
  const now = new Date(2026, 9, 8, 11, 0);
  it.each([
    { at: new Date(2026, 9, 8, 15, 40), expected: "3:40 PM" },
    { at: new Date(2026, 9, 10, 9, 5), expected: "Saturday at 9:05 AM" },
    { at: new Date(2026, 9, 20, 9, 5), expected: "October 20" },
  ])("says $expected", ({ at, expected }) => {
    expect(
      describeResetTime(at.toISOString(), { locale: "en-US", now }).replaceAll(
        /\s/g,
        " ",
      ),
    ).toBe(expected);
  });
});
