import { describe, expect, it } from "vitest";

import { addressInMessage } from "./address-in-message";

describe("addressInMessage", () => {
  it.each([
    ["example.com", "https://example.com", "example.com"],
    ["  example.com  ", "https://example.com", "example.com"],
    [
      "https://www.zendesk.com/pricing/",
      "https://www.zendesk.com/pricing/",
      "zendesk.com/pricing",
    ],
    [
      "http://example.com/a?b=1",
      "http://example.com/a?b=1",
      "example.com/a?b=1",
    ],
    [
      "news.bbc.co.uk/sport",
      "https://news.bbc.co.uk/sport",
      "news.bbc.co.uk/sport",
    ],
    ["localhost:3000", "http://localhost:3000", "localhost:3000"],
  ])("reads %s as an address", (words, url, shown) => {
    expect(addressInMessage(words)).toEqual({ shown, url });
  });

  it.each([
    [""],
    ["hello"],
    ["Compare zendesk.com/pricing with our plans"],
    ["example.com please"],
    ["node.js"],
    ["foo.zzzzz"],
    ["ftp://example.com"],
    ["mailto:someone@example.com"],
    ["https://"],
  ])("reads %j as a message", (words) => {
    expect(addressInMessage(words)).toBeUndefined();
  });
});
