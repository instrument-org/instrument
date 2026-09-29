import {
  CHATS_HREF,
  draftGroupOf,
  NEW_TAB_HREF,
  WEB_HREF,
  withChatNewTabs,
  type WindowTab,
  windowTabsAtom,
} from "@/client/atoms/orchestrator";
import { fileHref } from "@/shared/computer-href";
import { renderWithProviders } from "@/tests/render";
import { StoreId } from "@instrument-org/workspace/client";
import { act, fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import {
  chatOfHrefPrefix,
  pageTakesOver,
  sameHref,
  useWindowTabs,
} from "./window-tabs";

const CHAT_A = StoreId.newSessionId();
const CHAT_B = StoreId.newSessionId();

function Navigation() {
  const tabs = useWindowTabs();
  const [stepped, setStepped] = useState<string>();
  return (
    <>
      <button
        onClick={() => {
          tabs.visitHref("task", fileHref("/Users/me/notes/plan.md"));
        }}
      >
        Open the file in its tab
      </button>
      <button
        onClick={() => {
          setStepped(tabs.stepTab("task", -1) ?? "nowhere");
        }}
      >
        Step the tab back
      </button>
      <span data-testid="stepped">{stepped}</span>
      <button
        onClick={() => {
          tabs.navigateScreen("/orchestrator/computer");
        }}
      >
        Folder
      </button>
      <button
        onClick={() => {
          tabs.navigateScreen("/orchestrator/apps");
        }}
      >
        Apps
      </button>
      <button onClick={() => tabs.step(-1)}>Back</button>
      <button onClick={() => tabs.stepVisit(-1)}>Previous visit</button>
      <button onClick={() => tabs.stepVisit(1)}>Next visit</button>
      <button onClick={() => tabs.openOrFocusScreen("/orchestrator/computer")}>
        Conversation file
      </button>
      <button onClick={() => tabs.openScreen(`${CHATS_HREF}/${CHAT_A}`)}>
        Chat A
      </button>
      <button onClick={() => tabs.openScreen(`${CHATS_HREF}/${CHAT_B}`)}>
        Chat B
      </button>
      <button onClick={() => tabs.openScreen("/orchestrator/apps")}>
        Open apps
      </button>
      <button
        onClick={() => {
          tabs.closeActive();
        }}
      >
        Close active
      </button>
      <button
        onClick={() => {
          tabs.leaveGroup();
        }}
      >
        Leave
      </button>
      <button
        onClick={() => {
          tabs.showDraft("d1");
        }}
      >
        Draft
      </button>
      <button
        onClick={() => {
          tabs.openScreen(NEW_TAB_HREF);
        }}
      >
        Home
      </button>
      <button
        onClick={() => {
          tabs.adoptGroup(draftGroupOf("d1"), CHAT_B);
        }}
      >
        Adopt
      </button>
      <button
        onClick={() => {
          tabs.openScreen("/orchestrator/ideas", { group: CHAT_B });
        }}
      >
        Open ideas for B
      </button>
      <span data-testid="strip">
        {tabs.tabs
          .map((tab) => (tab.kind === "screen" ? tab.href : tab.url))
          .join("|")}
      </span>
    </>
  );
}

/** A window with one group up, holding the tab given; every tab belongs to a group. */
function setup(tab: WindowTab) {
  const { store } = renderWithProviders(<Navigation />);
  act(() => {
    store.set(windowTabsAtom, {
      activeId: tab.id,
      group: "g",
      tabs: [{ ...tab, group: "g" }],
    });
  });
  return () => store.get(windowTabsAtom);
}

describe("window navigation", () => {
  it("keeps ordinary screen navigation in one tab with a back trail", () => {
    const read = setup({
      href: "/orchestrator/tasks/example",
      id: "task",
      kind: "screen",
    });
    fireEvent.click(screen.getByText("Folder"));
    expect(read().tabs).toHaveLength(1);
    fireEvent.click(screen.getByText("Back"));
    expect(read().tabs[0]).toMatchObject({
      href: "/orchestrator/tasks/example",
      id: "task",
    });
    fireEvent.click(screen.getByText("Apps"));
    expect(read().tabs[0]).toMatchObject({
      trail: ["/orchestrator/tasks/example", "/orchestrator/apps"],
    });
  });

  it("steps a tab back along its own trail, and nowhere past its start", () => {
    const folder = "/orchestrator/computer?path=notes%2F&root=~";
    const read = setup({ href: folder, id: "task", kind: "screen" });
    fireEvent.click(screen.getByText("Open the file in its tab"));
    expect(read().tabs[0]).toMatchObject({
      at: 1,
      href: fileHref("/Users/me/notes/plan.md"),
    });
    fireEvent.click(screen.getByText("Step the tab back"));
    expect(screen.getByTestId("stepped").textContent).toBe(folder);
    expect(read().tabs).toHaveLength(1);
    expect(read().tabs[0]).toMatchObject({ at: 0, href: folder });
    fireEvent.click(screen.getByText("Step the tab back"));
    expect(screen.getByTestId("stepped").textContent).toBe("nowhere");
    expect(read().tabs[0]).toMatchObject({ at: 0, href: folder });
  });

  it("reuses the website's tab and restores its guest through Back and Forward", () => {
    const page: WindowTab = {
      id: "guest",
      kind: "page",
      openedAt: 1,
      url: "https://example.com",
    };
    const read = setup(page);
    fireEvent.click(screen.getByText("Folder"));
    expect(read().tabs).toHaveLength(1);
    expect(read().tabs[0]).toMatchObject({ kind: "screen", stripKey: "guest" });
    fireEvent.click(screen.getByText("Previous visit"));
    expect(read().tabs[0]).toMatchObject(page);
    fireEvent.click(screen.getByText("Next visit"));
    expect(read().tabs[0]).toMatchObject({
      href: "/orchestrator/computer",
      kind: "screen",
    });
  });

  it("opens conversation destinations separately and focuses an existing destination", () => {
    const read = setup({
      href: "/orchestrator/tasks/example",
      id: "task",
      kind: "screen",
    });
    fireEvent.click(screen.getByText("Conversation file"));
    expect(read().tabs).toHaveLength(2);
    expect(read().tabs[0]?.id).toBe("task");
    fireEvent.click(screen.getByText("Conversation file"));
    expect(read().tabs).toHaveLength(2);
  });
});

describe("a chat's tabs", () => {
  const strip = () => screen.getByTestId("strip").textContent;
  const active = (read: () => { activeId: null | string; tabs: WindowTab[] }) =>
    read().tabs.find((tab) => tab.id === read().activeId);

  it("keeps each chat's tabs in a group of its own, with the chat over them rather than among them", () => {
    const read = setup({
      href: "/orchestrator/apps",
      id: "apps",
      kind: "screen",
    });
    fireEvent.click(screen.getByText("Chat A"));
    expect(read().group).toBe(CHAT_A);
    expect(strip()).toBe("");
    expect(read().activeId).toBeNull();
    // Opened while the chat is up, so the chat's.
    fireEvent.click(screen.getByText("Open apps"));
    expect(strip()).toBe("/orchestrator/apps");
    expect(active(read)?.group).toBe(CHAT_A);
    // Another chat swaps the whole row.
    fireEvent.click(screen.getByText("Chat B"));
    expect(strip()).toBe("");
    // Coming back lands where the chat was left; asking again while it is
    // up changes nothing.
    fireEvent.click(screen.getByText("Chat A"));
    expect(strip()).toBe("/orchestrator/apps");
    expect(active(read)).toMatchObject({ href: "/orchestrator/apps" });
    const before = read();
    fireEvent.click(screen.getByText("Chat A"));
    expect(read()).toBe(before);
    // Leaving shows nothing; every group keeps what it has.
    fireEvent.click(screen.getByText("Leave"));
    expect(read().group).toBeUndefined();
    expect(strip()).toBe("");
    expect(read().tabs).toHaveLength(2);
  });

  it("closes a chat's last tab and keeps the chat up with nothing under it", () => {
    const read = setup({
      href: "/orchestrator/apps",
      id: "apps",
      kind: "screen",
    });
    fireEvent.click(screen.getByText("Chat A"));
    fireEvent.click(screen.getByText("Open apps"));
    fireEvent.click(screen.getByText("Close active"));
    expect(read().group).toBe(CHAT_A);
    expect(strip()).toBe("");
    expect(read().activeId).toBeNull();
    fireEvent.click(screen.getByText("Open apps"));
    expect(strip()).toBe("/orchestrator/apps");
  });

  it("files a tab opened for a chat that is not up in that chat's group, behind", () => {
    const read = setup({
      href: "/orchestrator/apps",
      id: "apps",
      kind: "screen",
    });
    fireEvent.click(screen.getByText("Chat A"));
    fireEvent.click(screen.getByText("Open ideas for B"));
    // Still on A, with nothing under it.
    expect(read().group).toBe(CHAT_A);
    expect(strip()).toBe("");
    // B's group was made by the tab landing in it.
    fireEvent.click(screen.getByText("Chat B"));
    expect(strip()).toBe("/orchestrator/ideas");
  });
});

describe("a draft's tabs", () => {
  const strip = () => screen.getByTestId("strip").textContent;

  it("gathers from the new-tab page and hands everything to the chat exactly as it is", () => {
    const read = setup({
      href: "/orchestrator/apps",
      id: "apps",
      kind: "screen",
    });
    fireEvent.click(screen.getByText("Draft"));
    expect(read().group).toBe(draftGroupOf("d1"));
    fireEvent.click(screen.getByText("Home"));
    expect(strip()).toBe(NEW_TAB_HREF);
    // The home page is a tab like any other: a screen it is sent to takes
    // its place, and a second thing asked for as a tab of its own lands
    // beside it.
    fireEvent.click(screen.getByText("Apps"));
    fireEvent.click(screen.getByText("Conversation file"));
    expect(strip()).toBe("/orchestrator/apps|/orchestrator/computer");
    const gathered = read()
      .tabs.filter((tab) => tab.group === draftGroupOf("d1"))
      .map((tab) => tab.id);
    const up = read().activeId;
    fireEvent.click(screen.getByText("Adopt"));
    expect(read().group).toBe(CHAT_B);
    expect(strip()).toBe("/orchestrator/apps|/orchestrator/computer");
    // The same tabs, under the chat now, the same one up.
    expect(
      read()
        .tabs.filter((tab) => tab.group === CHAT_B)
        .map((tab) => tab.id),
    ).toEqual(gathered);
    expect(read().activeId).toBe(up);
    expect(read().tabs.some((tab) => tab.group === draftGroupOf("d1"))).toBe(
      false,
    );
    // The group handed over is gone from the memory of what each group had
    // up, so a window that starts many drafts does not keep a key per one.
    expect(read().activeByGroup ?? {}).not.toHaveProperty(draftGroupOf("d1"));
  });

  // A task the chat started can open its browser before the start comes
  // back, and its tab is filed under the chat's own id then; adoption
  // keeps it beside what the draft gathered rather than dropping it.
  it("keeps a tab already filed under the chat when the draft is handed over", () => {
    const read = setup({
      href: "/orchestrator/apps",
      id: "apps",
      kind: "screen",
    });
    fireEvent.click(screen.getByText("Draft"));
    fireEvent.click(screen.getByText("Home"));
    fireEvent.click(screen.getByText("Apps"));
    fireEvent.click(screen.getByText("Open ideas for B"));
    expect(read().tabs.filter((tab) => tab.group === CHAT_B)).toHaveLength(1);
    fireEvent.click(screen.getByText("Adopt"));
    expect(
      read()
        .tabs.filter((tab) => tab.group === CHAT_B)
        .map((tab) => (tab.kind === "screen" ? tab.href : tab.url)),
    ).toEqual(["/orchestrator/ideas", "/orchestrator/apps"]);
    expect(strip()).toBe("/orchestrator/ideas|/orchestrator/apps");
  });

  it("never runs out of tabs: closing the last one puts the new-tab page back", () => {
    const read = setup({
      href: "/orchestrator/apps",
      id: "apps",
      kind: "screen",
    });
    fireEvent.click(screen.getByText("Draft"));
    fireEvent.click(screen.getByText("Home"));
    fireEvent.click(screen.getByText("Apps"));
    expect(strip()).toBe("/orchestrator/apps");
    fireEvent.click(screen.getByText("Close active"));
    expect(strip()).toBe(NEW_TAB_HREF);
    expect(read().activeId).not.toBeNull();
  });
});

describe("chatOfHrefPrefix", () => {
  const chats = [
    StoreId.SessionSchema.parse("ses_01JAAAAAAAAAAAAAAAAAAAAAAA"),
    StoreId.SessionSchema.parse("ses_01JABBBBBBBBBBBBBBBBBBBBBB"),
    StoreId.SessionSchema.parse("ses_01JCCCCCCCCCCCCCCCCCCCCCCC"),
  ];

  it.each([
    ["the start of one id", "/orchestrator/chats/ses_01JC", chats[2]],
    [
      "a whole id",
      "/orchestrator/chats/ses_01JAAAAAAAAAAAAAAAAAAAAAAA",
      chats[0],
    ],
    ["an id in the wrong case", "/orchestrator/chats/SES_01jcc", chats[2]],
    ["a start two ids share", "/orchestrator/chats/ses_01JA", undefined],
    ["a start no id has", "/orchestrator/chats/ses_01JZ", undefined],
    ["the chats as a whole", "/orchestrator/chats", undefined],
    ["another screen", "/orchestrator/tasks/ses_01JC", undefined],
  ])("resolves %s", (_case, href, expected) => {
    expect(chatOfHrefPrefix(href, chats)).toBe(expected);
  });
});

describe("sameHref", () => {
  const FILE = "/Users/casey/notes/alpha.md";

  it.each([
    // The router writes a pushed address back out with `~` as `%7E`, and the
    // two have to read as one screen or the tab never follows the push.
    [
      "a file's address and the router's spelling of it",
      fileHref(FILE),
      `/orchestrator/computer?file=${encodeURIComponent(FILE)}&path=&root=%7E`,
      true,
    ],
    [
      "the same search in another order",
      "/orchestrator/computer?root=~&path=",
      "/orchestrator/computer?path=&root=~",
      true,
    ],
    [
      "two files",
      fileHref(FILE),
      fileHref("/Users/casey/notes/beta.md"),
      false,
    ],
  ])("compares %s", (_case, a, b, expected) => {
    expect(sameHref(a, b)).toBe(expected);
  });
});

describe("pageTakesOver", () => {
  const FOLDER = "/Users/casey/site";
  const FILE = `${FOLDER}/a.html`;
  const fileScreen = fileHref(FILE, { tree: FOLDER });
  const folderScreen = `/orchestrator/computer?path=&root=${encodeURIComponent(FOLDER)}`;
  const PAGE = StoreId.newSessionId();

  // The page's own record still names the file when the page moves on: what
  // the tab stands on is the address the page went to, and back from there
  // is the file, not the folder the file was opened from.
  it("puts the page in the tab's place at the address it went to, with the file behind it", () => {
    const next = pageTakesOver(
      {
        activeByGroup: {},
        activeId: "finder",
        group: CHAT_A,
        tabs: [
          {
            at: 1,
            group: CHAT_A,
            href: fileScreen,
            id: "finder",
            kind: "screen",
            trail: [folderScreen, fileScreen],
          },
          {
            group: "page:finder",
            id: PAGE,
            kind: "page",
            openedAt: 0,
            openedUrl: `file://${FILE}`,
            url: `file://${FILE}`,
          },
        ],
      },
      { page: PAGE, tab: "finder", url: "https://example.com/" },
    );
    expect(next.activeId).toBe(PAGE);
    expect(next.tabs).toHaveLength(1);
    const [tab] = next.tabs;
    expect(tab).toMatchObject({
      group: CHAT_A,
      id: PAGE,
      kind: "page",
      stripKey: "finder",
      url: "https://example.com/",
    });
    expect(tab?.past?.at(-1)).toMatchObject({ at: 1, href: fileScreen });
  });
});

describe("withChatNewTabs", () => {
  it("reads a chat's kept new-tab page as the web, wherever the tab has been", () => {
    const folder = fileHref("/Users/me/notes.md");
    const { tabs } = withChatNewTabs({
      activeId: "home",
      tabs: [
        {
          at: 0,
          future: [{ href: folder, id: "next", kind: "screen" }],
          group: CHAT_A,
          href: NEW_TAB_HREF,
          id: "home",
          kind: "screen",
          past: [{ href: NEW_TAB_HREF, id: "before", kind: "screen" }],
          trail: [NEW_TAB_HREF, folder],
        },
      ],
    });
    expect(tabs[0]).toMatchObject({
      future: [{ href: folder }],
      href: WEB_HREF,
      past: [{ href: WEB_HREF }],
      trail: [WEB_HREF, folder],
    });
  });

  it("leaves a draft's new-tab page, which the draft draws", () => {
    const draft: WindowTab = {
      group: draftGroupOf("d1"),
      href: NEW_TAB_HREF,
      id: "home",
      kind: "screen",
    };
    expect(withChatNewTabs({ activeId: null, tabs: [draft] }).tabs).toEqual([
      draft,
    ]);
  });
});
