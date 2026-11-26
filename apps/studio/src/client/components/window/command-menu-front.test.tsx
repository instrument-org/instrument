import { type WindowTab } from "@/client/atoms/window";
import { renderWithProviders } from "@/tests/render";
import { installWindowStubs } from "@/tests/window-stubs";
import { fileHref } from "@/shared/computer-href";
import { ChatIdSchema, StoreId } from "@instrument-org/workspace/client";
import { queryOptions } from "@tanstack/react-query";
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { listChatHead } from "./chat-head-requests";
import { type Chat } from "./chats";
import { useCommandMenuRows } from "./command-menu";
import { groupLayoutOf } from "./tab-model";
import { chatHref, newChatHref } from "./window-href";

/** The tab up on the side with the keyboard, and every tab kept on this computer. */
const front = vi.hoisted(
  (): { all: WindowTab[]; tab: undefined | WindowTab } => ({
    all: [],
    tab: undefined,
  }),
);

/** The tab the menu went to. */
const shown = vi.hoisted(() => vi.fn());

/** The group the menu brought up, and the tab it picked there. */
const went = vi.hoisted(() => ({ select: vi.fn(), showGroup: vi.fn() }));

/** Groups this window lists past the two every test has. */
const moreGroups = vi.hoisted((): { names: string[] } => ({ names: [] }));

/** The files opened lately. */
const opened = vi.hoisted((): { files: string[] } => ({ files: [] }));

vi.mock("@/client/hooks/use-recent-files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/client/hooks/use-recent-files")>()),
  useRecentFiles: () => ({
    files: opened.files.map((path) => ({
      name: path.slice(path.lastIndexOf("/") + 1),
      openCount: 1,
      openedAt: 0,
      path,
    })),
  }),
}));

// Every query stays pending.
vi.mock("@/client/rpc/client", () => {
  const pending = () => new Promise(() => undefined);
  const procedure = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      apply: pending,
      get(_target, key) {
        if (key === "queryOptions" || key === "experimental_liveOptions") {
          return () => ({ queryFn: pending, queryKey: path });
        }
        if (key === "mutationOptions") {
          return (options: object) => ({ mutationFn: pending, ...options });
        }
        return typeof key === "string" ? procedure([...path, key]) : undefined;
      },
    });
  return { rpcClient: procedure([]) };
});

vi.mock("@/client/components/window/shell-context", () => ({
  useShell: () => ({
    goToPlace: () => undefined,
    newGroup: () => undefined,
    newTab: () => undefined,
    projects: [],
    showGroup: went.showGroup,
  }),
}));

vi.mock("@/client/components/theme-provider", () => ({
  useTheme: () => ({ setTheme: () => undefined, theme: "system" }),
}));

vi.mock("@/client/components/window/window-tabs", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/client/components/window/window-tabs")
  >()),
  useWindowTabs: () => ({
    active: front.tab,
    allTabs: front.all,
    groupOwn: {},
    layoutOf: (group: string) =>
      groupLayoutOf(
        {
          activeByGroup:
            front.tab?.group === undefined
              ? {}
              : { [front.tab.group]: front.tab.id },
          tabs: front.all,
        },
        group,
      ),
    select: went.select,
  }),
}));

// This window lists two groups; a third is another window's.
vi.mock("@/client/components/window/tab-groups", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/client/components/window/tab-groups")
  >()),
  useOpenGroups: () => ({
    elsewhere: [],
    open: [
      { group: "roofer", kind: "tabs", pinned: false, title: "Roofer quotes" },
      { group: "pricing", kind: "tabs", pinned: false, title: "Pricing" },
      ...moreGroups.names.map((name) => ({
        group: name,
        kind: "tabs" as const,
        pinned: false,
        title: name,
      })),
    ],
  }),
}));

const ROOFER = ChatIdSchema.parse("2026-11-14-roofer-quotes");

