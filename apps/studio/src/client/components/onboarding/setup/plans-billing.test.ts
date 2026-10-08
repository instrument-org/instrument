import { type RPCOutput } from "@/client/rpc/client";
import { describe, expect, it } from "vitest";

import {
  meterSteps,
  readBetaOffer,
  trialEndDate,
  welcomeBackNext,
} from "./plans-billing";

type Offer = RPCOutput["billing"]["offer"];
type Status = RPCOutput["billing"]["status"];

const PLAN = {
  allowance: { multiple: 1, windows: [] },
  description: null,
  features: [],
  key: "standard",
  name: "Instrument",
  price: { currency: "usd", interval: "month", unitAmount: 1000 },
} satisfies Offer["plans"][number];

const OFFER = {
  offerVersion: "v",
  plans: [PLAN],
  trial: { available: true, cardRequired: false, days: 7 },
} satisfies Offer;

describe("readBetaOffer", () => {
  it.each([
    { expected: null, name: "no offer", offer: undefined },
    { expected: null, name: "no beta field", offer: OFFER },
    { expected: null, name: "beta null", offer: { ...OFFER, beta: null } },
    {
      expected: { months: 3, plan: "plus" },
      name: "beta offered",
      offer: { ...OFFER, beta: { months: 3, plan: "plus" } },
    },
  ])("$name", ({ expected, offer }) => {
    expect(readBetaOffer(offer)).toEqual(expected);
  });
});

describe("welcomeBackNext", () => {
  it.each([
    {
      beta: { months: 3, plan: "plus" },
      expected: "beta-offer",
      isSignedIn: true,
    },
    {
      beta: { months: 3, plan: "plus" },
      expected: "beta-offer",
      isSignedIn: false,
    },
    { beta: null, expected: "plans", isSignedIn: true },
    { beta: null, expected: "welcome", isSignedIn: false },
  ])(
    "signed in $isSignedIn, beta $beta.plan: $expected",
    ({ beta, expected, isSignedIn }) => {
      expect(welcomeBackNext({ beta, isSignedIn })).toBe(expected);
    },
  );
});

describe("trialEndDate", () => {
  const now = new Date("2026-10-04T12:00:00Z");
  const trialStatus = (trial: Status["trial"]): Status => ({
    canSubscribe: true,
    plan: "trial",
    trial,
    windows: [],
  });

  it.each([
    {
      expected: "2026-10-11T12:00:00.000Z",
      name: "no status counts days from now",
      status: undefined,
    },
    {
      expected: "2026-10-09T08:00:00.000Z",
      name: "a running trial keeps billing's date",
      status: trialStatus({
        endsAt: "2026-10-09T08:00:00Z",
        state: "active",
      }),
    },
    {
      expected: "2026-10-11T12:00:00.000Z",
      name: "a trial not started yet counts days from now",
      status: trialStatus({ state: "available" }),
    },
  ])("$name", ({ expected, status }) => {
    expect(trialEndDate({ days: 7, now, status }).toISOString()).toBe(expected);
  });
});

describe("meterSteps", () => {
  it.each([
    [0.5, 1],
    [1, 1],
    [2, 2],
    [4, 4],
    [10, 4],
  ])("multiple %d fills %d", (multiple, expected) => {
    expect(meterSteps({ ...PLAN, allowance: { multiple, windows: [] } })).toBe(
      expected,
    );
  });
});
