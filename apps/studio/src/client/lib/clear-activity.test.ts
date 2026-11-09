import { describe, expect, it } from "vitest";

import {
  activityClearedMessage,
  requestsDetail,
  thingsDetail,
} from "./clear-activity";

describe("clearing activity", () => {
  it.each([
    [0, "Nothing", "Nothing"],
    [1, "1 thing", "1 request made on this computer"],
    [14, "14 things", "14 requests made on this computer"],
  ])("says %i in each box's detail line", (count, things, requests) => {
    expect(thingsDetail(count)).toBe(things);
    expect(requestsDetail(count)).toBe(requests);
  });

  it.each([
    [true, false, "hour", "Cleared your activity from the last hour."],
    [true, false, "all", "Cleared all your activity."],
    [false, true, "hour", "Cleared your AI requests from the last hour."],
    [false, true, "all", "Cleared all your AI requests."],
    [
      true,
      true,
      "week",
      "Cleared your activity and AI requests from the last 7 days.",
    ],
    [true, true, "all", "Cleared all your activity and AI requests."],
  ] as const)(
    "toasts activity %s and requests %s from %s",
    (actions, requests, range, message) => {
      expect(activityClearedMessage({ actions, range, requests })).toBe(
        message,
      );
    },
  );
});
