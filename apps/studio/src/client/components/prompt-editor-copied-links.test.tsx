import { describe, expect, it } from "vitest";

import { withCopiedLinks } from "./prompt-editor-links";

// What a copy from a page or a document puts on the clipboard: its plain
// words, and the same words as HTML with the links in them.
describe("withCopiedLinks", () => {
  it.each([
    [
      "a link in a sentence",
      "See the plans page for prices.",
      `See the <a href="https://zendesk.com/pricing">plans page</a> for prices.`,
      "See the [plans page](https://zendesk.com/pricing) for prices.",
    ],
    [
      "several links, each found after the last",
      "Zendesk and Intercom, then Zendesk again.",
      `<a href="https://zendesk.com">Zendesk</a> and <a href="https://intercom.com">Intercom</a>, then Zendesk again.`,
      "[Zendesk](https://zendesk.com) and [Intercom](https://intercom.com), then Zendesk again.",
    ],
    [
      "words spread over lines in the markup",
      "Read the plans page.",
      `Read the <a href="https://a.com">plans\n   page</a>.`,
      "Read the [plans page](https://a.com).",
    ],
    [
      "a link that is its own address",
      "Go to https://a.com now",
      `Go to <a href="https://a.com">https://a.com</a> now`,
      "Go to https://a.com now",
    ],
    [
      "a link to something that is not a page",
      "Mail me or run it",
      `<a href="mailto:a@b.co">Mail me</a> or <a href="javascript:alert(1)">run it</a>`,
      "Mail me or run it",
    ],
    [
      "a link whose words the plain copy does not have",
      "Plain words",
      `<a href="https://a.com">Other words</a>`,
      "Plain words",
    ],
    [
      "a copy with no links",
      "Just words",
      "<p>Just <b>words</b></p>",
      "Just words",
    ],
  ])("keeps %s", (_case, text, html, expected) => {
    expect(withCopiedLinks(text, html)).toBe(expected);
  });
});
