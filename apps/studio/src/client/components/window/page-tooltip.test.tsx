import { describe, expect, it } from "vitest";

import { readableAddress } from "./page-tooltip";

describe("readableAddress", () => {
  it.each([
    ["https://linear.app/", "linear.app"],
    ["https://linear.app/team/my-issues/", "linear.app/team/my-issues"],
    [
      "https://linear.app/oauth/authorize?client_id=x&state=y",
      "linear.app/oauth/authorize",
    ],
    ["https://example.com/caf%C3%A9#top", "example.com/café"],
    ["https://example.com/100%", "example.com/100%"],
    ["not a url", "not a url"],
  ])("%s", (url, expected) => {
    expect(readableAddress(url)).toBe(expected);
  });
});
