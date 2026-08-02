import { describe, expect, it } from "vitest";

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
