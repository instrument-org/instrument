import { describe, expect, it } from "vitest";

import { typedTextRuns } from "./agent-browser-typed-text";

describe("typedTextRuns", () => {
  it.each([
    [["type", "@e1", "hello"]],
    [["type", "@e1", "query\n"]],
    [["keyboard", "type", "done\n\n"]],
    [["keyboard", "inserttext", "a\nb"]],
    [["fill", "@e1", "a\nb"]],
    [["press", "Enter"]],
    [["type", "@e1", "a\nb", "--delay", "fast"]],
  ])("leaves %j as written", (args) => {
    expect(typedTextRuns(args)).toBeUndefined();
  });

  it("inserts a typed paragraph break in one piece after focusing the field", () => {
    expect(typedTextRuns(["type", "@e5", "First.\n\nSecond."]))
      .toMatchInlineSnapshot(`
      [
        [
          "focus",
          "@e5",
        ],
        [
          "keyboard",
          "inserttext",
          "First.

      Second.",
        ],
      ]
    `);
  });

  it("keeps a trailing line break as Enter, once per break", () => {
    expect(
      typedTextRuns(["keyboard", "type", "one\r\ntwo\r\n\n"]),
    ).toStrictEqual([
      ["keyboard", "inserttext", "one\ntwo"],
      ["press", "Enter"],
      ["press", "Enter"],
    ]);
  });

  it("fills a cleared field and drops the keystroke delay", () => {
    expect(
      typedTextRuns(["type", "#msg", "a\nb", "--clear", "--delay", "20"]),
    ).toStrictEqual([["fill", "#msg", "a\nb"]]);
  });

  it("reads the text as the CLI does, words joined and everything after -- as text", () => {
    expect(
      typedTextRuns(["type", "@e1", "a\nb", "c", "--", "--clear"]),
    ).toStrictEqual([
      ["focus", "@e1"],
      ["keyboard", "inserttext", "a\nb c --clear"],
    ]);
  });

  it("keeps the invocation's global flags on every run", () => {
    expect(
      typedTextRuns(["--json", "type", "@e1", "a\nb\n", "--session", "s"]),
    ).toStrictEqual([
      ["--json", "--session", "s", "focus", "@e1"],
      ["--json", "--session", "s", "keyboard", "inserttext", "a\nb"],
      ["--json", "--session", "s", "press", "Enter"],
    ]);
  });
});
