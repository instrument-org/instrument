import { describe, expect, it, vi } from "vitest";

import {
  type AppWindowAsk,
  createAppWindowAsks,
  outsideOpensOf,
  tabHrefOfAsk,
} from "./app-window-asks";

// A file or link opened from outside while setup is up waits for setup, then
// reaches the window: neither lost to a page that asked once and got nothing,
// nor put up behind setup where nobody can see it.

const file: AppWindowAsk = {
  hostPath: "/Users/mac-user/a.pdf",
  type: "openFile",
};
const link: AppWindowAsk = { href: "/chats/abc", type: "openScreen" };

function asks({ held = false } = {}) {
  const state = { held };
  const deliver = vi.fn<(ask: AppWindowAsk) => void>();
  const queue = createAppWindowAsks({
    deliver,
    isHeld: () => state.held,
  });
  return { deliver, queue, state };
}

describe("createAppWindowAsks", () => {
  it("delivers at once to a page that is listening", () => {
    const { deliver, queue } = asks();
    queue.take();
    queue.ask(file);
    expect(deliver.mock.calls).toEqual([[file]]);
  });

  it("keeps what came before the page was up for it to take", () => {
    const { deliver, queue } = asks();
    queue.ask(file);
    queue.ask(link);
    expect(deliver).not.toHaveBeenCalled();
    expect(queue.take()).toEqual([file, link]);
    expect(queue.take()).toEqual([]);
  });

  it("holds asks while held, names them, and delivers them on release", () => {
    const { deliver, queue, state } = asks({ held: true });
    expect(queue.take()).toEqual([]);
    queue.ask(file);
    queue.ask(link);
    expect(deliver).not.toHaveBeenCalled();
    expect(queue.waiting).toEqual([file, link]);

    state.held = false;
    queue.release();
    expect(deliver.mock.calls).toEqual([[file], [link]]);
    expect(queue.waiting).toEqual([]);
  });

  it("leaves what waited for a reloading page to take on release", () => {
    const { deliver, queue, state } = asks({ held: true });
    queue.take();
    queue.ask(file);
    queue.stopTaking();
    state.held = false;
    queue.release();
    expect(deliver).not.toHaveBeenCalled();
    expect(queue.take()).toEqual([file]);
  });

  // A restored window that never came up held back every link for the one
  // that did, until the app quit.
  it("hands what waited to a page taking over, and what comes after", () => {
    const { deliver, queue } = asks();
    queue.ask(file);
    queue.takeOver();
    queue.ask(link);
    expect(deliver.mock.calls).toEqual([[file], [link]]);
    expect(queue.waiting).toEqual([]);
  });

  it("keeps what waited while held when a page takes over", () => {
    const { deliver, queue, state } = asks({ held: true });
    queue.ask(file);
    queue.takeOver();
    expect(deliver).not.toHaveBeenCalled();
    state.held = false;
    queue.release();
    expect(deliver.mock.calls).toEqual([[file]]);
  });

  it("releases nothing while still held", () => {
    const { deliver, queue } = asks({ held: true });
    queue.take();
    queue.ask(file);
    queue.release();
    expect(deliver).not.toHaveBeenCalled();
  });
});

describe("tabHrefOfAsk", () => {
  // The window with a tab already showing what an ask puts up is the one
  // that answers it, so a file, a folder or a screen linked again comes up
  // where it is rather than in another tab.
  it("names the tab showing a file, a screen or a missing file's folder", () => {
    const asked: AppWindowAsk[] = [
      file,
      link,
      {
        folder: "/Users/mac-user/Work",
        name: "pricing.html",
        type: "missingFile",
      },
      { name: "pricing.html", type: "missingFile" },
      { type: "newChat", words: "Plan my week" },
      { type: "openNewChat" },
      { count: 3, type: "notOpened" },
      {
        host: "weekly.instrument.page",
        type: "pageNotOpened",
        why: "noAnswer",
      },
      { type: "linkNotOpened" },
    ];
    expect(asked.map(tabHrefOfAsk)).toMatchInlineSnapshot(`
      [
        "/files?file=%2FUsers%2Fmac-user%2Fa.pdf&path=&root=~",
        "/chats/abc",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ]
    `);
  });
});

// One thing from outside comes up where a tab already shows it; several are
// always one new group, in the order handed over, even where a tab already
// shows one of them.
describe("outsideOpensOf", () => {
  it("makes one file alone a screen of its own", () => {
    expect(outsideOpensOf([{ hostPath: "/a.md", type: "openFile" }]))
      .toMatchInlineSnapshot(`
      [
        {
          "href": "/files?file=%2Fa.md&path=&root=~",
          "type": "openScreen",
        },
      ]
    `);
  });

  it("makes several files one group in the order handed over", () => {
    expect(
      outsideOpensOf([
        { hostPath: "/b.md", type: "openFile" },
        { href: "/files?path=&root=%2FWork", type: "openScreen" },
        { hostPath: "/a.md", type: "openFile" },
        { hostPath: "/b.md", type: "openFile" },
      ]),
    ).toMatchInlineSnapshot(`
      [
        {
          "hrefs": [
            "/files?file=%2Fb.md&path=&root=~",
            "/files?path=&root=%2FWork",
            "/files?file=%2Fa.md&path=&root=~",
          ],
          "type": "openGroup",
        },
      ]
    `);
  });

  it("makes a missing file's folder alone a screen, and says the file is gone", () => {
    expect(
      outsideOpensOf([
        { folder: "/Work", name: "gone.md", type: "missingFile" },
      ]),
    ).toMatchInlineSnapshot(`
      [
        {
          "href": "/files?path=&root=%2FWork",
          "type": "openScreen",
        },
        {
          "folder": "/Work",
          "name": "gone.md",
          "type": "missingFile",
        },
      ]
    `);
  });

  it("keeps even one file in a group a link named by its word", () => {
    expect(
      outsideOpensOf(
        [
          { hostPath: "/a.md", type: "openFile" },
          { folder: "/Work", name: "gone.md", type: "missingFile" },
        ],
        "New tab row",
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "group": "New tab row",
          "hrefs": [
            "/files?file=%2Fa.md&path=&root=~",
            "/files?path=&root=%2FWork",
          ],
          "type": "openGroup",
        },
        {
          "folder": "/Work",
          "name": "gone.md",
          "type": "missingFile",
        },
      ]
    `);
  });

  it("carries the word of a group already folded", () => {
    expect(
      outsideOpensOf([
        { group: "New tab row", hrefs: ["/files?path=&root=%2FWork"], type: "openGroup" },
      ]),
    ).toMatchInlineSnapshot(`
      [
        {
          "group": "New tab row",
          "hrefs": [
            "/files?path=&root=%2FWork",
          ],
          "type": "openGroup",
        },
      ]
    `);
  });

  it("leaves a chat out of the group", () => {
    expect(outsideOpensOf([{ href: "/chats/c1", type: "openScreen" }]))
      .toMatchInlineSnapshot(`
      [
        {
          "href": "/chats/c1",
          "type": "openScreen",
        },
      ]
    `);
  });
});
