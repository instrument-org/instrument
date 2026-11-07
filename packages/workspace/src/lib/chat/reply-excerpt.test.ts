import { describe, expect, it } from "vitest";

import { excerptOf } from "./reply-excerpt";

describe("excerptOf", () => {
  it.each([
    [
      "a message fence with front matter",
      "```message\n---\nmessage: chat\nto: Team\nvia: Slack\n---\nI also worked on **the transition**.\n\n1. Step\n```",
    ],
    [
      "a message fence with bare headers",
      "```message\nto: Team\n\nI also worked on **the transition**.\n```",
    ],
    [
      "a four-backtick message fence holding a code block",
      "````message\nto: Team\n\nI also worked on **the transition**.\n\n```ts\nconst a = 1;\n```\n````",
    ],
  ])("reads %s by its body", (_label, text) => {
    expect(excerptOf(text, 200)).toBe("I also worked on the transition.");
  });
});
