import { describe, expect, it } from "vitest";

import { normalizeReplyBlocks } from "./normalize-reply-blocks";

const TIMELINE = `2 Aug: Leak found
13 Aug: Plumber came`;

describe("normalizeReplyBlocks", () => {
  it("leaves a reply with no block alone", () => {
    const text = "Plain words.\n\n- a list\n";
    expect(normalizeReplyBlocks(text)).toBe(text);
  });

  it("keeps a block's own fence", () => {
    const text = `\`\`\`timeline\n${TIMELINE}\n\`\`\``;
    expect(normalizeReplyBlocks(text)).toBe(text);
  });

  it("names a fence in another case for its block and moves its attributes into the header", () => {
    expect(
      normalizeReplyBlocks('```Message to="Dana" kind=email\nHi Dana,\n```'),
    ).toMatchInlineSnapshot(`
        "\`\`\`message
        to: Dana
        kind: email
        Hi Dana,
        \`\`\`"
      `);
  });

  it("leaves a diff fence as code", () => {
    const text = "```diff\n- a\n+ b\n```";
    expect(normalizeReplyBlocks(text)).toBe(text);
  });

  it.each([
    ':::message{to="Dana"}',
    "::: message {to=Dana}",
    ":::message to=Dana",
    ":::message{to=Dana, color=red}",
    ":::message{.wide #x to='Dana'}",
    '::::MESSAGE{to="Dana"}',
  ])("reads the directive %s", (opener) => {
    expect(
      normalizeReplyBlocks(`A draft.\n\n${opener}\nHi Dana,\n::::\n\nDone.`),
    ).toBe("A draft.\n\n```message\nto: Dana\nHi Dana,\n```\n\nDone.");
  });

  it.each(['<message to="Dana">', "<MESSAGE to='Dana'>", "<message to=Dana>"])(
    "reads the tag %s",
    (opener) => {
      expect(normalizeReplyBlocks(`${opener}\nHi Dana,\n</message>`)).toBe(
        "```message\nto: Dana\nHi Dana,\n```",
      );
    },
  );

  it("reads a tag's words on its own line and a closer at the end of the last line", () => {
    expect(
      normalizeReplyBlocks(
        "<timeline>2 Aug: Leak found\n13 Aug: Plumber came</timeline>\nAfter.",
      ),
    ).toMatchInlineSnapshot(`
      "\`\`\`timeline
      2 Aug: Leak found
      13 Aug: Plumber came
      \`\`\`
      After."
    `);
  });

  it("takes a bare attribute as true and drops keys the block does not read", () => {
    expect(
      normalizeReplyBlocks(
        '<message to="Dana" urgent color=red>\nHi Dana,\n</message>',
      ),
    ).toMatchInlineSnapshot(`
      "\`\`\`message
      to: Dana
      Hi Dana,
      \`\`\`"
    `);
  });

  it.each([
    ["an unknown directive", ":::note\nWords.\n:::"],
    ["an unknown tag", "<details>\nWords.\n</details>"],
    ["a tag inside a sentence", 'Use <message to="x"> here.'],
    ["a closer with nothing open", "Words.\n:::\n</timeline>"],
    [
      "a directive inside a code fence",
      "```md\n:::timeline\n2 Aug: a\n:::\n```",
    ],
    [
      "a directive inside an inline code span",
      "Write `this\n:::timeline\nthat` inline.",
    ],
    ["an indented directive", "    :::timeline\n    2 Aug: a"],
  ])("leaves %s as written", (_, text) => {
    expect(normalizeReplyBlocks(text)).toBe(text);
  });

  it("keeps a block still open at the end of the text open", () => {
    expect(normalizeReplyBlocks(":::timeline\n2 Aug: Leak found\n13 Au")).toBe(
      "```timeline\n2 Aug: Leak found\n13 Au",
    );
  });

  it("closes a block whose closer was left out when the next one opens", () => {
    expect(
      normalizeReplyBlocks(
        ":::timeline\n2 Aug: a\n:::message{to=Dana}\nHi\n:::",
      ),
    ).toMatchInlineSnapshot(`
      "\`\`\`timeline
      2 Aug: a
      \`\`\`
      \`\`\`message
      to: Dana
      Hi
      \`\`\`"
    `);
  });

  it("opens with a longer fence when the body holds a fence", () => {
    expect(
      normalizeReplyBlocks(
        "<message kind=email to=Dana>\nRun this:\n```sh\nls\n```\n</message>",
      ),
    ).toMatchInlineSnapshot(`
      "\`\`\`\`message
      kind: email
      to: Dana
      Run this:
      \`\`\`sh
      ls
      \`\`\`
      \`\`\`\`"
    `);
  });

  it("puts a message's attributes inside the front matter it already has", () => {
    expect(
      normalizeReplyBlocks(
        ":::message{to=Dana}\n---\nmessage: email\n---\nHi Dana,\n:::",
      ),
    ).toMatchInlineSnapshot(`
      "\`\`\`message
      ---
      to: Dana
      message: email
      ---
      Hi Dana,
      \`\`\`"
    `);
  });

  it("holds back a line still arriving that may open or close a block", () => {
    const cases = {
      "a closer": ":::timeline\n2 Aug: a\n::",
      "a directive's attributes": 'Here:\n\n:::message{to="Da',
      "a directive's colons": "Here:\n\n:::tim",
      "a tag's attributes": '<message to="Da',
      "a tag's name": "Here:\n\n<time",
      "words that open no block": "Here:\n\n<b>bold",
    };
    expect(
      Object.fromEntries(
        Object.entries(cases).map(([name, text]) => [
          name,
          normalizeReplyBlocks(text, { streaming: true }),
        ]),
      ),
    ).toMatchInlineSnapshot(`
      {
        "a closer": "\`\`\`timeline
      2 Aug: a",
        "a directive's attributes": "Here:
      ",
        "a directive's colons": "Here:
      ",
        "a tag's attributes": "",
        "a tag's name": "Here:
      ",
        "words that open no block": "Here:

      <b>bold",
      }
    `);
  });

  it("draws a settled reply's last line however it reads", () => {
    expect(normalizeReplyBlocks("Ratio 3:2\n:::", { streaming: false })).toBe(
      "Ratio 3:2\n:::",
    );
  });

  it("gives a final text the same result whether or not it streamed", () => {
    const text = `:::timeline\n${TIMELINE}\n:::\n`;
    expect(normalizeReplyBlocks(text, { streaming: true })).toBe(
      normalizeReplyBlocks(text),
    );
  });

  it.each([
    ':::options{pick="Pinecrest"}',
    ":::compare pick=Pinecrest",
    "<comparison pick=Pinecrest>",
    '```Compare pick="Pinecrest"',
  ])("reads the options block opened by %s", (opener) => {
    const closer = opener.startsWith("<")
      ? "</comparison>"
      : opener.startsWith("`")
        ? "```"
        : ":::";
    expect(
      normalizeReplyBlocks(`${opener}\n| a | b |\n|---|---|\n${closer}`),
    ).toBe("```options\npick: Pinecrest\n| a | b |\n|---|---|\n```");
  });

  it("titles a directive by the words after its name", () => {
    expect(
      normalizeReplyBlocks(
        ":::chart Monthly spend\n| a | b |\n|---|---|\n| x | 1 |\n:::",
      ),
    ).toMatchInlineSnapshot(`
      "\`\`\`chart
      title: Monthly spend
      | a | b |
      |---|---|
      | x | 1 |
      \`\`\`"
    `);
  });

  it("reads a numbers block by an alias, its first line on the tag's own", () => {
    expect(
      normalizeReplyBlocks(
        "<stats>Revenue: $48,200\nClients: 7</stats>\nAfter.",
      ),
    ).toMatchInlineSnapshot(`
      "\`\`\`numbers
      Revenue: $48,200
      Clients: 7
      \`\`\`
      After."
    `);
  });

  it("ends a block whose closer was left out at its first blank line, once finished", () => {
    const cases = {
      "a block with a fence of its own":
        "<message to=Dana>\nRun:\n```sh\nls\n\nls -a\n```\n\nThe rest of the reply.",
      "a directive":
        ":::timeline\n2 Aug: Leak found\n13 Aug: Plumber came\n\nThe rest of the reply.\n\n:::message\nHi\n:::",
      "a tag":
        "<timeline>\n2 Aug: Leak found\n13 Aug: Plumber came\n\nThe rest of the reply.",
    };
    expect(
      Object.fromEntries(
        Object.entries(cases).map(([name, text]) => [
          name,
          normalizeReplyBlocks(text),
        ]),
      ),
    ).toMatchInlineSnapshot(`
      {
        "a block with a fence of its own": "\`\`\`\`message
      to: Dana
      Run:
      \`\`\`sh
      ls

      ls -a
      \`\`\`
      \`\`\`\`

      The rest of the reply.",
        "a directive": "\`\`\`timeline
      2 Aug: Leak found
      13 Aug: Plumber came
      \`\`\`

      The rest of the reply.

      \`\`\`message
      Hi
      \`\`\`",
        "a tag": "\`\`\`timeline
      2 Aug: Leak found
      13 Aug: Plumber came
      \`\`\`

      The rest of the reply.",
      }
    `);
  });

  it("keeps an unknown directive's closer inside a block for that directive", () => {
    expect(
      normalizeReplyBlocks(
        ":::message{to=Dana}\nHi Dana,\n:::note\nA side note.\n:::\nSee you.\n:::\nAfter.",
      ),
    ).toMatchInlineSnapshot(`
      "\`\`\`message
      to: Dana
      Hi Dana,
      :::note
      A side note.
      :::
      See you.
      \`\`\`
      After."
    `);
  });

  it("keeps a block without its closer open while the text arrives", () => {
    expect(
      normalizeReplyBlocks(":::timeline\n2 Aug: a\n\n13 Aug: b\n", {
        streaming: true,
      }),
    ).toBe("```timeline\n2 Aug: a\n\n13 Aug: b\n");
  });
});
