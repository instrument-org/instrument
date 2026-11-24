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
import { chatHref } from "./window-href";

/** The tab up on the side with the keyboard. */
const front = vi.hoisted((): { tab: undefined | WindowTab } => ({
  tab: undefined,
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
  }),
}));

vi.mock("@/client/components/theme-provider", () => ({
  useTheme: () => ({ setTheme: () => undefined, theme: "system" }),
}));

vi.mock("@/client/components/window/window-tabs", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/client/components/window/window-tabs")
  >()),
  useWindowTabs: () => ({ active: front.tab }),
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
  href: chatHref(ROOFER),
  id: "chat-tab",
  kind: "screen",
};
const PAGE_TAB: WindowTab = {
  id: "tab_01M7EKJA7JST69N0RVMKWTP7Q8",
  kind: "page",
  openedAt: 0,
  title: "Suite plans",
  url: "https://www.zendesk.com/pricing/",
};
const FILE_TAB: WindowTab = {
  href: fileHref("/Users/sam/Instrument/quotes.csv"),
  id: "file-tab",
  kind: "screen",
};

/** The menu's rows for words: each heading, and each row a button named by its label and detail. */
function MenuRows({ words }: { words: string }) {
  const { rows } = useCommandMenuRows({
    active: true,
    done: (run) => run,
    openPage: () => undefined,
    openScreen: () => undefined,
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
  front.tab = undefined;
  installWindowStubs();
});

describe("the command menu's actions for the tab in front", () => {
  it("lists five of a chat's between Recent and Commands", async () => {
    front.tab = CHAT_TAB;
    renderWithProviders(<MenuRows words="" />);

    await screen.findByText("# This chat");
    expect(listed()).toMatchInlineSnapshot(`
      [
        "# Recent",
        "Roofer quotes",
        "# This chat",
        "Rename",
        "Star",
        "Move to Project…",
        "Archive",
        "Delete Chat…",
        "# Commands",
        "New tab group",
        "New tab",
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
        "# Commands",
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
        "# This page",
        "Add to Bookmarks",
        "Copy URL",
        "Open in browser",
        "Reload",
        "Find in page",
        "# Commands",
        "New tab group",
        "New tab",
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
        "# This file",
        "Add to Bookmarks",
        "Open in default app",
        "Show in Finder",
        "Copy Path",
        "# Commands",
        "New tab group",
        "New tab",
        "Settings",
      ]
    `);
  });

  it("lists none for a tab that is no chat, page or file", () => {
    front.tab = { href: "/bookmarks", id: "bookmarks-tab", kind: "screen" };
    renderWithProviders(<MenuRows words="" />);

    expect(listed()).toMatchInlineSnapshot(`
      [
        "# Commands",
        "New tab group",
        "New tab",
        "Settings",
      ]
    `);
  });
});
