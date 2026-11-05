import { describe, expect, it } from "vitest";

import { OFFER_SNAPSHOT_OPTIONS } from "../lib/billing-offer-snapshot";
import { rpcClient } from "./client";

describe("rpcClient", () => {
  it("starts the offer from the snapshot, still asking the server", () => {
    expect(rpcClient.billing.offer.queryOptions()).toMatchObject({
      ...OFFER_SNAPSHOT_OPTIONS,
      networkMode: "online",
    });
  });
});
