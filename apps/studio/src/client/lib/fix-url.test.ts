import { describe, expect, it } from "vitest";

import { fixURL } from "./fix-url";

const BASE = "https://api.cloudflare.com/client/v4/accounts/abc/ai/v1";

describe("fixURL", () => {
  it.each([
    ["a plain address", BASE],
    ["a trailing slash", `${BASE}/`],
    ["no scheme", "api.cloudflare.com/client/v4/accounts/abc/ai/v1"],
    ["a Markdown link", `[${BASE}](${BASE})`],
    [
      "a Markdown link with a scheme typed in front",
      `https://[${BASE}](${BASE}`,
    ],
    ["a scheme typed twice", `https://${BASE}`],
    ["angle brackets", `<${BASE}>`],
    ["surrounding whitespace", `  ${BASE}\n`],
  ])("keeps one address from %s", (_, input) => {
    expect(fixURL(input)).toBe(BASE);
  });

  it("keeps a local http address as typed", () => {
    expect(fixURL("http://localhost:11434/v1/")).toBe(
      "http://localhost:11434/v1",
    );
  });

  it("leaves an empty field empty", () => {
    expect(fixURL("   ")).toBe("");
  });
});
