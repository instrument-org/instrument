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
    [
      "file:///Users/mac-user/wireframes/new%20tab.html?frame=3",
      "file:///Users/mac-user/wireframes/new%20tab.html?frame=3",
      "/Users/mac-user/wireframes/new tab.html?frame=3",
    ],
  ])("reads %s as an address", (words, url, shown) => {
    expect(addressInMessage(words)).toEqual({ kind: "page", shown, url });
  });

  it.each([
    ["instrument://chat/2026-10-01-roofer"],
    ["  instrument://settings/general  "],
    ["instrument://file/Users/mac-user/Documents/"],
  ])("reads %s as the app's own address", (words) => {
    expect(addressInMessage(words)).toEqual({
      address: words.trim(),
      kind: "app",
    });
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
    ["instrument://chat/2026-10-01-roofer and more"],
  ])("reads %j as a message", (words) => {
    expect(addressInMessage(words)).toBeUndefined();
  });
});
