import {
  applyBookmarkOps,
  type BookmarkOp,
  type Bookmarks,
  OTHER_ROOT,
} from "@/shared/bookmarks";
import { describe, expect, it } from "vitest";

import {
  bookmarkEvents,
  bookmarkTree,
  type ChromeBookmark,
  createOp,
  moveOps,
  opensInApp,
  recentBookmarks,
  removeOp,
  searchBookmarks,
  updateOps,
} from "./extension-bookmarks";

/**
 * The bar: News, Work (with Docs, and Clients with Acme), Notes.
 * All Bookmarks: Chat, Recipes (empty).
 */
const STATE: Bookmarks = {
  bookmarks: [
    { id: "news", order: 0, title: "News", url: "https://news.example.com/" },
    {
      id: "notes",
      order: 2,
      title: "Notes",
      url: "file:///Users/mac-user/Notes/",
    },
    {
      folder: "work",
      id: "docs",
      order: 0,
      title: "Docs",
      url: "https://docs.example.com/",
    },
    {
      folder: "clients",
      id: "acme",
      order: 0,
      title: "Acme",
      url: "https://acme.example.com/",
    },
    {
      id: "chat",
      order: 0,
      root: OTHER_ROOT,
      title: "Plan",
      url: "instrument://chat/chat_1",
    },
  ],
  folders: [
    { id: "work", order: 1, title: "Work" },
    { folder: "work", id: "clients", order: 1, title: "Clients" },
    { id: "recipes", order: 1, root: OTHER_ROOT, title: "Recipes" },
  ],
};

/** When each was last changed: the bookmarks in the order listed, a minute apart. */
const DATES: Record<string, number> = {
  acme: 4000,
  chat: 5000,
  clients: 3000,
  docs: 3500,
  news: 1000,
  notes: 2000,
  recipes: 6000,
  work: 1500,
};

const dateOf = (id: string) => DATES[id];

/** A tree as lines, indented by depth: `index id "title" url`. */
function outline(node: ChromeBookmark, depth = 0): string[] {
  return [
    `${"  ".repeat(depth)}${node.index ?? "-"} ${node.id} "${node.title}"${node.url ? ` ${node.url}` : ""}`,
    ...(node.children ?? []).flatMap((child) => outline(child, depth + 1)),
  ];
}

function after(...ops: BookmarkOp[]) {
  return outline(bookmarkTree(applyBookmarkOps(STATE, ops), dateOf));
}

describe("bookmarkTree", () => {
  it("lays the bar and All Bookmarks out under Chrome's root, in the app's order", () => {
    expect(outline(bookmarkTree(STATE, dateOf))).toMatchInlineSnapshot(`
      [
        "- 0 """,
        "  0 1 "Bookmarks bar"",
        "    0 news "News" https://news.example.com/",
        "    1 work "Work"",
        "      0 docs "Docs" https://docs.example.com/",
        "      1 clients "Clients"",
        "        0 acme "Acme" https://acme.example.com/",
        "    2 notes "Notes" file:///Users/mac-user/Notes/",
        "  1 2 "All Bookmarks"",
        "    0 chat "Plan" instrument://chat/chat_1",
        "    1 recipes "Recipes"",
      ]
    `);
  });

  it("dates each by its last change, a folder's group by the newest inside it", () => {
    const tree = bookmarkTree(STATE, dateOf);
    const [bar, other] = tree.children ?? [];
    const work = bar?.children?.[1];
    expect({
      bar: [bar?.dateAdded, bar?.dateGroupModified, bar?.folderType],
      empty: other?.children?.[1]?.children,
      root: [tree.dateAdded, tree.dateGroupModified],
      work: [work?.dateAdded, work?.dateGroupModified],
    }).toMatchInlineSnapshot(`
      {
        "bar": [
          1000,
          4000,
          "bookmarks-bar",
        ],
        "empty": [],
        "root": [
          1000,
          6000,
        ],
        "work": [
          1500,
          4000,
        ],
      }
    `);
  });
});

describe("searchBookmarks and recentBookmarks", () => {
  const tree = bookmarkTree(STATE, dateOf);
  const ids = (nodes: ChromeBookmark[]) => nodes.map((node) => node.id);

  it.each([
    ["example docs", ["docs"]],
    ["EXAMPLE", ["news", "docs", "acme"]],
    ["work", ["work"]],
    ["bookmarks", []],
    [{ url: "instrument://chat/chat_1" }, ["chat"]],
    [{ title: "Clients" }, ["clients"]],
    [{ query: "example", title: "Acme" }, ["acme"]],
  ] as const)("finds %j", (query, expected) => {
    expect(ids(searchBookmarks(tree, query))).toEqual(expected);
  });

  it("answers the bookmarks changed last, newest first", () => {
    expect(ids(recentBookmarks(tree, 3))).toEqual(["chat", "acme", "docs"]);
    expect(() => recentBookmarks(tree, 0)).toThrow(
      "numberOfItems cannot be less than 1.",
    );
  });
});

