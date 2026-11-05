import { describe, expect, it } from "vitest";

import { OFFER_FROM_BUILD } from "../lib/offer-from-build";
import { rpcClient } from "./client";

describe("rpcClient", () => {
  it("starts the offer from the build's copy, still asking the server", () => {
    expect(rpcClient.billing.offer.queryOptions()).toMatchObject({
      ...OFFER_FROM_BUILD,
      networkMode: "online",
    });
  });
});
