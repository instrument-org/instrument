import { type WindowTab } from "@/client/atoms/window";
import { renderWithProviders } from "@/tests/render";
import { installWindowStubs } from "@/tests/window-stubs";
import { ChatIdSchema, StoreId } from "@instrument-org/workspace/client";
import { queryOptions } from "@tanstack/react-query";
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type Chat } from "./chats";
import { useCommandMenuRows } from "./command-menu";
import { chatHref } from "./window-href";

/** What the window says of its tabs and groups, and what the menu asked of it. */
const shell = vi.hoisted(() => ({
  chats: [] as unknown[],
  chatTab: undefined as undefined | { group: string; id: string },
  reopenClosed: vi.fn(),
  select: vi.fn(),
  showGroup: vi.fn(),
}));

// What a query answers, by its path; every other query stays pending.
const answers = new Map<string, unknown>();
vi.mock("@/client/rpc/client", () => {
  const pending = () => new Promise(() => undefined);
  const procedure = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      apply: pending,
      get(_target, key) {
        if (key === "queryOptions" || key === "experimental_liveOptions") {
          return () => ({
            queryFn: () =>
              answers.has(path.join("."))
                ? Promise.resolve(answers.get(path.join(".")))
                : pending(),
            queryKey: path,
          });
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
    reopenClosed: shell.reopenClosed,
    showGroup: shell.showGroup,
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
    active: undefined,
    allTabs: [] satisfies WindowTab[],
    chatTab: () => shell.chatTab,
    select: shell.select,
  }),
}));

vi.mock(
  "@/client/components/window/chat-list-query",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/client/components/window/chat-list-query")
    >()),
    chatListOptions: () =>
      queryOptions({
        queryFn: () => Promise.resolve(shell.chats),
        queryKey: ["chat-list"],
      }),
  }),
);

const NOW = Date.now();

function chat(slug: string, title: string, minutesAgo: number): Chat {
  return {
    archived: false,
    firstAsk: title,
    holds: { apps: [], files: [], sites: [] },
    id: ChatIdSchema.parse(`2026-11-14-${slug}`),
    lastUserMessageAt: NOW - minutesAgo * 60_000,
    sessionId: StoreId.newSessionId(),
    starred: false,
    status: "idle",
    title,
    titleByApp: true,
    unread: false,
    unreadByUser: false,
    working: false,
  };
}

const REVIEW = chat("review", "Review the wireframes", 1);
const PHONE = chat("phone", "New wireframes for the phone", 2);
const FARMERS = chat("farmers", "Farmers market plan", 3);

const openScreen = vi.fn();

/** The menu's rows for words: each heading, and each row a button named by its label. */
function MenuRows({ words }: { words: string }) {
  const { rows } = useCommandMenuRows({
    active: true,
    done: (run) => run,
    openPage: () => undefined,
    openScreen,
    showTab: () => undefined,
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
              {row.label}
            </button>
          </li>
        ) : null,
      )}
    </ul>
  );
}

const listed = () =>
  screen.getAllByRole("listitem").map((item) => item.textContent);

beforeEach(() => {
  shell.chats = [REVIEW, PHONE, FARMERS];
  // The person pinned a folder named wireframes; frames is a disk.
  answers.set("workspace.computer.places", {
    favorites: [
      {
        kind: "folder",
        name: "wireframes",
        path: "/Users/mac-user/wireframes",
      },
    ],
    volumes: [{ kind: "drive", name: "frames", path: "/Volumes/frames" }],
  });
  answers.set("history.live.files", [
    { at: NOW, openCount: 2, path: "/Users/mac-user/wireframe-notes.md" },
  ]);
  answers.set("workspace.computer.describe", [
    { name: "wireframe-notes.md", path: "/Users/mac-user/wireframe-notes.md" },
  ]);
  answers.set("history.searchPicks", []);
});

