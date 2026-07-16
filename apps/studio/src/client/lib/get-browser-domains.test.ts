import { describe, expect, it } from "vitest";

import { getBrowserDomains } from "./get-browser-domains";

describe("getBrowserDomains", () => {
  it("extracts unquoted, single-quoted, and double-quoted URLs", () => {
    expect(
      getBrowserDomains(
        `agent-browser open https://one.example && agent-browser open 'https://two.example/a' && agent-browser open "https://www.two.example/b"`,
      ),
    ).toEqual(["two.example", "one.example"]);
  });

  it("ignores malformed URL-like arguments", () => {
    expect(getBrowserDomains("agent-browser open https://")).toEqual([]);
  });
});
