import { describe, expect, it } from "vitest";

import { resolveUrlOrSearch } from "./resolve-url-or-search";

describe("resolveUrlOrSearch", () => {
  it.each([
    // Empty / whitespace-only input has nothing to navigate to.
    { expected: undefined, input: "" },
    { expected: undefined, input: "   " },

    // Explicit scheme or about: page is loaded verbatim.
    { expected: "https://example.com/path", input: "https://example.com/path" },
    { expected: "http://example.com", input: "http://example.com" },
    { expected: "file:///Users/x/f.txt", input: "file:///Users/x/f.txt" },
    { expected: "ftp://host/x", input: "ftp://host/x" },
    { expected: "about:blank", input: "about:blank" },

    // Bare hostnames get https:// once the TLD validates against the PSL.
    { expected: "https://openai.com", input: "openai.com" },
    { expected: "https://github.com", input: "github.com" },
    { expected: "https://a.b.co.uk", input: "a.b.co.uk" },
    { expected: "https://site.io", input: "site.io" },
    // A registered private suffix (github.io) counts as a host.
    { expected: "https://user.github.io", input: "user.github.io" },
    // A path/query after a real host doesn't turn it into a search.
    { expected: "https://reddit.com/r/all", input: "reddit.com/r/all" },

    // Loopback / local hosts speak http, including a bound-all dev address.
    { expected: "http://localhost:3000", input: "localhost:3000" },
    { expected: "http://127.0.0.1", input: "127.0.0.1" },
    { expected: "http://0.0.0.0:5173", input: "0.0.0.0:5173" },
    { expected: "http://app.localhost", input: "app.localhost" },

    // Non-loopback IP literals and explicit ports navigate over https.
    { expected: "https://192.168.1.5:8080", input: "192.168.1.5:8080" },
    { expected: "https://myserver:3000", input: "myserver:3000" },

    // Anything that isn't host-shaped falls back to a web search.
    {
      expected: "https://www.google.com/search?q=cats",
      input: "cats",
    },
    {
      expected: "https://www.google.com/search?q=how%20to%20make%20bread",
      input: "how to make bread",
    },
    // A period isn't enough: whitespace and unknown TLDs both route to search.
    {
      expected: "https://www.google.com/search?q=node.js%20tutorial",
      input: "node.js tutorial",
    },
    {
      expected: "https://www.google.com/search?q=foo.zzzzz",
      input: "foo.zzzzz",
    },
    {
      expected: "https://www.google.com/search?q=stackoverflow.com%20questions",
      input: "stackoverflow.com questions",
    },
    // Leading/trailing whitespace is trimmed before routing.
    {
      expected: "https://openai.com",
      input: "  openai.com  ",
    },
  ])("$input -> $expected", ({ expected, input }) => {
    expect(resolveUrlOrSearch(input)).toBe(expected);
  });
});
