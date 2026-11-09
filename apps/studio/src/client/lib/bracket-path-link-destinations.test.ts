import { describe, expect, it } from "vitest";

import { bracketPathLinkDestinations } from "./bracket-path-link-destinations";

describe("bracketPathLinkDestinations", () => {
  it.each([
    [
      String.raw`[a](C:\Users\sam\My Notes\a.md)`,
      String.raw`[a](<C:\Users\sam\My Notes\a.md>)`,
    ],
    ["[a](/Users/sam/My Notes/a.md)", "[a](</Users/sam/My Notes/a.md>)"],
    ["[a](~/My Notes/a.md)", "[a](<~/My Notes/a.md>)"],
    ["[a](/Users/sam/Photos (2)/a.png)", "[a](</Users/sam/Photos (2)/a.png>)"],
    ["![a](/Users/sam/My Shots/a.png)", "![a](</Users/sam/My Shots/a.png>)"],
  ])("brackets %s", (input, output) => {
    expect(bracketPathLinkDestinations(input)).toBe(output);
  });

  it.each([
    "[a](/Users/sam/a.md)",
    '[a](/Users/sam/a.md "Title")',
    "[a](</Users/sam/My Notes/a.md>)",
    "[a](https://example.com/a b)",
    "[a](notes/My Notes.md)",
    "the [draft] (see the notes) is done",
    "`[a](/Users/sam/My Notes/a.md)`",
    "```\n[a](/Users/sam/My Notes/a.md)\n```",
  ])("leaves %s as written", (input) => {
    expect(bracketPathLinkDestinations(input)).toBe(input);
  });
});
