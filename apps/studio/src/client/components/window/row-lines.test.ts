import { describe, expect, it } from "vitest";

import { type WindowTab } from "@/client/atoms/window";
import { fileHref } from "@/shared/computer-href";

import { type Chat } from "./chats";
import {
  chatLines,
  newTabLines,
  pageLines,
  placeLines,
  type RowLines,
  tabsBesideLead,
  taskLines,
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
      { line: "Working", strong: false, tone: "work" },
    ],
    [
      "a chat asking",
      { latest: line("Send the 14 drafts now?"), status: "waiting" },
      { line: "Send the 14 drafts now?", strong: false, tone: "ask" },
    ],
    [
      "a chat asking, not yet read",
      {
        latest: line("Send the 14 drafts now?"),
        status: "waiting",
        unread: true,
      },
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
      { line: "Stopped", strong: false, tone: "fail" },
    ],
    [
      "a chat that failed, not yet read",
      { status: "failed", unread: true },
      { line: "Stopped", strong: true, tone: "fail" },
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

describe("taskLines", () => {
  type Task = Parameters<typeof taskLines>[0];
  const status = (kind: NonNullable<Task>["status"]["kind"], text = "") => ({
    kind,
    line: text,
  });
  it.each<[string, Task, Pick<RowLines, "line" | "strong" | "tone">]>([
    [
      "a task at work",
      { status: status("running", "Reading plans"), working: true },
      { line: "Reading plans", strong: false, tone: "work" },
    ],
    [
      "a task at work with no step yet",
      { status: status("running"), working: true },
      { line: "Working", strong: false, tone: "work" },
    ],
    // Never a question: the chat asks what its task waits on.
    [
      "a task waiting on a card",
      { status: status("waiting", "Allow Linear?"), working: false },
      { line: "Pricing", strong: false, tone: "quiet" },
    ],
    [
      "a task done",
      { status: status("done", "Ridgeline came in lowest."), working: false },
      { line: "Pricing", strong: false, tone: "quiet" },
    ],
    [
      "a task that failed",
      { status: status("failed", "Timed out"), working: false },
      { line: "Stopped", strong: false, tone: "fail" },
    ],
    [
      "a task not read yet",
      undefined,
      { line: "Pricing", strong: false, tone: "quiet" },
    ],
  ])("says %s", (_kind, task, expected) => {
    expect(taskLines(task, "Compare plans", "Pricing")).toEqual({
      ...expected,
      title: "Compare plans",
    });
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
      { line: "freshworks.com", tone: "quiet" },
    ],
    [
      "it can't be reached",
      ["Pricing", "https://intercom.com/pricing", "failed"],
      { line: "Can't connect", tone: "fail" },
    ],
  ])("says %s", (_kind, args, expected) => {
    expect(pageLines(...args)).toMatchObject(expected);
  });
});

describe("newTabLines", () => {
  it.each([
    [undefined, "", "quiet"],
    ["  ", "", "quiet"],
    ["Line up Intercom's seats", "Line up Intercom's seats", "draft"],
    [
      "[Notion](instrument://app/notion) didn't connect.",
      "Notion didn't connect.",
      "draft",
    ],
  ])("says what is typed in %j", (words, expectedLine, tone) => {
    expect(newTabLines(words)).toMatchObject({
      line: expectedLine,
      title: "New Tab",
      tone,
    });
  });
});

describe("tabsBesideLead", () => {
  const file = (id: string, path: string): WindowTab => ({
    href: fileHref(path),
    id,
    kind: "screen",
  });
  const page = (id: string, url: string): WindowTab => ({
    id,
    kind: "page",
    openedAt: 0,
    url,
  });
  const lead = file("a", "/Users/mac-user/Documents/plan.md");

  it("leaves out the lead tab and a second tab on the same file", () => {
    const other = file("c", "/Users/mac-user/Documents/notes.md");
    const site = page("d", "https://example.com/");
    expect(
      tabsBesideLead(
        [lead, file("b", "/Users/mac-user/Documents/plan.md"), other, site],
        lead,
      ).map((tab) => tab.id),
    ).toEqual(["c", "d"]);
  });

  it("leaves out a second tab on the lead page's address, and keeps another page of its site", () => {
    const first = page("a", "https://example.com/pricing");
    expect(
      tabsBesideLead(
        [
          first,
          page("b", "https://example.com/pricing"),
          page("c", "https://example.com/plans"),
        ],
        first,
      ).map((tab) => tab.id),
    ).toEqual(["c"]);
  });

  it("keeps two tabs that are neither a page nor a file", () => {
    const chats: WindowTab = { href: "/chats", id: "a", kind: "screen" };
    expect(
      tabsBesideLead(
        [chats, { href: "/chats", id: "b", kind: "screen" }],
        chats,
      ),
    ).toHaveLength(1);
  });
});

it("says the way to a file, outermost folder first", () => {
  expect(
    placeLines("prices.csv", ["mac-user", "Downloads"]),
  ).toMatchInlineSnapshot(`
    {
      "line": "mac-user › Downloads",
      "strong": false,
      "title": "prices.csv",
      "tone": "quiet",
      "trail": [
        "mac-user",
        "Downloads",
      ],
    }
  `);
});
