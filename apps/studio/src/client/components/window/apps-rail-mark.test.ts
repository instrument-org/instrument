import { describe, expect, it } from "vitest";

import { appsSignedOutSince } from "./apps-rail-mark";

const lost = { connectedAt: 10, status: "needs-sign-in", updatedAt: 50 };

describe("appsSignedOutSince", () => {
  it.each([
    [
      "a sign-in lost since Apps was last shown",
      [{ connection: lost }],
      20,
      true,
    ],
    ["one lost before Apps was last shown", [{ connection: lost }], 60, false],
    [
      "an app that needs a sign-in it never had",
      [{ connection: { status: "needs-sign-in", updatedAt: 50 } }],
      20,
      false,
    ],
    [
      "an app the person declined",
      [{ connection: { connectedAt: 10, status: "declined", updatedAt: 50 } }],
      20,
      false,
    ],
    ["an app not tested yet", [{}], 20, false],
  ])("on %s", (_, apps, seenAt, expected) => {
    expect(appsSignedOutSince(apps, seenAt)).toBe(expected);
  });
});