const CHAT: Chat = {
  archived: false,
  firstAsk: "Roofer quotes",
  holds: { apps: [], files: [], sites: [] },
  id: ROOFER,
  lastUserMessageAt: 0,
  sessionId: StoreId.newSessionId(),
  starred: false,
  status: "idle",
  title: "Roofer quotes",
  titleByApp: true,
  unread: false,
  unreadByUser: false,
  working: false,
};

vi.mock(
  "@/client/components/window/chat-list-query",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/client/components/window/chat-list-query")
    >()),
    chatListOptions: () =>
      queryOptions({
        queryFn: () => Promise.resolve([CHAT]),
        queryKey: ["chat-list"],
      }),
  }),
);

const CHAT_TAB: WindowTab = {
  group: "roofer",
  href: chatHref(ROOFER),
  id: "chat-tab",
  kind: "screen",
};
const PAGE_TAB: WindowTab = {
  group: "pricing",
  id: "tab_01M7EKJA7JST69N0RVMKWTP7Q8",
  kind: "page",
  openedAt: 0,
  title: "Suite plans",
  url: "https://www.zendesk.com/pricing/",
};
const FILE_TAB: WindowTab = {
  group: "pricing",
  href: fileHref("/Users/sam/Instrument/quotes.csv"),
  id: "file-tab",
  kind: "screen",
};

/** The menu's rows for words: each heading, and each row a button named by its label and detail. */
function MenuRows({ words }: { words: string }) {
  const { rows } = useCommandMenuRows({
    active: true,
    closeGroups: () => undefined,
    done: (run) => run,
    openPage: () => undefined,
    openScreen: () => undefined,
    showTab: shown,
    words,
  });
  return (
    <ul>
      {rows.map((row, index) =>
        row.type === "header" ? (
          <li key={`header-${index}`}>{`# ${row.label}`}</li>
        ) : row.type === "item" ? (
          <li key={row.id}>
            <button onClick={row.run} type="button">
              {[row.label, row.detail].filter(Boolean).join(" · ")}
            </button>
          </li>
        ) : null,
      )}
    </ul>
  );
}

const listed = () =>
  screen.getAllByRole("listitem").map((item) => item.textContent);

afterEach(() => {
  moreGroups.names = [];
  front.tab = undefined;
  front.all = [];
  opened.files = [];
  shown.mockClear();
  went.select.mockClear();
  went.showGroup.mockClear();
  installWindowStubs();
});

describe("the command menu's actions for the tab in front", () => {
  it("lists five of a chat's between Recent and Commands", async () => {
    front.tab = CHAT_TAB;
    renderWithProviders(<MenuRows words="" />);

    await screen.findByText("# This chat");
    expect(listed()).toMatchInlineSnapshot(`
      [
        "# Recent chats",
        "Roofer quotes",
        "All chats",
        "# This chat",
        "Rename",
        "Star",
        "Move to Project…",
        "Archive",
        "Delete Chat…",
        "New Tab Group",
        "New Tab",
        "Settings",
      ]
    `);
  });

  it("finds the rest of a chat's by name, among the commands", async () => {
    front.tab = CHAT_TAB;
    renderWithProviders(<MenuRows words="export" />);

    await screen.findByRole("button", { name: /Export/ });
    expect(listed()).toMatchInlineSnapshot(`
      [
        "# Top result",
        "Export as Markdown… · This chat",
        "Search the web for “export”",
      ]
    `);
  });

  it("asks the chat's own head to rename it", async () => {
    front.tab = CHAT_TAB;
    const asked = vi.fn();
    const unlist = listChatHead("chat-tab", asked);
    renderWithProviders(<MenuRows words="rename" />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Rename · This chat" }),
    );
    unlist();

    expect(asked.mock.calls).toEqual([["rename"]]);
  });

  it.each([
    ["Move to Project…", "project"],
    ["Delete Chat…", "delete"],
  ])("asks the chat's own head for %s", async (label, ask) => {
    front.tab = CHAT_TAB;
    const asked = vi.fn();
    const unlist = listChatHead("chat-tab", asked);
    renderWithProviders(<MenuRows words="" />);

    fireEvent.click(await screen.findByRole("button", { name: label }));
    unlist();

    expect(asked.mock.calls).toEqual([[ask]]);
  });

  it("lists a page's, and finds Print by name", async () => {
    front.tab = PAGE_TAB;
    const { rerender } = renderWithProviders(<MenuRows words="" />);

    await screen.findByText("# This page");
    expect(listed()).toMatchInlineSnapshot(`
      [
        "# Recent chats",
        "All chats",
        "# This page",
        "Add to Bookmarks",
        "Copy URL",
        "Open in browser",
        "Reload",
        "Find in Page",
        "New Tab Group",
        "New Tab",
        "Settings",
      ]
    `);

    rerender(<MenuRows words="print" />);
    expect(
      await screen.findByRole("button", { name: "Print… · This page" }),
    ).toBeTruthy();
  });

  it("lists a file's", async () => {
    front.tab = FILE_TAB;
    renderWithProviders(<MenuRows words="" />);

    await screen.findByText("# This file");
    expect(listed()).toMatchInlineSnapshot(`
      [
        "# Recent chats",
        "All chats",
        "# This file",
        "Add to Bookmarks",
        "Open in default app",
        "Show in Finder",
        "Copy Path",
        "New Tab Group",
        "New Tab",
        "Settings",
      ]
    `);
  });

  it("lists none for a tab that is no chat, page or file", () => {
    front.tab = { href: "/bookmarks", id: "bookmarks-tab", kind: "screen" };
    renderWithProviders(<MenuRows words="" />);

    expect(listed()).toMatchInlineSnapshot(`
      [
        "# Recent chats",
        "All chats",
        "# This tab",
        "New Tab in Split",
        "New Tab Group",
        "New Tab",
        "Settings",
      ]
    `);
  });
});

