import { type WindowTab } from "@/client/atoms/window";
import { draftFileOf, draftOf } from "@/electron-main/drafts/draft-record";
import { fileHref, folderHref } from "@/shared/computer-href";
import {
  type Draft,
  type DraftContextItem,
  draftGroupOf,
} from "@/shared/drafts";
import { ChatIdSchema, StoreId } from "@instrument-org/workspace/client";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { siteGroupOf } from "./app-tabs";

import { bandTabLines, draftContextItems } from "./context-items";
import {
  contextFollowingBand,
  pagesForChat,
  pageToChat,
  useBandContext,
} from "./draft-band";

const DRAFT: Draft = { createdAt: 0, id: "d1", updatedAt: 0, words: "" };
const GROUP = draftGroupOf(DRAFT.id);
const CHAT = ChatIdSchema.parse("2026-10-01-lisbon");

const page = (id: string, url: string): WindowTab => ({
  group: GROUP,
  id,
  kind: "page",
  openedAt: 0,
  url,
});
const screen = (id: string, href: string): WindowTab => ({
  group: GROUP,
  href,
  id,
  kind: "screen",
});

const REPORT = { kind: "link" as const, url: "https://example.com/report" };
const PLAN = { kind: "file" as const, path: "/Users/casey/Notes/plan.md" };
const NOTES = { kind: "folder" as const, path: "/Users/casey/Notes/" };

const linesOf = (tab: WindowTab, held: DraftContextItem[] = []) =>
  bandTabLines(tab, {
    finderOf: () => null,
    held: held.flatMap((entry) =>
      entry.kind === "file" || entry.kind === "folder" ? [entry] : [],
    ),
  });

describe("what a tab of a draft's band stands for", () => {
  it.each([
    ["a page", page("t", REPORT.url), [REPORT]],
    ["a file", screen("t", fileHref(PLAN.path)), [PLAN]],
    [
      "a folder",
      screen("t", folderHref("/Users/casey/Notes")),
      [{ kind: "folder", path: "/Users/casey/Notes" }],
    ],
    [
      "an app's front",
      screen("t", "/apps/notion"),
      [{ kind: "link", url: "instrument://app/notion" }],
    ],
    ["the list of apps", screen("t", "/apps"), []],
  ] as const)("is %s's line", (_name, tab, lines) => {
    expect(linesOf(tab)).toEqual(lines);
  });

  it("is nothing for a file the draft has attached", () => {
    expect(linesOf(screen("t", fileHref(PLAN.path)), [PLAN])).toEqual([]);
  });
});

describe("a draft's file following its band", () => {
  const follow = (
    context: DraftContextItem[] | undefined,
    lines: [string, DraftContextItem[]][],
    was: [string, string[]][] = [],
  ) =>
    contextFollowingBand(context, { lines: new Map(lines), was: new Map(was) });

  it("writes a line for a tab the file does not have yet", () => {
    expect(follow([NOTES], [["t", [REPORT]]])).toEqual([NOTES, REPORT]);
  });

  it("takes out the line of a tab that was closed", () => {
    expect(
      follow([REPORT, NOTES], [], [["t", [`link:${REPORT.url}`]]]),
    ).toEqual([NOTES]);
  });

  it("names where a tab went once it goes somewhere else", () => {
    const moved = { kind: "link" as const, url: "https://example.com/next" };
    expect(
      follow([REPORT], [["t", [moved]]], [["t", [`link:${REPORT.url}`]]]),
    ).toEqual([moved]);
  });

  it("keeps a line another tab still stands for", () => {
    expect(
      follow([REPORT], [["u", [REPORT]]], [["t", [`link:${REPORT.url}`]]]),
    ).toBeUndefined();
  });

  it("leaves alone a line no tab was seen standing for, and another chat", () => {
    expect(
      follow([{ chat: CHAT, kind: "chat" }, PLAN], [], [["t", []]]),
    ).toBeUndefined();
  });

  it("keeps the line of a tab still open that names nothing now", () => {
    expect(
      follow([NOTES], [["t", []]], [["t", ["chosen:/Users/casey/Notes"]]]),
    ).toBeUndefined();
  });

  it("matches a folder's line however its path ends", () => {
    expect(
      follow(
        [NOTES],
        [["t", [{ kind: "folder", path: "/Users/casey/Notes" }]]],
      ),
    ).toBeUndefined();
  });
});

describe("a draft shown with its band", () => {
  const band = [page("t", REPORT.url), screen("u", fileHref(PLAN.path))];
  const draft: Draft = {
    ...DRAFT,
    context: [REPORT, PLAN, { chat: CHAT, kind: "chat" }],
  };

  it("is one chip for each thing, the tab where the band has one", () => {
    expect(
      draftContextItems({
        allTabs: band,
        band,
        draft,
        finderOf: () => null,
        group: GROUP,
      }).map((item) => (item.kind === "tab" ? item.tab.id : item.key)),
    ).toEqual(["t", "u", `chat:${CHAT}`]);
  });

  it("keeps every line in its file for another device to read", () => {
    const lines = new Map(band.map((tab) => [tab.id, linesOf(tab)]));
    const shown =
      contextFollowingBand(draft.context, { lines, was: new Map() }) ??
      draft.context;
    const rootDir = "/Users/casey/Workspace";
    const dir = `${rootDir}/Drafts/2026-11-07`;
    const file = draftFileOf({ ...draft, context: shown }, { dir, rootDir });
    expect(
      draftOf({ dir, draft: file, file: `${dir}/DRAFT.md` }, rootDir).context,
    ).toEqual(draft.context);
  });
});

describe("a page the draft names, at the send", () => {
  const theirs: WindowTab = {
    group: siteGroupOf("s1"),
    id: "tab_theirs",
    kind: "page",
    openedAt: 0,
    url: "https://shop.example/checkout",
  };
  const asked: Draft = {
    ...DRAFT,
    context: [
      { kind: "link", url: theirs.url ?? "" },
      { kind: "link", url: "instrument://app/notion" },
      PLAN,
      { chat: CHAT, kind: "chat" },
    ],
  };

  it("goes to the chat by its address, apart from what the band already shows", () => {
    expect(pagesForChat(asked, [])).toEqual([theirs.url]);
    expect(pagesForChat(asked, [page("t", theirs.url ?? "")])).toEqual([]);
  });

  it("opens as a tab of the chat's own, leaving the person's tab where it is", () => {
    const id = StoreId.newTabId();
    const openBehind = vi.fn(() => id);
    const select = vi.fn();
    for (const url of pagesForChat(asked, [])) {
      pageToChat({
        browser: { openBehind },
        chatId: CHAT,
        isUp: true,
        url,
        windowTabs: { select },
      });
    }
    expect(openBehind.mock.calls).toEqual([[theirs.url, CHAT]]);
    // Up in the chat's pane, which only ever selects the chat's own tab.
    expect(select.mock.calls).toEqual([[id]]);
  });

  it("never opens in the draft's band while it is a draft", () => {
    const open = vi.fn();
    renderHook(() => {
      useBandContext({
        band: [],
        close: vi.fn(),
        draft: asked,
        finderOf: () => null,
        onChange: vi.fn(),
        open,
      });
    });
    expect(open.mock.calls).toEqual([
      [{ href: "/apps/notion", kind: "screen" }],
      [PLAN],
    ]);
  });
});
