import { type WindowTab } from "@/client/atoms/window";
import { fileHref } from "@/shared/computer-href";
import { StoreId } from "@instrument-org/workspace/client";
import { render, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  keepsHostedPage,
  strandedHostedPages,
  useHostedPage,
} from "./hosted-page";
import { type WindowTabs } from "./tab-model";

const GROUP = StoreId.SessionSchema.parse("ses_01JAAAAAAAAAAAAAAAAAAAAAAA");
const FILE_URL = "file:///Users/mac-user/site/index.html";
/** The page each file tab draws in its viewer, by the file tab's id. */
const PAGE_OF: Record<string, string> = { files: StoreId.newTabId() };

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

function screenTab(id: string, href: string, side?: 1): WindowTab {
  return { group: GROUP, href, id, kind: "screen", ...(side ? { side } : {}) };
}

function hostedPage(owner: string): WindowTab {
  return {
    group: `page:${owner}`,
    id: PAGE_OF[owner] ?? owner,
    kind: "page",
    openedAt: 0,
    url: FILE_URL,
  };
}

function windowOf(tabs: WindowTab[], up: string): WindowTabs {
  return { activeByGroup: { [GROUP]: up }, tabs };
}

const FILES = fileHref("~/site/index.html");

describe("useHostedPage", () => {
  beforeEach(() => {
    window_.close.mockClear();
    window_.tabs = [hostedPage("files")];
  });

  // A group draws only the tab up on each side, so switching tabs there
  // takes the file tab's viewer away; its page staying open is what keeps
  // it live, rather than loaded again when the tab comes back up.
  it.each([
    ["keeps the page when its tab is only put behind", true, []],
    ["closes the page when its tab goes", false, [PAGE_OF.files]],
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
    await Promise.resolve();
    expect(window_.close.mock.calls.map(([id]) => id)).toEqual(closed);
  });

  // A file tab moved to the other side of its group, or its screen's router
  // made again, draws its viewer afresh: the old one goes and the new one
  // comes in one commit, and the page stays with the new one.
  it("keeps the page for a viewer drawn afresh in one commit", async () => {
    function Viewer() {
      useHostedPage({
        group: "page:files",
        host: { chrome: false, isActive: true },
        keepsPage: () => false,
        url: FILE_URL,
      });
      return null;
    }
    const { rerender } = render(<Viewer key="before" />);
    rerender(<Viewer key="after" />);
    await Promise.resolve();
    expect(window_.close).not.toHaveBeenCalled();
  });
});

describe("keepsHostedPage", () => {
  const tabs = [
    screenTab("files", FILES),
    screenTab("site", "/apps"),
    screenTab("beside", "/apps", 1),
    hostedPage("files"),
  ];

  it.each([
    ["behind another tab on its side", windowOf(tabs, "site"), true],
    ["up on its side, gone to another screen", windowOf(tabs, "files"), false],
    [
      "closed",
      windowOf(
        tabs.filter((tab) => tab.id !== "files"),
        "site",
      ),
      false,
    ],
    [
      "gone from Files",
      windowOf(
        tabs.map((tab) =>
          tab.id === "files" ? screenTab("files", "/apps") : tab,
        ),
        "site",
      ),
      false,
    ],
  ])("%s", (_case, state, expected) => {
    expect(keepsHostedPage(state, "files")).toBe(expected);
  });
});

describe("strandedHostedPages", () => {
  it.each([
    ["its tab still Files", [screenTab("files", FILES)], ["files"], []],
    ["its tab closed", [], ["files"], [PAGE_OF.files]],
    [
      "its tab gone on to another screen",
      [screenTab("files", "/apps")],
      ["files"],
      [PAGE_OF.files],
    ],
    ["its tab not read yet", [], [], []],
  ])("%s", (_case, owners, seen, expected) => {
    const state = windowOf([...owners, hostedPage("files")], "files");
    expect(strandedHostedPages(state, new Set(seen))).toEqual(expected);
  });
});