describe("the command menu's open tabs", () => {
  const ELSEWHERE_TAB: WindowTab = {
    group: "another-window",
    href: fileHref("/Users/sam/Instrument/plans-elsewhere.md"),
    id: "elsewhere-tab",
    kind: "screen",
  };
  const NEW_TAB: WindowTab = {
    group: "pricing",
    href: newChatHref(),
    id: "new-tab",
    kind: "screen",
  };

  it("finds a tab of another group by its title, named by its group, and goes to it", async () => {
    front.tab = CHAT_TAB;
    front.all = [CHAT_TAB, FILE_TAB, PAGE_TAB, ELSEWHERE_TAB, NEW_TAB];
    renderWithProviders(<MenuRows words="plans" />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Suite plans · quotes.csv" }),
    );

    expect(listed()).toMatchInlineSnapshot(`
      [
        "# Open tabs",
        "Suite plans · quotes.csv",
        "Search the web for “plans”",
      ]
    `);
    expect(shown.mock.calls).toEqual([[PAGE_TAB]]);
  });

  it("leaves a chat's tab, and the chat, to the group that goes by it", async () => {
    front.tab = PAGE_TAB;
    front.all = [CHAT_TAB, PAGE_TAB];
    renderWithProviders(<MenuRows words="roofer" />);

    await screen.findByRole("button", { name: "Roofer quotes" });
    expect(listed()).toMatchInlineSnapshot(`
      [
        "# Top result",
        "Roofer quotes",
        "Search the web for “roofer”",
      ]
    `);
  });

  it("lists a file once, as the tab showing it", async () => {
    front.tab = CHAT_TAB;
    front.all = [CHAT_TAB, PAGE_TAB, FILE_TAB];
    renderWithProviders(<MenuRows words="quotes" />);

    await screen.findByRole("button", { name: "quotes.csv · Suite plans" });
    await screen.findByRole("button", { name: "Roofer quotes" });
    expect(listed()).toMatchInlineSnapshot(`
      [
        "# Top result",
        "quotes.csv · Suite plans",
        "# Open tabs",
        "Roofer quotes",
        "Search the web for “quotes”",
      ]
    `);
  });

  it("leaves out a file in front, however lately it was opened", async () => {
    front.tab = FILE_TAB;
    front.all = [CHAT_TAB, PAGE_TAB, FILE_TAB];
    opened.files = ["/Users/sam/Instrument/quotes.csv", "/Users/sam/quotes.md"];
    renderWithProviders(<MenuRows words="quotes" />);

    await screen.findByRole("button", { name: /quotes\.md/ });
    expect(screen.queryByRole("button", { name: /quotes\.csv/ })).toBeNull();
  });

  it("leaves out the tab in front and a new tab nobody has written in", async () => {
    front.tab = CHAT_TAB;
    front.all = [CHAT_TAB, NEW_TAB];
    const { rerender } = renderWithProviders(<MenuRows words="roofer" />);

    await screen.findByRole("button", { name: "Roofer quotes" });
    expect(screen.queryByText("# Open tabs")).toBeNull();

    rerender(<MenuRows words="new" />);
    await screen.findByText("# Commands");
    expect(screen.queryByText("# Open tabs")).toBeNull();
  });
});

