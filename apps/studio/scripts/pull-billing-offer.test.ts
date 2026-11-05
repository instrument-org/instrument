import { describe, expect, it } from "vitest";

import {
  type BillingOffer,
  BillingOfferSchema,
} from "../src/electron-main/platform-api/billing-offer";
import snapshot from "../src/shared/billing-offer-snapshot.json";
import { nextSnapshot } from "./pull-billing-offer";

const offer = (
  offerVersion: string,
  trial: BillingOffer["trial"],
): BillingOffer => ({ offerVersion, plans: [], trial });
const TRIAL = { cardRequired: false, days: 7 };

describe("the shipped offer copy", () => {
  it("reads under the contract", () => {
    expect(BillingOfferSchema.safeParse(snapshot).error).toBeUndefined();
  });
});

describe("nextSnapshot", () => {
  it("takes the server's answer", () => {
    const answer = offer("new", { cardRequired: true, days: 14 });
    expect(nextSnapshot(answer, offer("old", TRIAL))).toBe(answer);
  });

  it("keeps the trial it has while the server offers none", () => {
    expect(nextSnapshot(offer("new", null), offer("old", TRIAL))).toEqual(
      offer("new", TRIAL),
    );
  });

  it("stays without a trial once the copy has none", () => {
    expect(nextSnapshot(offer("new", null), offer("old", null))).toEqual(
      offer("new", null),
    );
  });
});
