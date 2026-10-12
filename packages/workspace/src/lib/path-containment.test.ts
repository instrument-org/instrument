import { describe, expect, it } from "vitest";

import { isAtOrUnder, isUnder, relativeWithin } from "./path-containment";

describe("relativeWithin", () => {
  it.each([
    ["the root itself", "/Users/sam/chat", "/"],
    ["a child", "/Users/sam/chat/output/report.pdf", "/output/report.pdf"],
    ["a trailing slash on the root", "/Users/sam/chat/", "/"],
    ["a sibling sharing a prefix", "/Users/sam/chats/output", null],
    ["a longer name", "/Users/sam/chat-2/output", null],
    ["an unrelated folder", "/Users/sam/Photos", null],
    ["a bare relative path", "output/report.pdf", null],
  ])("%s", (_case, path, expected) => {
    expect(relativeWithin("/Users/sam/chat", path)).toBe(expected);
  });
});

// The pair exists because callers disagree about the root, and picking the
// wrong one fails in whichever direction nobody was looking.
describe("the root itself", () => {
  it("is contained by isAtOrUnder and not by isUnder", () => {
    expect(isAtOrUnder("/Users/sam/chat", "/Users/sam/chat")).toBe(true);
    expect(isUnder("/Users/sam/chat", "/Users/sam/chat")).toBe(false);
  });

  it.each(["/Users/sam/chat/output", "/Users/sam/chat/output/report.pdf"])(
    "agrees about %s",
    (path) => {
      expect(isAtOrUnder("/Users/sam/chat", path)).toBe(true);
      expect(isUnder("/Users/sam/chat", path)).toBe(true);
    },
  );

  it.each([
    "/Users/sam/chats/output",
    "/Users/sam/chat-2",
    "/Users/sam/Photos",
    "output",
  ])("agrees about %s", (path) => {
    expect(isAtOrUnder("/Users/sam/chat", path)).toBe(false);
    expect(isUnder("/Users/sam/chat", path)).toBe(false);
  });
});
