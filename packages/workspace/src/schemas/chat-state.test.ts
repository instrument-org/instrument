import { describe, expect, it } from "vitest";

import { StoredChatStateSchema } from "./chat-state";

describe("a chat's closed tabs", () => {
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
        closedTabs: [
          { id: saved, reason: "tabCap", url: "https://example.com/" },
        ],
      }),
    ).toMatchObject({
      closedTabs: [{ id: "tab_01M4RWA7GR6BXSMR9XJM4MRCJ9" }],
    });
  });
});

describe("a chat's state file", () => {
  it("keeps its other fields when an opened tab will not parse", () => {
    const closed = {
      id: "tab_1",
      reason: "tabCap",
      url: "https://example.com/",
    };
    expect(
      StoredChatStateSchema.parse({
        closedTabs: [closed],
        openedTabs: [{ id: "not a tab" }],
      }),
    ).toMatchObject({ closedTabs: [closed], openedTabs: [] });
  });

  it("leaves out the held tabs an earlier build kept", () => {
    expect(
      StoredChatStateSchema.parse({
        browserTabs: [
          { id: "tab_01M4RWA7GR6BXSMR9XJM4MRCJ9", openedBy: "handed" },
        ],
      }),
    ).toEqual({ closedTabs: [], openedTabs: [] });
  });
});