describe("createOp", () => {
  it("puts a bookmark where it asks, as the parent it names lists it", () => {
    const cases = {
      "end of a folder": { index: 2, parentId: "work" },
      "first on the bar": { index: 0, parentId: "1" },
      "in an empty folder": { parentId: "recipes" },
      "middle of a folder": { index: 1, parentId: "work" },
      "no parent": {},
    };
    expect(
      Object.fromEntries(
        Object.entries(cases).map(([name, details]) => {
          const lines = after(
            createOp(
              STATE,
              { ...details, title: "New", url: "https://new.example.com/" },
              "new",
            ),
          );
          const at = lines.findIndex((line) => line.includes(" new "));
          // The line above it and the one it is, under its parent.
          return [name, lines.slice(at - 1, at + 1).map((line) => line.trim())];
        }),
      ),
    ).toMatchInlineSnapshot(`
      {
        "end of a folder": [
          "0 acme "Acme" https://acme.example.com/",
          "2 new "New" https://new.example.com/",
        ],
        "first on the bar": [
          "0 1 "Bookmarks bar"",
          "0 new "New" https://new.example.com/",
        ],
        "in an empty folder": [
          "1 recipes "Recipes"",
          "0 new "New" https://new.example.com/",
        ],
        "middle of a folder": [
          "0 docs "Docs" https://docs.example.com/",
          "1 new "New" https://new.example.com/",
        ],
        "no parent": [
          "1 recipes "Recipes"",
          "2 new "New" https://new.example.com/",
        ],
      }
    `);
  });

  it("makes a folder where no address is given", () => {
    expect(createOp(STATE, { parentId: "1", title: "Later" }, "later"))
      .toMatchInlineSnapshot(`
        {
          "folder": {
            "id": "later",
            "order": 3,
            "title": "Later",
          },
          "type": "addFolder",
        }
      `);
  });

  it.each([
    [{ parentId: "0" }, "Can't modify the root bookmark folders."],
    [{ parentId: "news" }, "Parent must be a folder."],
    [{ parentId: "gone" }, "Can't find parent bookmark for id."],
    [{ index: 3, parentId: "work" }, "Index out of bounds."],
    [{ url: "not a url" }, "Invalid URL."],
  ])("refuses %j", (details, error) => {
    expect(() => createOp(STATE, details, "new")).toThrow(error);
  });
});

describe("moveOps", () => {
  const moved = (
    id: string,
    destination: { index?: number; parentId?: string },
  ) => after(...moveOps(STATE, id, destination));

  it("counts the index with the one moving still in place, as Chrome does", () => {
    expect({
      "news to 2": moved("news", { index: 2 }).slice(2, 8),
      "notes to 0": moved("notes", { index: 0 }).slice(2, 8),
    }).toMatchInlineSnapshot(`
      {
        "news to 2": [
          "    0 work "Work"",
          "      0 docs "Docs" https://docs.example.com/",
          "      1 clients "Clients"",
          "        0 acme "Acme" https://acme.example.com/",
          "    1 news "News" https://news.example.com/",
          "    2 notes "Notes" file:///Users/mac-user/Notes/",
        ],
        "notes to 0": [
          "    0 notes "Notes" file:///Users/mac-user/Notes/",
          "    1 news "News" https://news.example.com/",
          "    2 work "Work"",
          "      0 docs "Docs" https://docs.example.com/",
          "      1 clients "Clients"",
          "        0 acme "Acme" https://acme.example.com/",
        ],
      }
    `);
  });

  it.each([
    ["news", { index: 0 }],
    ["news", { index: 1 }],
    ["clients", {}],
  ])("leaves %s where it is for %j", (id, destination) => {
    expect(moveOps(STATE, id, destination)).toEqual([]);
  });

  it("moves a folder with what is in it to the end of another place", () => {
    expect(moved("clients", { parentId: "2" }).slice(-4))
      .toMatchInlineSnapshot(`
      [
        "    0 chat "Plan" instrument://chat/chat_1",
        "    1 recipes "Recipes"",
        "    2 clients "Clients"",
        "      0 acme "Acme" https://acme.example.com/",
      ]
    `);
  });

  it.each([
    ["1", { parentId: "2" }, "Can't modify the root bookmark folders."],
    [
      "work",
      { parentId: "clients" },
      "Can't move a folder into itself or a folder inside it.",
    ],
    [
      "work",
      { parentId: "work" },
      "Can't move a folder into itself or a folder inside it.",
    ],
    ["news", { index: 4 }, "Index out of bounds."],
    ["gone", {}, "Can't find bookmark for id."],
  ])("refuses %s to %j", (id, destination, error) => {
    expect(() => moveOps(STATE, id, destination)).toThrow(error);
  });
});

