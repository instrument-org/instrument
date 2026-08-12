import { type SessionMessage, StoreId } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import { pathsNamedInMessage } from "./paths-named-in-message";

const sessionId = StoreId.newSessionId();
const messageId = StoreId.newMessageId();

function assistantSaying(...texts: string[]): SessionMessage.WithParts {
  return {
    id: messageId,
    metadata: { createdAt: new Date(0), sessionId },
    parts: texts.map((text) => ({
      metadata: {
        createdAt: new Date(0),
        id: StoreId.newPartId(),
        messageId,
        sessionId,
      },
      text,
      type: "text" as const,
    })),
    role: "assistant",
  } as unknown as SessionMessage.WithParts;
}

describe("pathsNamedInMessage", () => {
  it("counts a files fence", () => {
    const named = pathsNamedInMessage(
      assistantSaying("Here you go.\n\n```files\noutput/chart.png\n```"),
    );

    expect([...named]).toEqual(["output/chart.png"]);
  });

  it("counts a markdown link to a path", () => {
    const named = pathsNamedInMessage(
      assistantSaying("I saved [the chart](output/chart.png) for you."),
    );

    expect([...named]).toEqual(["output/chart.png"]);
  });

  // The renderer draws a chip for a link, not for a path in a sentence, so a
  // mention is not something already on screen.
  it("does not count a path merely mentioned in prose", () => {
    const named = pathsNamedInMessage(
      assistantSaying("I wrote the chart to output/chart.png."),
    );

    expect([...named]).toEqual([]);
  });

  it("ignores a link that leaves the app", () => {
    const named = pathsNamedInMessage(
      assistantSaying("See [the docs](https://example.com/chart.png)."),
    );

    expect([...named]).toEqual([]);
  });

  // The path the chip opens, so that the grid recognizes the file the reply
  // already showed. Percent decoding is the whole of the difference, and a
  // filename holding a bare percent sign is the case that used to throw.
  it.each([
    ["output/my%20chart.png", "output/my chart.png"],
    ["output/100%.png", "output/100%.png"],
    ["output/100%2.png", "output/100%2.png"],
    ["output/a%2Fb.png", "output/a/b.png"],
  ])("names %s the way the renderer opens it", (href, path) => {
    const named = pathsNamedInMessage(
      assistantSaying(`Here is [the chart](${href}).`),
    );

    expect([...named]).toEqual([path]);
  });

  it("reads every text part of the message", () => {
    const named = pathsNamedInMessage(
      assistantSaying(
        "```files\noutput/one.png\n```",
        "And [another](output/two.png).",
      ),
    );

    expect([...named].sort()).toEqual(["output/one.png", "output/two.png"]);
  });
});