afterEach(() => {
  installWindowStubs();
  answers.clear();
  shell.chatTab = undefined;
  vi.clearAllMocks();
});

describe("what the command menu lists first", () => {
  it("is a pinned folder the words start, over the chats that contain them", async () => {
    renderWithProviders(<MenuRows words="wire" />);

    await screen.findByRole("button", { name: "wireframe-notes.md" });
    expect(listed()).toMatchInlineSnapshot(`
      [
        "wireframes",
        "# Files",
        "wireframe-notes.md",
        "# Chats",
        "Review the wireframes",
        "New wireframes for the phone",
        "Search the web for “wire”",
      ]
    `);
  });

  it("lists the files and folders found on the disk once each, with the files", async () => {
    answers.set("files.findByName", [
      {
        isFolder: true,
        name: "wireframes",
        path: "/Users/mac-user/wireframes",
      },
      {
        isFolder: false,
        name: "wireframe-notes.md",
        path: "/Users/mac-user/wireframe-notes.md",
      },
      {
        isFolder: true,
        name: "wire-gauges",
        path: "/Users/mac-user/work/wire-gauges",
      },
    ]);
    renderWithProviders(<MenuRows words="wire" />);

    await screen.findByRole("button", { name: "wire-gauges" });
    expect(listed()).toMatchInlineSnapshot(`
      [
        "wireframes",
        "# Files",
        "wireframe-notes.md",
        "wire-gauges",
        "# Chats",
        "Review the wireframes",
        "New wireframes for the phone",
        "Search the web for “wire”",
      ]
    `);
  });

  it("is nothing promoted when the words only start a later word", async () => {
    renderWithProviders(<MenuRows words="phone" />);

    await screen.findByRole("button", { name: PHONE.title });
    expect(listed()).toMatchInlineSnapshot(`
      [
        "# Chats",
        "New wireframes for the phone",
        "Search the web for “phone”",
      ]
    `);
  });

  it("is what was picked for these words last time", async () => {
    answers.set("history.searchPicks", [
      { at: NOW, picked: `chat:${PHONE.id}`, typed: "wire" },
    ]);
    renderWithProviders(<MenuRows words="wire" />);

    await screen.findByRole("button", { name: "wireframe-notes.md" });
    await vi.waitFor(() => {
      expect(listed()[0]).toBe(PHONE.title);
    });
    expect(listed()).toMatchInlineSnapshot(`
      [
        "New wireframes for the phone",
        "# Files",
        "wireframes",
        "wireframe-notes.md",
        "# Chats",
        "Review the wireframes",
        "Search the web for “wire”",
      ]
    `);
  });

  it("is the row run for these words, the next time they are typed", async () => {
    const { rerender } = renderWithProviders(<MenuRows words="wire" />);
    fireEvent.click(await screen.findByRole("button", { name: REVIEW.title }));

    rerender(<MenuRows words="" />);
    rerender(<MenuRows words="wire" />);

    await vi.waitFor(() => {
      expect(listed()[0]).toBe(REVIEW.title);
    });
  });
});

describe("one of the app's own pages", () => {
  it.each([
    ["chats", "Chats"],
    ["files", "Files"],
    ["browser", "Browser"],
    ["settings", "Settings"],
    ["history", "History"],
    ["bookmarks", "Bookmarks"],
    ["apps", "Apps"],
    ["what's new", "What's new"],
    ["extensions", "Extensions"],
  ])("is the first row for its name, %s", async (words, title) => {
    renderWithProviders(<MenuRows words={words} />);

    await screen.findAllByRole("button", { name: title });
    expect(listed()[0]).toBe(title);
  });

  it("is listed among the pages when the words are only inside its name", async () => {
    shell.chats = [];
    renderWithProviders(<MenuRows words="mark" />);

    await screen.findByRole("button", { name: "Bookmarks" });
    expect(listed()).toMatchInlineSnapshot(`
      [
        "# Pages",
        "Bookmarks",
        "Search the web for “mark”",
      ]
    `);
  });
});

