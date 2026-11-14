import { describe, expect, it } from "vitest";

import { type Chat } from "./chats";
import {
  chatLines,
  newTabLines,
  pageLines,
  type RowLines,
} from "./row-lines";

/** The fields a row reads off a chat, as the chat list's tests stand in for one. */
function chatWith(fields: Partial<Chat> & Pick<Chat, "title">): Chat {
  const row = {
    archived: false,
    id: fields.title,
    lastUserMessageAt: 0,
    status: "idle",
    unread: false,
    ...fields,
  };
  // A stand-in for the whole wire row: nothing here reads the rest.
  return row as unknown as Chat;
}

const line = (text: string, kind: "reply" | "step" = "reply") => ({
  at: 0,
  kind,
  text,
});

describe("chatLines", () => {
  it.each<[string, Partial<Chat>, Pick<RowLines, "line" | "strong" | "tone">]>([
    [
      "a quiet chat",
      { latest: line("We're $16 under it.") },
      { line: "We're $16 under it.", strong: false, tone: "quiet" },
    ],
    [
      "a chat at work",
      { latest: line("Reading plans", "step"), status: "working" },
      { line: "Reading plans", strong: false, tone: "work" },
    ],
    [
      "a chat at work with no step yet",
      { status: "working" },
      { line: "Instrument is working", strong: false, tone: "work" },
    ],
    [
      "a chat asking",
      { latest: line("Send the 14 drafts now?"), status: "waiting" },
      { line: "Send the 14 drafts now?", strong: true, tone: "ask" },
    ],
    [
      "a reply not yet read",
      { latest: line("Ridgeline came in lowest."), unread: true },
      { line: "Ridgeline came in lowest.", strong: true, tone: "news" },
    ],
    [
      "a chat that failed",
      { latest: line("Here's the FAQ"), status: "failed" },
      { line: "Stopped before it finished", strong: false, tone: "fail" },
    ],
  ])("says %s", (_kind, fields, expected) => {
    expect(
      chatLines(chatWith({ title: "Pricing", ...fields }), "Chat"),
    ).toEqual({ ...expected, title: "Pricing" });
  });

  it("goes by the title given for a chat not read yet", () => {
    expect(chatLines(undefined, "Pricing").title).toBe("Pricing");
  });
});

describe("pageLines", () => {
  it.each<
    [string, Parameters<typeof pageLines>, Pick<RowLines, "line" | "tone">]
  >([
    [
      "its site",
      ["Plans", "https://www.zendesk.com/pricing/", undefined],
      { line: "zendesk.com", tone: "quiet" },
    ],
    [
      "it is loading",
      ["Plans", "https://freshworks.com/freshdesk/pricing", "loading"],
      { line: "Loading freshworks.com", tone: "quiet" },
    ],
    [
      "it can't be reached",
      ["Pricing", "https://intercom.com/pricing", "failed"],
      { line: "Can't reach this page", tone: "fail" },
    ],
  ])("says %s", (_kind, args, expected) => {
    expect(pageLines(...args)).toMatchObject(expected);
  });
});

describe("newTabLines", () => {
  it.each([
    [undefined, "Nothing open yet", "quiet"],
    ["  ", "Nothing open yet", "quiet"],
    ["Line up Intercom's seats", "Line up Intercom's seats", "draft"],
  ])("says what is typed in %j", (words, expectedLine, tone) => {
    expect(newTabLines(words)).toMatchObject({
      line: expectedLine,
      title: "New Tab",
      tone,
    });
  });
});
