import { describe, expect, it } from "vitest";

import { StoredChatStateSchema } from "./chat-state";

describe("a chat's held tabs", () => {
  it.each([
    ["its old `window/` target id", "window/ses_01M4RWA7GR6BXSMR9XJM4MRCJ9"],
    [
      "the session id tabs had before ids of their own",
      "ses_01M4RWA7GR6BXSMR9XJM4MRCJ9",
    ],
    ["its own id", "tab_01M4RWA7GR6BXSMR9XJM4MRCJ9"],
  ])("reads a tab saved under %s as the tab itself", (_, saved) => {
    expect(
      StoredChatStateSchema.parse({
        browserTabs: [{ id: saved, openedBy: "handed" }],
        closedTabs: [
          { id: saved, reason: "tabCap", url: "https://example.com/" },
        ],
      }),
    ).toMatchObject({
      browserTabs: [
        {
          id: "tab_01M4RWA7GR6BXSMR9XJM4MRCJ9",
          inWindow: true,
          openedBy: "handed",
        },
      ],
      closedTabs: [{ id: "tab_01M4RWA7GR6BXSMR9XJM4MRCJ9" }],
    });
  });
});

describe("a chat's state file", () => {
  it("keeps its other fields when a held tab will not parse", () => {
    const closed = {
      id: "tab_1",
      reason: "tabCap",
      url: "https://example.com/",
    };
    expect(
      StoredChatStateSchema.parse({
        browserTabs: [
          { id: "tab_01M4RWA7GR6BXSMR9XJM4MRCJ9", openedBy: "later" },
        ],
        closedTabs: [closed],
      }),
    ).toMatchObject({ browserTabs: [], closedTabs: [closed] });
  });
});
