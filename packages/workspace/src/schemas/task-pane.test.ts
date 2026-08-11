import { describe, expect, it } from "vitest";

import { TaskPane } from "./task-pane";

const browser: TaskPane.Tab = { type: "browser" };

describe("TaskPane.Schema", () => {
  it("drops a tab it cannot read and keeps the rest", () => {
    const parsed = TaskPane.Schema.parse({
      open: true,
      tabs: [
        { filePath: "output/report.pdf", type: "file" },
        { type: "carousel" },
        { filePath: "/Users/someone/.ssh/id_rsa", type: "file" },
        { type: "browser" },
      ],
    });

    expect(parsed.tabs).toMatchInlineSnapshot(`
      [
        {
          "filePath": "output/report.pdf",
          "type": "file",
        },
        {
          "type": "browser",
        },
      ]
    `);
  });

  it("normalizes the agent's leading ./ so one file is one tab", () => {
    const pane = TaskPane.Schema.parse({
      tabs: [{ filePath: "./output/chart.png", type: "file" }],
    });

    expect(pane.tabs[0]).toEqual({
      filePath: "output/chart.png",
      type: "file",
    });
    expect(
      TaskPane.openTabs(pane, [TaskPane.fileTab("output/chart.png")]).tabs,
    ).toHaveLength(1);
  });

  it("defaults an absent pane to closed with no tabs", () => {
    expect(TaskPane.Schema.parse({})).toEqual({ open: false, tabs: [] });
  });
});

describe("TaskPane.openTabs", () => {
  it("appends in order, focuses the last, and opens the pane", () => {
    const pane = TaskPane.openTabs(TaskPane.EMPTY, [
      TaskPane.fileTab("a.png"),
      TaskPane.fileTab("b.png"),
    ]);

    expect(pane).toMatchInlineSnapshot(`
      {
        "open": true,
        "selected": "file:b.png",
        "tabs": [
          {
            "filePath": "a.png",
            "type": "file",
          },
          {
            "filePath": "b.png",
            "type": "file",
          },
        ],
      }
    `);
  });

  it("focuses an already-open tab instead of duplicating it", () => {
    const first = TaskPane.openTabs(TaskPane.EMPTY, [
      TaskPane.fileTab("a.png"),
    ]);
    const again = TaskPane.openTabs(first, [TaskPane.fileTab("a.png")]);

    expect(again.tabs).toHaveLength(1);
    expect(again.selected).toBe("file:a.png");
  });

  // The pane always draws it, so storing one would put something in the order
  // that reordering has to work around.
  it("focuses the browser without storing a tab for it", () => {
    const pane = TaskPane.openTabs(TaskPane.EMPTY, [
      TaskPane.fileTab("a.png"),
      browser,
    ]);

    expect(pane.selected).toBe("browser");
    expect(pane.tabs).toEqual([{ filePath: "a.png", type: "file" }]);
  });

  it("reopens a closed pane rather than leaving the tab hidden", () => {
    const closed = { ...TaskPane.EMPTY, open: false, tabs: [] };
    expect(TaskPane.openTabs(closed, [browser]).open).toBe(true);
  });
});

describe("TaskPane.closeTab", () => {
  it("focuses the neighbor when the focused tab goes", () => {
    const pane = TaskPane.openTabs(TaskPane.EMPTY, [
      TaskPane.fileTab("a.png"),
      TaskPane.fileTab("b.png"),
      TaskPane.fileTab("c.png"),
    ]);

    const closed = TaskPane.closeTab(
      { ...pane, selected: "file:b.png" },
      "file:b.png",
    );

    expect(closed.selected).toBe("file:c.png");
    expect(closed.tabs.map((tab) => TaskPane.tabKey(tab))).toEqual([
      "file:a.png",
      "file:c.png",
    ]);
  });

  it("leaves the selection alone when another tab closes", () => {
    const pane = TaskPane.openTabs(TaskPane.EMPTY, [
      TaskPane.fileTab("a.png"),
      TaskPane.fileTab("b.png"),
    ]);

    expect(TaskPane.closeTab(pane, "file:a.png").selected).toBe("file:b.png");
  });

  it("stays open when the last tab goes, falling back to the browser", () => {
    const pane = TaskPane.openTabs(TaskPane.EMPTY, [TaskPane.fileTab("a.png")]);
    const closed = TaskPane.closeTab(pane, "file:a.png");

    expect(closed.open).toBe(true);
    expect(closed.tabs).toEqual([]);
  });
});

describe("TaskPane.reorderTabs", () => {
  const opened = () =>
    TaskPane.openTabs(TaskPane.EMPTY, [
      TaskPane.fileTab("a.png"),
      TaskPane.fileTab("b.png"),
      TaskPane.fileTab("c.png"),
    ]);

  it("puts the tabs in the order it is given", () => {
    const pane = TaskPane.reorderTabs(opened(), [
      "file:c.png",
      "file:a.png",
      "file:b.png",
    ]);

    expect(pane.tabs.map((tab) => TaskPane.tabKey(tab))).toEqual([
      "file:c.png",
      "file:a.png",
      "file:b.png",
    ]);
  });

  it("keeps a tab the caller never named", () => {
    const pane = TaskPane.reorderTabs(opened(), ["file:c.png"]);

    expect(pane.tabs.map((tab) => TaskPane.tabKey(tab))).toEqual([
      "file:c.png",
      "file:a.png",
      "file:b.png",
    ]);
  });

  it("ignores a key naming nothing open", () => {
    const pane = TaskPane.reorderTabs(opened(), [
      "file:gone.png",
      "file:b.png",
    ]);

    expect(pane.tabs.map((tab) => TaskPane.tabKey(tab))).toEqual([
      "file:b.png",
      "file:a.png",
      "file:c.png",
    ]);
  });

  it("leaves the selection alone", () => {
    expect(TaskPane.reorderTabs(opened(), ["file:a.png"]).selected).toBe(
      "file:c.png",
    );
  });
});

describe("TaskPane.selectedTab", () => {
  it("falls back to the last tab when the selection names nothing open", () => {
    const pane = TaskPane.openTabs(TaskPane.EMPTY, [
      TaskPane.fileTab("a.png"),
      TaskPane.fileTab("b.png"),
    ]);

    expect(
      TaskPane.selectedTab({ ...pane, selected: "file:gone.png" }),
    ).toEqual({ filePath: "b.png", type: "file" });
  });

  it("is undefined with no tabs", () => {
    expect(TaskPane.selectedTab(TaskPane.EMPTY)).toBeUndefined();
  });
});
