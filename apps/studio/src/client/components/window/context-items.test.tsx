import { fileHref } from "@/shared/computer-href";
import { type Draft } from "@/shared/drafts";
import { type WindowTab } from "@/client/atoms/window";
import { ChatIdSchema } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import {
  chatContextItems,
  draftContextItems,
  draftSuggestionOf,
} from "./context-items";

const CHAT = ChatIdSchema.parse("2026-10-01-lisbon");
const OTHER = ChatIdSchema.parse("2026-10-02-porto");

const page = (id: string, group: string): WindowTab => ({
  group,
  id,
  kind: "page",
  openedAt: 1,
  title: "Example",
  url: "https://example.com/",
});

/** What a chat composer carries for one tab, in view behind it or up in its own view. */
function itemsFor(tab: WindowTab, { up = false } = {}) {
  return chatContextItems({
    chatId: CHAT,
    finderOf: () => null,
    inView: up ? undefined : tab,
    leftOut: [],
    up: up ? tab : undefined,
  });
}

describe("chatContextItems", () => {
  it.each([
    [
      "the chat's own tab, up in its view",
      page("own", CHAT),
      true,
      "tab",
      true,
    ],
    ["a page of the window's own", page("site", "site:1"), false, "tab", false],
  ])("carries %s as a %s item", (_name, tab, up, kind, owned) => {
    const [item] = itemsFor(tab, { up });
    expect(item?.kind).toBe(kind);
    expect(item?.kind === "tab" ? item.owned : undefined).toBe(owned);
  });

  it("carries nothing for another chat's tab", () => {
    expect(itemsFor(page("theirs", OTHER))).toEqual([]);
    expect(
      itemsFor({ href: `/chats/${OTHER}`, id: "chat", kind: "screen" }),
    ).toEqual([]);
  });

  it("carries nothing it was told to leave out", () => {
    expect(
      chatContextItems({
        chatId: CHAT,
        finderOf: () => null,
        inView: page("site", "site:1"),
        leftOut: ["tab:site"],
        up: undefined,
      }),
    ).toEqual([]);
  });
});

describe("a draft's chips", () => {
  const draft: Draft = { createdAt: 0, id: "d", updatedAt: 0, words: "" };
  const forDraft = (over: Partial<Parameters<typeof draftContextItems>[0]>) =>
    draftContextItems({
      allTabs: [],
      band: [],
      draft,
      finderOf: () => null,
      group: "draft:d",
      ...over,
    });
  const suggested = (over: Partial<Parameters<typeof draftSuggestionOf>[0]>) =>
    draftSuggestionOf({
      allTabs: [],
      band: [],
      draft,
      finderOf: () => null,
      group: "draft:d",
      inView: undefined,
      ...over,
    });

  it("are every tab of the band, then what the person chose", () => {
    expect(
      forDraft({
        band: [page("band", "draft:d"), page("second", "draft:d")],
        draft: {
          ...draft,
          context: [
            { chat: OTHER, kind: "chat" },
            { kind: "file", path: "/Users/sam/a.pdf" },
          ],
        },
      }).map((item) => item.key),
    ).toEqual([
      "tab:band",
      "tab:second",
      `chat:${OTHER}`,
      "chosen:/Users/sam/a.pdf",
    ]);
  });

  it("are offered what is in view", () => {
    expect(suggested({ inView: page("site", "site:1") })).toMatchObject({
      key: "tab:site",
      kind: "tab",
    });
  });

  // A folder with a file selected in it offers the file; once the draft has
  // the file, the folder around it is not offered in its place.
  const FOLDER: WindowTab = {
    href: "/files?path=&root=%2FUsers%2Fsam%2FNotes",
    id: "folder",
    kind: "screen",
  };
  const PLAN = { kind: "file" as const, path: "/Users/sam/Notes/plan.md" };
  const finderOf = () => ({ folder: "/Users/sam/Notes", selected: [PLAN] });

  it("are offered what is selected in a folder in view", () => {
    expect(suggested({ finderOf, inView: FOLDER })).toMatchObject({
      items: [PLAN],
    });
  });

  it.each([
    ["nothing is in view", undefined, [], draft],
    [
      "one of the band's tabs shows it",
      page("site", "site:1"),
      [page("band", "draft:d")],
      draft,
    ],
    [
      "the draft has what is selected in it attached",
      FOLDER,
      [],
      {
        ...draft,
        attached: [
          {
            kind: "file" as const,
            mediaType: "text/markdown",
            name: "plan.md",
            path: PLAN.path,
            size: 1,
          },
        ],
      },
    ],
    [
      "the band has what is selected in it open",
      FOLDER,
      [
        {
          group: "draft:d",
          href: fileHref(PLAN.path),
          id: "plan",
          kind: "screen" as const,
        },
      ],
      draft,
    ],
    ["it is another chat's", page("theirs", OTHER), [], draft],
  ])("are offered nothing when %s", (_name, inView, band, withDraft) => {
    expect(
      suggested({ band, draft: withDraft, finderOf, inView }),
    ).toBeUndefined();
  });

  it("stand for a page and an app the person chose by their address", () => {
    const [site, app] = forDraft({
      draft: {
        ...draft,
        context: [
          { kind: "link", url: "https://example.com/" },
          { kind: "link", url: "instrument://app/notion" },
        ],
      },
    });
    expect(site?.kind === "tab" && site.tab).toMatchObject({
      kind: "page",
      url: "https://example.com/",
    });
    expect(app?.kind === "tab" && app.tab).toMatchObject({
      href: "/apps/notion",
      kind: "screen",
    });
  });
});
