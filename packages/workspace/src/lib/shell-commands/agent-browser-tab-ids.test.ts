import { describe, expect, it } from "vitest";

import {
  jsonWithTabIds,
  listsTab,
  newTabLine,
  onlyTabToClose,
  tabOutputOf,
  windowTabIdArgIndex,
  withTabIds,
  withTabLabel,
} from "./agent-browser-tab-ids";

const JSON_LIST = JSON.stringify({
  data: {
    tabs: [
      { tabId: "t1", targetId: "tab_01M5Q29YA0CTZ3NQY76Z3JQWBF" },
      {
        active: true,
        tabId: "t2",
        targetId: "tab_01M5Q2CY3JB5G7KJVE1QA1HK0B",
      },
    ],
  },
  success: true,
});

describe("agent-browser's tab list", () => {
  it.each([
    [["tab"], "list"],
    [["tab", "list"], "list"],
    [["tab", "list", "--json"], "list-json"],
    [["--json", "tab", "list"], "list-json"],
    [["--json", "tab"], "list-json"],
    [["--json", "tab", "new", "https://example.com/"], undefined],
    [["--json", "false", "tab", "list"], "list"],
    [["tab", "new", "https://example.com/"], "new"],
    [["tab", "tab_01M5Q2CY3JB5G7KJVE1QA1HK0B"], undefined],
    [["tab", "close", "t2"], undefined],
    [["open", "https://example.com/"], undefined],
  ])("%j prints %s", (args, output) => {
    expect(tabOutputOf(args)).toBe(output);
  });

  it("names each tab by the window's id in place of agent-browser's label", () => {
    expect(
      withTabIds(
        "→ [t1] Amazon.com. Spend less. Smile more. - https://www.amazon.com/\n  [t2] Your Orders - https://www.amazon.com/gp/css/order-history\n  [t3] - about:blank\n",
        JSON_LIST,
      ),
    ).toMatchInlineSnapshot(`
      "→ [tab_01M5Q29YA0CTZ3NQY76Z3JQWBF] Amazon.com. Spend less. Smile more. - https://www.amazon.com/
        [tab_01M5Q2CY3JB5G7KJVE1QA1HK0B] Your Orders - https://www.amazon.com/gp/css/order-history
        [t3] - about:blank
      "
    `);
  });

  it("leaves the list as it was when the JSON can't be read", () => {
    expect(withTabIds("→ [t1]  - about:blank\n", "not json")).toBe(
      "→ [t1]  - about:blank\n",
    );
  });

  it("gives the JSON list the window's id as each tab's tabId", () => {
    expect(JSON.parse(jsonWithTabIds(JSON_LIST))).toEqual({
      data: {
        tabs: [
          {
            tabId: "tab_01M5Q29YA0CTZ3NQY76Z3JQWBF",
            targetId: "tab_01M5Q29YA0CTZ3NQY76Z3JQWBF",
          },
          {
            active: true,
            tabId: "tab_01M5Q2CY3JB5G7KJVE1QA1HK0B",
            targetId: "tab_01M5Q2CY3JB5G7KJVE1QA1HK0B",
          },
        ],
      },
      success: true,
    });
  });

  it("names the tab `tab new` opened, which is the active one, and counts the tabs open", () => {
    expect(newTabLine(JSON_LIST)).toBe(
      "Opened as tab tab_01M5Q2CY3JB5G7KJVE1QA1HK0B, one of 2 tabs open.\n",
    );
    expect(newTabLine("not json")).toBe("");
  });
});

describe("a tab named by the window's id", () => {
  it.each([
    [["tab", "tab_01M5Q2CY3JB5G7KJVE1QA1HK0B"], 1],
    [["tab", "close", "tab_01M5Q2CY3JB5G7KJVE1QA1HK0B"], 2],
    [["--json", "tab", "tab_01M5Q2CY3JB5G7KJVE1QA1HK0B"], 2],
    [["tab", "t2"], undefined],
    [["tab", "close"], undefined],
    [["tab", "new", "https://example.com/"], undefined],
    [["open", "tab_01M5Q2CY3JB5G7KJVE1QA1HK0B"], undefined],
  ])("%j has it at %s", (args, index) => {
    expect(windowTabIdArgIndex(args)).toBe(index);
  });

  it("is switched to by agent-browser's label for it", () => {
    expect(
      withTabLabel(
        ["tab", "close", "tab_01M5Q2CY3JB5G7KJVE1QA1HK0B"],
        2,
        JSON_LIST,
      ),
    ).toEqual(["tab", "close", "t2"]);
  });

  it("is left as it was when the list does not name it", () => {
    expect(
      withTabLabel(["tab", "tab_01M5Q2CY3JB5G7KJVE1QAZZZZZ"], 1, JSON_LIST),
    ).toEqual(["tab", "tab_01M5Q2CY3JB5G7KJVE1QAZZZZZ"]);
  });
});

describe("the only tab agent-browser has", () => {
  const ONLY = "tab_01M5Q29YA0CTZ3NQY76Z3JQWBF";
  const ONE = JSON.stringify({
    data: { tabs: [{ active: true, tabId: "t3", targetId: ONLY }] },
  });

  it.each([
    [["tab", "close", ONLY], ONE, ONLY],
    [["tab", "close"], ONE, ONLY],
    [["tab", "close", "t3"], ONE, ONLY],
    [["--json", "tab", "close", ONLY], ONE, ONLY],
    // Another tab named, which agent-browser answers for itself.
    [["tab", "close", "tab_01M5Q2CY3JB5G7KJVE1QAZZZZZ"], ONE, undefined],
    [["tab", "close", "t1"], ONE, undefined],
    // One of several, which agent-browser closes.
    [["tab", "close", ONLY], JSON_LIST, undefined],
    [["tab", "close"], JSON_LIST, undefined],
    [["tab", ONLY], ONE, undefined],
    [["tab", "close", ONLY], "not json", undefined],
  ])("%j with the list %s closes %s", (args, json, tabId) => {
    expect(onlyTabToClose(args, json)).toBe(tabId);
  });
});

describe("listsTab", () => {
  it.each([
    ["tab_01M5Q2CY3JB5G7KJVE1QA1HK0B", JSON_LIST, true],
    ["tab_01M5Q2CY3JB5G7KJVE1QAZZZZZ", JSON_LIST, false],
    // The id only in some other field, or no list at all.
    [
      "tab_01M5Q2CY3JB5G7KJVE1QA1HK0B",
      '{"note":"tab_01M5Q2CY3JB5G7KJVE1QA1HK0B"}',
      false,
    ],
    ["tab_01M5Q2CY3JB5G7KJVE1QA1HK0B", "not json", false],
  ])("finds %s in the list %s: %s", (id, json, listed) => {
    expect(listsTab(json, id)).toBe(listed);
  });
});
