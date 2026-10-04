import { fileHref } from "@/shared/computer-href";
import { StoreId } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import { chatOfHrefPrefix, sameHref } from "./window-href";

describe("chatOfHrefPrefix", () => {
  const chats = [
    StoreId.SessionSchema.parse("ses_01JAAAAAAAAAAAAAAAAAAAAAAA"),
    StoreId.SessionSchema.parse("ses_01JABBBBBBBBBBBBBBBBBBBBBB"),
    StoreId.SessionSchema.parse("ses_01JCCCCCCCCCCCCCCCCCCCCCCC"),
  ];

  it.each([
    ["the start of one id", "/chats/ses_01JC", chats[2]],
    ["a whole id", "/chats/ses_01JAAAAAAAAAAAAAAAAAAAAAAA", chats[0]],
    ["an id in the wrong case", "/chats/SES_01jcc", chats[2]],
    ["a start two ids share", "/chats/ses_01JA", undefined],
    ["a start no id has", "/chats/ses_01JZ", undefined],
    ["the chats as a whole", "/chats", undefined],
    ["another screen", "/tasks/ses_01JC", undefined],
  ])("resolves %s", (_case, href, expected) => {
    expect(chatOfHrefPrefix(href, chats)).toBe(expected);
  });
});

describe("sameHref", () => {
  const FILE = "/Users/casey/notes/alpha.md";

  it.each([
    // The router writes a pushed address back out with `~` as `%7E`, and the
    // two have to read as one screen or the tab never follows the push.
    [
      "a file's address and the router's spelling of it",
      fileHref(FILE),
      `/files?file=${encodeURIComponent(FILE)}&path=&root=%7E`,
      true,
    ],
    [
      "the same search in another order",
      "/files?root=~&path=",
      "/files?path=&root=~",
      true,
    ],
    [
      "two files",
      fileHref(FILE),
      fileHref("/Users/casey/notes/beta.md"),
      false,
    ],
  ])("compares %s", (_case, a, b, expected) => {
    expect(sameHref(a, b)).toBe(expected);
  });
});
