import { afterEach, describe, expect, it, vi } from "vitest";

import { containsMermaidFence, isMermaidLanguage } from "./mermaid";

// This module is the gate in front of a multi-megabyte chunk, so both halves of
// it are worth pinning: what counts as a diagram fence in raw markdown (which
// decides whether the chunk is fetched at all) and what counts as a diagram
// language on an already-parsed fence (which decides whether one is rendered).
//
// The two answer different questions and are deliberately not the same test:
// the sniff runs against text that is still arriving and errs toward fetching,
// while the language check runs against remark's own parse and has to be exact.

describe("containsMermaidFence", () => {
  it.each([
    ["a plain fence", "```mermaid\ngraph TD\n  A-->B\n```"],
    ["prose around it", "Here is a diagram:\n\n```mermaid\ngraph TD\n```\n"],
    ["a tilde fence", "~~~mermaid\ngraph TD\n~~~"],
    ["a longer fence", "````mermaid\ngraph TD\n````"],
    ["an upper-case info string", "```MERMAID\ngraph TD\n```"],
    ["an info string with trailing words", "```mermaid title=Flow\ngraph TD"],
    ["a space before the info string", "``` mermaid\ngraph TD"],
    // The whole point of the sniff is to start the download while the fence is
    // still streaming, so the opening line alone has to be enough.
    ["only the opening line", "```mermaid"],
    ["a half-written graph", "```mermaid\ngraph TD\n  A-->"],
    // Indented past CommonMark's three-space limit, which a fence nested in a
    // list reaches on its own. Over-fetching here costs one chunk; missing it
    // costs the reader a diagram that arrives late.
    ["a fence inside a list item", "- step one\n\n  ```mermaid\n  graph TD"],
    [
      "a deeply nested fence",
      "  - a\n    - b\n      ```mermaid\n      graph TD",
    ],
  ])("detects %s", (_case, markdown) => {
    expect(containsMermaidFence(markdown)).toBe(true);
  });

  it.each([
    ["prose that mentions mermaid", "We render diagrams with mermaid now."],
    ["inline code", "Use the `mermaid` fence for diagrams."],
    ["a different language whose body says mermaid", "```js\nmermaid();\n```"],
    ["a longer language that starts with mermaid", "```mermaidjs\ngraph TD"],
    ["a hyphenated language", "```mermaid-lite\ngraph TD"],
    ["a fence marker that is too short", "``mermaid``"],
    ["an empty document", ""],
  ])("does not detect %s", (_case, markdown) => {
    expect(containsMermaidFence(markdown)).toBe(false);
  });
});

describe("isMermaidLanguage", () => {
  it.each([
    ["mermaid", true],
    ["MERMAID", true],
    ["Mermaid", true],
    ["mermaidjs", false],
    ["mmd", false],
    ["js", false],
    ["", false],
  ])("%s -> %s", (language, expected) => {
    expect(isMermaidLanguage(language)).toBe(expected);
  });

  it("treats a fence with no language as not a diagram", () => {
    expect(isMermaidLanguage(undefined)).toBe(false);
  });
});

// The chunk is fetched over the network in production. Caching the promise is
// what stops every diagram on screen from fetching it separately — but caching
// a *rejected* one would mean a single dropped fetch left every fence in the
// session as a code block, unrecoverable short of restarting the app.
describe("renderMermaid chunk loading", () => {
  afterEach(() => {
    vi.doUnmock("mermaid");
    vi.resetModules();
  });

  const fakeMermaid = () => ({
    default: {
      initialize: vi.fn(),
      parse: vi.fn().mockResolvedValue(true),
      render: vi
        .fn()
        .mockImplementation((id: string) => ({ svg: `<svg id="${id}" />` })),
    },
  });

  it("fetches again after a failed load instead of caching the failure", async () => {
    let attempts = 0;
    vi.doMock("mermaid", () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("Failed to fetch dynamically imported module");
      }
      return fakeMermaid();
    });
    vi.resetModules();

    const { renderMermaid } = await import("./mermaid");
    const render = () => renderMermaid({ code: "graph TD", theme: "light" });

    // Vitest rewrites a throwing mock factory's message, so this asserts the
    // rejection rather than its text.
    await expect(render()).rejects.toThrow();
    // The whole point: the second diagram is not punished for the first
    // diagram's bad luck.
    await expect(render()).resolves.toContain("<svg");
    expect(attempts).toBe(2);
  });

  it("loads the chunk once when it succeeds", async () => {
    let attempts = 0;
    vi.doMock("mermaid", () => {
      attempts += 1;
      return fakeMermaid();
    });
    vi.resetModules();

    const { renderMermaid } = await import("./mermaid");
    await renderMermaid({ code: "graph TD", theme: "light" });
    await renderMermaid({ code: "graph LR", theme: "dark" });

    expect(attempts).toBe(1);
  });
});
