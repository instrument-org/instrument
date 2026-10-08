import {
  type AccountCheck,
  describeResetTime,
  type PlanReport,
  reportFromCheck,
  stepAfterConnect,
} from "@/client/components/onboarding/setup/way-in-routing";
import { describe, expect, it } from "vitest";

describe("reportFromCheck", () => {
  it.each([
    { check: { state: "ready" }, expected: { kind: "paid" } },
    {
      check: { plan: "free", state: "not-eligible" },
      expected: { kind: "no-paid-plan" },
    },
    {
      check: { resetsAt: "2026-10-08T22:40:00.000Z", state: "out-of-usage" },
      expected: {
        kind: "out-of-usage",
        resetsAt: "2026-10-08T22:40:00.000Z",
      },
    },
    { check: { state: "signed-out" }, expected: { kind: "could-not-connect" } },
    {
      check: { message: "offline", state: "unknown" },
      expected: { kind: "could-not-connect" },
    },
  ] satisfies { check: AccountCheck; expected: PlanReport }[])(
    "reads $check.state",
    ({ check, expected }) => {
      expect(reportFromCheck(check)).toEqual(expected);
    },
  );
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