describe("updateOps and removeOp", () => {
  it("renames and readdresses", () => {
    expect(
      updateOps(STATE, "news", {
        title: "Headlines",
        url: "https://x.example/",
      }),
    ).toMatchInlineSnapshot(`
        [
          {
            "id": "news",
            "title": "Headlines",
            "type": "rename",
          },
          {
            "id": "news",
            "type": "setUrl",
            "url": "https://x.example/",
          },
        ]
      `);
  });

  it.each([
    [
      () => updateOps(STATE, "2", { title: "Mine" }),
      "Can't modify the root bookmark folders.",
    ],
    [
      () => updateOps(STATE, "work", { url: "https://x.example/" }),
      "Can't set URL of a bookmark folder.",
    ],
    [
      () => removeOp(STATE, "1", { recursive: true }),
      "Can't modify the root bookmark folders.",
    ],
    [
      () => removeOp(STATE, "work", { recursive: false }),
      "Can't remove non-empty folder (use recursive to force).",
    ],
  ])("refuses %#", (call, error) => {
    expect(call).toThrow(error);
  });

  it("removes an empty folder without recursive", () => {
    expect(removeOp(STATE, "recipes", { recursive: false })).toEqual({
      id: "recipes",
      type: "remove",
    });
  });
});

describe("bookmarkEvents", () => {
  const events = (...ops: BookmarkOp[]) =>
    bookmarkEvents(
      { bookmarks: STATE, dateOf },
      { bookmarks: applyBookmarkOps(STATE, ops), dateOf: () => 9000 },
    ).map(
      ([name, id, info]) =>
        `${name.replace("bookmarks.", "")} ${id} ${JSON.stringify(
          "node" in info
            ? { ...info, node: outline(info.node).map((line) => line.trim()) }
            : info,
        )}`,
    );

  it("tells a folder's removal once, with what was in it", () => {
    expect(events({ id: "work", type: "remove" })).toMatchInlineSnapshot(`
      [
        "onRemoved work {"index":1,"node":["1 work \\"Work\\"","0 docs \\"Docs\\" https://docs.example.com/","1 clients \\"Clients\\"","0 acme \\"Acme\\" https://acme.example.com/"],"parentId":"1"}",
      ]
    `);
  });

  it("tells a move but not the places beside it shifting", () => {
    expect(
      events(
        { id: "news", type: "remove" },
        { id: "notes", order: -1, type: "move" },
      ),
    ).toMatchInlineSnapshot(`
      [
        "onRemoved news {"index":0,"node":["0 news \\"News\\" https://news.example.com/"],"parentId":"1"}",
        "onMoved notes {"index":0,"oldIndex":2,"oldParentId":"1","parentId":"1"}",
      ]
    `);
  });

  it("tells a made folder before what is in it, and a rename and a new address", () => {
    expect(
      events(
        {
          folder: { id: "trips", order: 5, title: "Trips" },
          type: "addFolder",
        },
        {
          bookmark: {
            folder: "trips",
            id: "rome",
            order: 0,
            title: "Rome",
            url: "https://rome.example/",
          },
          type: "add",
        },
        { id: "acme", title: "Acme Co", type: "rename" },
        { id: "chat", type: "setUrl", url: "instrument://chat/chat_2" },
      ),
    ).toMatchInlineSnapshot(`
      [
        "onChanged acme {"title":"Acme Co","url":"https://acme.example.com/"}",
        "onCreated trips {"dateAdded":9000,"id":"trips","index":3,"parentId":"1","title":"Trips","dateGroupModified":9000,"syncing":false}",
        "onCreated rome {"dateAdded":9000,"id":"rome","index":0,"parentId":"trips","syncing":false,"title":"Rome","url":"https://rome.example/"}",
        "onChanged chat {"title":"Plan","url":"instrument://chat/chat_2"}",
      ]
    `);
  });
});

describe("opensInApp", () => {
  it.each([
    ["file:///Users/mac-user/Notes/", true],
    ["file:///Users/mac-user/report.pdf", true],
    ["file:///Users/mac-user/site/index.html#intro", false],
    ["instrument://chat/chat_1", true],
    ["instrument://screen/activity", true],
    ["instrument://file/Users/mac-user/report.pdf", true],
    ["https://example.com/", false],
  ])("%s: %s", (url, expected) => {
    expect(opensInApp(url)).toBe(expected);
  });
});
