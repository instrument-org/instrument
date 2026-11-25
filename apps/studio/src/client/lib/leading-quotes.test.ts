import { expect, it } from "vitest";

import { joinLeadingQuotes, splitLeadingQuotes } from "./leading-quotes";

it.each([
  { quotes: [], words: "Hello" },
  { quotes: ["One."], words: "Why?" },
  { quotes: ["One.", "Two.\n\nThree."], words: "Why?\n\n> typed\nlater" },
  { quotes: ["One."], words: "" },
])("reads back $quotes over $words", ({ quotes, words }) => {
  expect(splitLeadingQuotes(joinLeadingQuotes(quotes, words))).toEqual({
    quotes,
    words,
  });
});

it.each(["> one\nright under", "Hi\n\n> later", ">", "> ", ">tight"])(
  "leaves %j as words",
  (text) => {
    expect(splitLeadingQuotes(text)).toEqual({ quotes: [], words: text });
  },
);

it("reads a quote sent with nothing after it", () => {
  expect(splitLeadingQuotes("> One.")).toEqual({ quotes: ["One."], words: "" });
});
