import { fileHref } from "@/shared/computer-href";
import { type Draft } from "@/shared/drafts";
import { type WindowTab } from "@/client/atoms/window";
import { ChatIdSchema } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import {
  chatContextItems,
  chatSuggestionOf,
  type ContextItem,
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

const offered = (inView: WindowTab, taken: ContextItem[] = []) =>
  chatSuggestionOf({ chatId: CHAT, finderOf: () => null, inView, taken });

describe("a chat's next message", () => {
  it("carries the chat's own tab up in its view, then what was taken", () => {
    const site = offered(page("site", "site:1"));
    expect(site).toBeDefined();
    const items = chatContextItems({
      chatId: CHAT,
      finderOf: () => null,
      taken: site ? [site] : [],
      up: page("own", CHAT),
    });
    expect(
      items.map((item) => [item.key, item.kind === "tab" && item.owned]),
    ).toEqual([
      ["tab:own", true],
      ["tab:site", false],
    ]);
  });

  it("is offered what is behind the chat, until it is taken", () => {
    const site = offered(page("site", "site:1"));
    expect(site).toMatchObject({ key: "tab:site", kind: "tab" });
    expect(offered(page("site", "site:1"), site ? [site] : [])).toBeUndefined();
  });

  it.each([
    ["the chat's own tab", page("own", CHAT)],
    ["another chat's tab", page("theirs", OTHER)],
    [
      "another chat's screen",
      { href: `/chats/${OTHER}`, id: "chat", kind: "screen" as const },
    ],
  ])("is offered nothing for %s", (_name, tab) => {
    expect(offered(tab)).toBeUndefined();
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
        band: [
          page("band", "draft:d"),
          { ...page("second", "draft:d"), url: "https://example.org/" },
        ],
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

  it("are one chip for two tabs at the same address, the first in the band", () => {
    expect(
      forDraft({
        band: [page("first", "draft:d"), page("again", "draft:d")],
      }).map((item) => item.key),
    ).toEqual(["tab:first"]);
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
