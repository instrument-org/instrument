import { describe, expect, it } from "vitest";

import { getFaviconUrl } from "./favicon-url";

/** What the main process is actually asked for. */
function requestedHost(url: string): string {
  return decodeURIComponent(new URL(getFaviconUrl(url)).pathname.slice(1));
}

describe("getFaviconUrl", () => {
  // Every link in a message draws one of these on render, so what is in the
  // address is what the icon lookup is told about every link anyone is shown.
  it("asks for the host and nothing else", () => {
    expect(
      requestedHost("https://example.com/browse/SEC-4412?token=abc#frag"),
    ).toBe("example.com");
  });

  it("collapses two links to one host onto one request", () => {
    expect(getFaviconUrl("https://example.com/one")).toBe(
      getFaviconUrl("http://example.com:8080/two"),
    );
  });

  it("passes a source that is not a URL through as written", () => {
    expect(requestedHost("not a url")).toBe("not a url");
  });
});
