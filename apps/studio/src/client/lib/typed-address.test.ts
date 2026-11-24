import { describe, expect, it } from "vitest";

import { typedAddress } from "./typed-address";

describe("typedAddress", () => {
  it.each([
    ["example.com", "https://example.com/", "example.com"],
    ["  example.com  ", "https://example.com/", "example.com"],
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
    ["localhost", "http://localhost/", "localhost"],
    ["localhost:3000", "http://localhost:3000/", "localhost:3000"],
    ["127.0.0.1:3000", "http://127.0.0.1:3000/", "127.0.0.1:3000"],
    ["foo.localhost", "http://foo.localhost/", "foo.localhost"],
    ["myserver:8080", "https://myserver:8080/", "myserver:8080"],
    [
      "file:///Users/mac-user/wireframes/new%20tab.html?frame=3",
      "file:///Users/mac-user/wireframes/new%20tab.html?frame=3",
      "/Users/mac-user/wireframes/new tab.html?frame=3",
    ],
  ])("reads %s as an address", (words, url, shown) => {
    expect(typedAddress(words)).toEqual({ kind: "page", shown, url });
  });

  it.each([
    ["node.js", "https://node.js/", "node.js"],
    ["foo.zzzzz", "https://foo.zzzzz/", "foo.zzzzz"],
    ["node.js/docs", "https://node.js/docs", "node.js/docs"],
  ])("doubts the host of %s", (words, url, shown) => {
    expect(typedAddress(words)).toEqual({
      doubt: "host",
      kind: "page",
      shown,
      url,
    });
  });

  it.each([
    ["ftp://example.com", "ftp://example.com/"],
    ["chrome://extensions", "chrome://extensions"],
  ])("doubts the scheme of %s", (words, url) => {
    expect(typedAddress(words)).toEqual({
      doubt: "scheme",
      kind: "page",
      shown: words,
      url,
    });
  });

  it.each([
    ["instrument://chat/2026-10-01-roofer"],
    ["  instrument://settings/general  "],
    ["instrument://file/Users/mac-user/Documents/"],
  ])("reads %s as the app's own address", (words) => {
    expect(typedAddress(words)).toEqual({
      address: words.trim(),
      kind: "app",
    });
  });

  it.each([
    [""],
    ["hello"],
    ["git"],
    ["v1.2"],
    ["Compare zendesk.com/pricing with our plans"],
    ["example.com please"],
    ["someone@example.com"],
    ["mailto:someone@example.com"],
    ["https://"],
    ["instrument://chat/2026-10-01-roofer and more"],
  ])("reads %j as no address", (words) => {
    expect(typedAddress(words)).toBeUndefined();
  });
});