describe("a part of Settings", () => {
  it("is listed among the pages by its name", async () => {
    shell.chats = [];
    renderWithProviders(<MenuRows words="providers" />);

    await screen.findByRole("button", { name: "Providers" });
    expect(listed()).toMatchInlineSnapshot(`
      [
        "Providers",
        "Search the web for “providers”",
      ]
    `);
  });

  it("goes by Apps settings beside the Apps page", async () => {
    shell.chats = [];
    renderWithProviders(<MenuRows words="apps" />);

    await screen.findByRole("button", { name: "Apps settings" });
    expect(listed()).toMatchInlineSnapshot(`
      [
        "Apps",
        "# Pages",
        "Apps settings",
        "Search the web for “apps”",
      ]
    `);
  });
});

describe("sending feedback", () => {
  it("is a command found by its name", async () => {
    shell.chats = [];
    renderWithProviders(<MenuRows words="feedback" />);

    await screen.findByRole("button", { name: "Send feedback" });
    expect(listed()).toMatchInlineSnapshot(`
      [
        "# Commands",
        "Send feedback",
        "Search the web for “feedback”",
      ]
    `);
  });
});

describe("the debug pages", () => {
  it("are not listed outside developer mode", async () => {
    shell.chats = [];
    renderWithProviders(<MenuRows words="debug" />);

    await screen.findByRole("button", { name: "Search the web for “debug”" });
    expect(listed()).toMatchInlineSnapshot(`
      [
        "Search the web for “debug”",
      ]
    `);
  });
});

describe("a name one wrong letter away", () => {
  it("is found when the words find nothing as typed", async () => {
    renderWithProviders(<MenuRows words="wirefarmes" />);

    await screen.findByRole("button", { name: "wireframes" });
    expect(listed()).toMatchInlineSnapshot(`
      [
        "# Files",
        "wireframes",
        "# Chats",
        "Review the wireframes",
        "New wireframes for the phone",
        "Search the web for “wirefarmes”",
      ]
    `);
  });

  it("is left out when they find something", async () => {
    renderWithProviders(<MenuRows words="farme" />);

    await screen.findByRole("button", { name: FARMERS.title });
    expect(listed()).toMatchInlineSnapshot(`
      [
        "Farmers market plan",
        "Search the web for “farme”",
      ]
    `);
  });
});

describe("the command menu with nothing typed", () => {
  it("lists the chats talked to last, newest first, then All chats and a few commands", async () => {
    renderWithProviders(<MenuRows words="" />);

    await screen.findByRole("button", { name: FARMERS.title });
    expect(listed()).toMatchInlineSnapshot(`
      [
        "# Recent chats",
        "Review the wireframes",
        "New wireframes for the phone",
        "Farmers market plan",
        "All chats",
        "# Commands",
        "New tab group",
        "New tab",
        "Settings",
      ]
    `);
  });
});

describe("a chat's row in the command menu", () => {
  it("brings up the open group the chat is in", async () => {
    shell.chatTab = { group: "roofer", id: "chat-tab" };
    renderWithProviders(<MenuRows words="farmers" />);
    fireEvent.click(await screen.findByRole("button", { name: FARMERS.title }));

    expect(shell.select.mock.calls).toEqual([["chat-tab"]]);
    expect(shell.showGroup.mock.calls).toEqual([["roofer", {}]]);
    expect(openScreen).not.toHaveBeenCalled();
  });

  it("opens a chat in no group as a screen", async () => {
    renderWithProviders(<MenuRows words="farmers" />);
    fireEvent.click(await screen.findByRole("button", { name: FARMERS.title }));

    expect(shell.showGroup).not.toHaveBeenCalled();
    expect(openScreen.mock.calls).toEqual([[chatHref(FARMERS.id)]]);
  });
});
