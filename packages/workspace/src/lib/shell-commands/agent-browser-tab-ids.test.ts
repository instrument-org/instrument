import { describe, expect, it } from "vitest";

import { listsTabs, withTabIds } from "./agent-browser-tab-ids";

const JSON_LIST = JSON.stringify({
  data: {
    tabs: [
      { tabId: "t1", targetId: "tab_01M5Q29YA0CTZ3NQY76Z3JQWBF" },
      { tabId: "t2", targetId: "tab_01M5Q2CY3JB5G7KJVE1QA1HK0B" },
    ],
  },
  success: true,
});

describe("agent-browser's tab list", () => {
  it.each([
    [["tab"], true],
    [["tab", "list"], true],
    [["tab", "new", "https://example.com/"], false],
    [["tab", "t2"], false],
    [["open", "https://example.com/"], false],
  ])("%j lists the tabs as text: %s", (args, lists) => {
    expect(listsTabs(args)).toBe(lists);
  });

  it("names each tab by the window's id beside agent-browser's label", () => {
    expect(
      withTabIds(
        "→ [t1] Amazon.com. Spend less. Smile more. - https://www.amazon.com/\n  [t2] Your Orders - https://www.amazon.com/gp/css/order-history\n  [t3] - about:blank\n",
        JSON_LIST,
      ),
    ).toMatchInlineSnapshot(`
      "→ [t1] tab_01M5Q29YA0CTZ3NQY76Z3JQWBF Amazon.com. Spend less. Smile more. - https://www.amazon.com/
        [t2] tab_01M5Q2CY3JB5G7KJVE1QA1HK0B Your Orders - https://www.amazon.com/gp/css/order-history
        [t3] - about:blank
      "
    `);
  });

  it("leaves the list as it was when the JSON can't be read", () => {
    expect(withTabIds("→ [t1]  - about:blank\n", "not json")).toBe(
      "→ [t1]  - about:blank\n",
    );
  });
});
