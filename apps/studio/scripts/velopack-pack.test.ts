import { describe, expect, it } from "vitest";

import { channelsFor } from "./velopack-pack";

describe("channelsFor", () => {
  it.each([
    ["2.0.1", ["latest", "beta", "alpha"]],
    ["2.0.0-beta.111", ["beta", "alpha"]],
    ["2.1.0-alpha.3", ["alpha"]],
  ])("releases %s on %j", (version, channels) => {
    expect(channelsFor(version)).toEqual(channels);
  });
});
