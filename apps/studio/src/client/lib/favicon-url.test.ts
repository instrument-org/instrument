import { describe, expect, it } from "vitest";

import { getFaviconUrl } from "./favicon-url";

/** What the lookup service is actually asked for. */
function requestedUrl(url: string): null | string {
  return new URL(getFaviconUrl(url)).searchParams.get("url");
}

describe("getFaviconUrl", () => {
  // Every link in a message draws one of these on render, so what is in the
  // query is what leaves the machine for every link anyone is shown.
  it("asks for the origin and nothing else", () => {
    expect(
      requestedUrl("https://example.com/browse/SEC-4412?token=abc#frag"),
    ).toBe("https://example.com");
  });

  it("keeps a port, which is part of the origin", () => {
    expect(requestedUrl("http://localhost:5173/a/b")).toBe(
      "http://localhost:5173",
    );
  });

  it("collapses two links to one host onto one request", () => {
    expect(getFaviconUrl("https://example.com/one")).toBe(
      getFaviconUrl("https://example.com/two"),
    );
  });

  it("passes a source that is not a URL through as written", () => {
    expect(requestedUrl("not a url")).toBe("not a url");
  });
});
