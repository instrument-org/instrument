import { describe, expect, it } from "vitest";

import { jsonEscaped, partText, snippetAround } from "./task-content-search";

/** A stored part, as superjson writes one into the blob column. */
function part(body: Record<string, unknown>): string {
  return JSON.stringify({ json: body, meta: {} });
}

describe("jsonEscaped", () => {
  it.each([
    ["wayfair", "wayfair"],
    ["touch id", "touch id"],
    ['say "hi"', 'say \\"hi\\"'],
    ["C:\\Users", "C:\\\\Users"],
    ["one\ntwo", "one\\ntwo"],
  ])("%j is stored as %j", (term, expected) => {
    expect(jsonEscaped(term)).toBe(expected);
  });
});

describe("partText", () => {
  it("reads what was said", () => {
    expect(
      partText(part({ text: "Opening the chair search", type: "text" })),
    ).toBe("Opening the chair search");
  });

  it("reads a blob as well as a string", () => {
    const blob = Buffer.from(part({ text: "from bytes", type: "text" }));
    expect(partText(new Uint8Array(blob))).toBe("from bytes");
  });

  // The measured noise: a search for "wayfair" ranked a skills reference above
  // the conversation that was about it, because the path was in a tool's input.
  it("ignores a part that only carries tool traffic", () => {
    expect(
      partText(
        part({
          input: { command: "agent-browser open https://wayfair.com" },
          type: "tool-bash",
        }),
      ),
    ).toBeUndefined();
  });

  it("ignores a body it cannot read", () => {
    expect(partText("not json at all")).toBeUndefined();
    expect(partText(undefined)).toBeUndefined();
    expect(partText(part({ type: "text" }))).toBeUndefined();
  });
});

describe("snippetAround", () => {
  it("keeps a lead-in and collapses the whitespace", () => {
    const text =
      "I looked at a lot of options and eventually found that the cheap small chair on Wayfair\nwas the best of them by a distance, so that is the one.";
    expect(snippetAround(text, text.indexOf("Wayfair"))).toMatchInlineSnapshot(
      `"…lly found that the cheap small chair on Wayfair was the best of them by a distance, so that is the one."`,
    );
  });

  it("does not lead with an ellipsis at the start", () => {
    expect(snippetAround("Wayfair was first", 0)).toBe("Wayfair was first");
  });
});
