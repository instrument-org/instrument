import { describe, expect, it } from "vitest";

import { applyTabCommand, type TabCommand } from "./tab-ops";
import { type WindowTabs } from "./tab-model";

const GROUP = "group:a";

const tabs: WindowTabs = {
  activeByGroup: { [GROUP]: "t1" },
  groups: {},
  tabs: [
    { group: GROUP, href: "/files?path=%2Fhome", id: "t1", kind: "screen" },
    {
      group: GROUP,
      id: "t2",
      kind: "page",
      openedAt: 1,
      url: "https://example.com/",
    },
  ],
};

const here = { onScreen: GROUP };

/** A change as it arrives from another process: its name and plain data, nothing else. */
const sent = (command: TabCommand): TabCommand =>
  JSON.parse(JSON.stringify(command)) as TabCommand;

const commands: TabCommand[] = [
  { args: ["t2"], op: "pickTab" },
  { args: ["t2", {}], op: "closeTab" },
  {
    args: [{ href: "/settings", id: "t3", select: true }],
    op: "openScreen",
  },
  {
    args: [
      {
        behind: false,
        newTab: true,
        page: { id: "t4", openedAt: 2, url: "https://example.org/" },
        show: false,
      },
    ],
    op: "openPageTab",
  },
  { args: ["t2", { title: "Example" }], op: "patchPage" },
  { args: ["/files?path=%2Fhome"], op: "selectShowing" },
];

describe("a change to the tabs, by name", () => {
  it.each(commands)("$op means the same sent as plain data", (command) => {
    expect(applyTabCommand(tabs, here, sent(command))).toEqual(
      applyTabCommand(tabs, here, command),
    );
  });

  it.each(commands)(
    "$op gives the same tabs each time it is applied",
    (command) => {
      expect(applyTabCommand(tabs, here, command)).toEqual(
        applyTabCommand(tabs, here, command),
      );
    },
  );

  it("answers what the asker wants to know, beside the tabs", () => {
    const opened = applyTabCommand(tabs, here, {
      args: [{ href: "/settings", id: "t3", select: true }],
      op: "openScreen",
    });
    expect(opened.value).toBe("t3");
    expect(opened.state.tabs.map((tab) => tab.id)).toEqual(["t1", "t2", "t3"]);
    expect(opened.state.activeByGroup[GROUP]).toBe("t3");
  });

  it("reads the group on screen from the window that asks", () => {
    const nowhere = applyTabCommand(
      tabs,
      { onScreen: undefined },
      {
        args: [{ href: "/settings", id: "t3", select: true }],
        op: "openScreen",
      },
    );
    expect(nowhere.state).toBe(tabs);
    expect(nowhere.value).toBeUndefined();
  });

  it("changes nothing for a tab that has gone", () => {
    expect(
      applyTabCommand(tabs, here, { args: ["gone", {}], op: "closeTab" }).state
        .tabs,
    ).toEqual(tabs.tabs);
  });
});
