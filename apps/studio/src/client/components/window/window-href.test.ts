import { fileHref } from "@/shared/computer-href";
import { ChatIdSchema } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import {
  chatOfHref,
  chatOfHrefPrefix,
  chatOfSessionPrefix,
  chatSessionOfHref,
  sameHref,
} from "./window-href";

describe("chatOfHrefPrefix", () => {
  const chats = [
    ChatIdSchema.parse("2026-10-01-roofer"),
    ChatIdSchema.parse("2026-10-01-roofer-2"),
    ChatIdSchema.parse("2026-10-02-trip"),
  ];

  it.each([
    ["the start of one id", "/chats/2026-10-02", chats[2]],
    ["a whole id another id starts with", "/chats/2026-10-01-roofer", chats[0]],
    ["an id in the wrong case", "/chats/2026-10-02-TRIP", chats[2]],
    ["a start two ids share", "/chats/2026-10-01", undefined],
    ["a start no id has", "/chats/2026-11", undefined],
    ["the chats as a whole", "/chats", undefined],
    ["another screen", "/tasks/2026-10-02-trip", undefined],
  ])("resolves %s", (_case, href, expected) => {
    expect(chatOfHrefPrefix(href, chats)).toBe(expected);
  });
});

describe("a chat's address", () => {
  it.each([
    ["a chat id", "/chats/2026-10-02-trip", "2026-10-02-trip", undefined],
    [
      "a session, as older links have it",
      "/chats/ses_01JAAAAAAAAAAAAAAAAAAAAAAA",
      undefined,
      "ses_01JAAAAAAAAAAAAAAAAAAAAAAA",
    ],
    ["the chats as a whole", "/chats", undefined, undefined],
    ["another screen", "/tasks/2026-10-02-trip", undefined, undefined],
  ])("reads %s", (_case, href, chat, session) => {
    expect([chatOfHref(href), chatSessionOfHref(href)]).toEqual([
      chat,
      session,
    ]);
  });
});

describe("chatOfSessionPrefix", () => {
  const chats = [
    {
      id: ChatIdSchema.parse("2026-10-01-roofer"),
      sessionId: "ses_01JAAAAAAAAAAAAAAAAAAAAAAA",
    },
    {
      id: ChatIdSchema.parse("2026-10-02-trip"),
      sessionId: "ses_01JABBBBBBBBBBBBBBBBBBBBBB",
    },
  ];

  it.each([
    ["the start of one chat's session", "/chats/ses_01JAB", chats[1]?.id],
    ["one in the wrong case", "/chats/SES_01jaa", chats[0]?.id],
    ["a start two sessions share", "/chats/ses_01JA", undefined],
    ["a chat's own id", "/chats/2026-10-01-roofer", undefined],
  ])("resolves %s", (_case, href, expected) => {
    expect(chatOfSessionPrefix(href, chats)).toBe(expected);
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
