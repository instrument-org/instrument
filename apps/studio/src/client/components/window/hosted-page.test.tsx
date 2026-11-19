import { type WindowTab } from "@/client/atoms/window";
import { fileHref } from "@/shared/computer-href";
import { StoreId } from "@instrument-org/workspace/client";
import { render, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  agentPageOfTab,
  keepsHostedPage,
  pageFileOfTab,
  strandedHostedPages,
  undrawnHostedStep,
  useHostedPage,
} from "./hosted-page";

const FILE_URL = "file:///Users/mac-user/site/index.html";
const GROUP = "page:files";

const window_ = vi.hoisted(() => ({
  close: vi.fn<(id: string) => void>(),
  tabs: [] as { group?: string; id: string; kind: string; url?: string }[],
}));

vi.mock("@/client/lib/browser-pool", () => ({
  getGuest: () => null,
  goGuest: () => false,
  onPageThumb: () => () => undefined,
}));
vi.mock("./page-hosts", () => ({ usePageHost: () => undefined }));
vi.mock("./context", () => ({
  useWindow: () => ({
    browser: { navigateTab: vi.fn(), openOrFocus: vi.fn() },
  }),
}));
vi.mock("./window-tabs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./window-tabs")>()),
  useWindowTabs: () => ({ allTabs: window_.tabs, close: window_.close }),
}));

function Viewer() {
  useHostedPage({
    group: GROUP,
    host: { chrome: false, isActive: true },
    url: FILE_URL,
  });
  return null;
}

describe("useHostedPage", () => {
  beforeEach(() => {
    window_.close.mockClear();
    window_.tabs = [
      { group: GROUP, id: StoreId.newTabId(), kind: "page", url: FILE_URL },
    ];
  });

  it("closes the page once its viewer goes", async () => {
    const { unmount } = render(<Viewer />);
    unmount();
    await Promise.resolve();
    expect(window_.close).toHaveBeenCalledTimes(1);
  });

  // A file tab's screen drawn afresh (its router made again) puts its viewer
  // away and back in one commit, and the page stays with the new one.
  it("keeps the page for a viewer drawn afresh in one commit", async () => {
    const { rerender } = render(<Viewer key="before" />);
    rerender(<Viewer key="after" />);
    await Promise.resolve();
    expect(window_.close).not.toHaveBeenCalled();
  });
});

const CHAT = StoreId.SessionSchema.parse("ses_01JAAAAAAAAAAAAAAAAAAAAAAA");
const PAGE_ID = StoreId.newTabId();
const PAGE_FILE = fileHref("/Users/mac-user/site/index.html");

function screenTab(id: string, href: string): WindowTab {
  return { group: CHAT, href, id, kind: "screen" };
}

const hostedPage: WindowTab = {
  group: "page:files",
  id: PAGE_ID,
  kind: "page",
  openedAt: 0,
  url: FILE_URL,
};

describe("a file tab's page outliving its viewer", () => {
  beforeEach(() => {
    window_.close.mockClear();
    window_.tabs = [hostedPage];
  });

  // A group draws only the tab up, so another tab coming up takes the file
  // tab's viewer away; its page staying open keeps it live for the viewer's
  // return and for an agent driving it.
  it.each([
    ["keeps the page while its tab stands on the file", true, []],
    ["closes the page when its tab goes", false, [PAGE_ID]],
  ])("%s", async (_case, keeps, closed) => {
    const { unmount } = renderHook(() =>
      useHostedPage({
        group: "page:files",
        host: { chrome: false, isActive: true },
        keepsPage: () => keeps,
        url: FILE_URL,
      }),
    );
    unmount();
    // The surface lets its page go once the commit taking it away is done.
    await Promise.resolve();
    expect(window_.close.mock.calls.map(([id]) => id)).toEqual(closed);
  });

  it.each([
    ["on a page's file", PAGE_FILE, "/Users/mac-user/site/index.html"],
    [
      "on a page's source",
      fileHref("/Users/mac-user/site/index.html", { source: true }),
      undefined,
    ],
    ["on an image", fileHref("/Users/mac-user/site/cat.png"), undefined],
    ["on a folder", "/files?path=site&root=~", undefined],
    ["on another screen", "/apps", undefined],
  ])("reads the page's file of a tab %s", (_case, href, file) => {
    expect(pageFileOfTab(screenTab("files", href))).toBe(file);
  });

  it.each([
    ["on a page's file", [screenTab("files", PAGE_FILE)], true],
    ["closed", [], false],
    [
      "gone on to an image",
      [screenTab("files", fileHref("/Users/mac-user/site/cat.png"))],
      false,
    ],
  ])("keeps the page of a tab %s", (_case, tabs, expected) => {
    expect(keepsHostedPage([...tabs, hostedPage], "files")).toBe(expected);
  });

  it.each([
    [
      "its tab still on the file",
      [screenTab("files", PAGE_FILE)],
      ["files"],
      [],
    ],
    ["its tab closed", [], ["files"], [PAGE_ID]],
    [
      "its tab gone on to another screen",
      [screenTab("files", "/apps")],
      ["files"],
      [PAGE_ID],
    ],
    ["its tab not read yet", [], [], []],
  ])("closes a kept page with %s", (_case, tabs, seen, stranded) => {
    expect(strandedHostedPages([...tabs, hostedPage], new Set(seen))).toEqual(
      stranded,
    );
  });
});

describe("agentPageOfTab", () => {
  const files = screenTab("files", PAGE_FILE);

  it.each([
    [
      "a page tab by its own id",
      [],
      { ...hostedPage, group: CHAT },
      { id: PAGE_ID },
    ],
    ["a file tab by the page it draws", [hostedPage], files, { id: PAGE_ID }],
    [
      "a file tab with no page yet by where its page opens",
      [],
      files,
      { open: { group: "page:files", url: FILE_URL } },
    ],
    [
      "nothing for a file tab on an image",
      [],
      screenTab("files", fileHref("/Users/mac-user/site/cat.png")),
      undefined,
    ],
  ])("names %s", (_case, tabs, tab, page) => {
    expect(agentPageOfTab([...tabs, tab], tab)).toEqual(page);
  });
});

describe("undrawnHostedStep", () => {
  const files = screenTab("files", PAGE_FILE);
  const tabs = [files, hostedPage];

  // An agent drives the page of a file tab behind another; with no viewer
  // drawn to follow the page, the window moves the tab.
  it.each([
    [
      "a site makes the tab the page",
      "https://example.com/",
      false,
      { owner: "files", step: { kind: "site", url: "https://example.com/" } },
    ],
    [
      "another file walks the tab there",
      "file:///Users/mac-user/site/about.html",
      false,
      {
        owner: "files",
        step: { kind: "file", path: "/Users/mac-user/site/about.html" },
      },
    ],
    ["the file itself is no step", FILE_URL, false, undefined],
    [
      "a drawn viewer takes its own steps",
      "https://example.com/",
      true,
      undefined,
    ],
  ])("%s", (_case, url, drawn, step) => {
    expect(
      undrawnHostedStep(tabs, { isDrawn: () => drawn, pageId: PAGE_ID, url }),
    ).toEqual(step);
  });

  it("leaves a page of no file tab's alone", () => {
    const page = { ...hostedPage, group: CHAT };
    expect(
      undrawnHostedStep([page], {
        isDrawn: () => false,
        pageId: PAGE_ID,
        url: "https://example.com/",
      }),
    ).toBeUndefined();
  });
});