describe("the command menu's tab groups", () => {
  it("come first with nothing typed, but the one up, and the chats they have open are not listed again", async () => {
    front.tab = CHAT_TAB;
    front.all = [CHAT_TAB, PAGE_TAB, FILE_TAB];
    renderWithProviders(<MenuRows words="" />);

    await screen.findByRole("button", { name: "Suite plans" });
    expect(listed().slice(0, 6)).toMatchInlineSnapshot(`
      [
        "Suite plans",
        "# Recent chats",
        "All chats",
        "# This tab",
        "New Tab in Split",
        "New Tab Group",
      ]
    `);
  });

  it("show three with nothing typed, in the sidebar's order, and the rest by search", async () => {
    moreGroups.names = ["g1", "g2", "g3"];
    const pages = moreGroups.names.map(
      (name): WindowTab => ({
        group: name,
        id: `page-${name}`,
        kind: "page",
        openedAt: 0,
        title: `Page ${name}`,
        url: `https://example.com/${name}`,
      }),
    );
    front.tab = CHAT_TAB;
    front.all = [CHAT_TAB, PAGE_TAB, FILE_TAB, ...pages];
    renderWithProviders(<MenuRows words="" />);

    await screen.findByRole("button", { name: "Suite plans" });
    const rows = listed();
    expect(rows.slice(0, rows.indexOf("# Recent chats")))
      .toMatchInlineSnapshot(`
        [
          "Suite plans",
          "Page g1",
          "Page g2",
        ]
      `);
  });

  it("are brought up as they were left", async () => {
    front.tab = CHAT_TAB;
    front.all = [CHAT_TAB, PAGE_TAB, FILE_TAB];
    renderWithProviders(<MenuRows words="" />);

    fireEvent.click(await screen.findByRole("button", { name: "Suite plans" }));
    expect(went.showGroup.mock.calls).toEqual([
      ["pricing", { from: "roofer" }],
    ]);
    expect(went.select).not.toHaveBeenCalled();
  });

  it("are found by the tab they go by, which is the tab they come up on", async () => {
    front.tab = CHAT_TAB;
    front.all = [CHAT_TAB, PAGE_TAB, FILE_TAB];
    renderWithProviders(<MenuRows words="suite" />);

    fireEvent.click(await screen.findByRole("button", { name: "Suite plans" }));
    expect(listed()).toMatchInlineSnapshot(`
      [
        "# Top result",
        "Suite plans",
        "Search the web for “suite”",
      ]
    `);
    expect(went.select.mock.calls).toEqual([[PAGE_TAB.id]]);
    expect(went.showGroup.mock.calls).toEqual([
      ["pricing", { from: "roofer" }],
    ]);
  });

  it("are not found by the page in front", async () => {
    front.tab = PAGE_TAB;
    front.all = [CHAT_TAB, PAGE_TAB, FILE_TAB];
    renderWithProviders(<MenuRows words="suite" />);

    await screen.findByRole("button", { name: /Search the web/ });
    expect(screen.queryByRole("button", { name: "Suite plans" })).toBeNull();
  });
});
