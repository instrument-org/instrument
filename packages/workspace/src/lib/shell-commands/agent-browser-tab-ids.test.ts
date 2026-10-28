import { describe, expect, it } from "vitest";

import {
  jsonWithTabIds,
  newTabLine,
  tabOutputOf,
  withTabIds,
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

  it("names the tab `tab new` opened, which is the active one", () => {
    expect(newTabLine(JSON_LIST)).toBe(
      "Opened as tab tab_01M5Q2CY3JB5G7KJVE1QA1HK0B.\n",
    );
    expect(newTabLine("not json")).toBe("");
  });
});
