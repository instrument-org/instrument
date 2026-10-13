import { describe, expect, it } from "vitest";

import { StoredChatStateSchema } from "./chat-state";

describe("a chat's held tabs", () => {
  it("reads a tab saved under its old `window/` target id as the tab itself", () => {
    const tab = "ses_01M4RWA7GR6BXSMR9XJM4MRCJ9";
    expect(
      StoredChatStateSchema.parse({
        browserTabs: [{ id: `window/${tab}`, openedBy: "handed" }],
      }).browserTabs,
    ).toEqual([{ id: tab, inWindow: true, openedBy: "handed" }]);
  });
});
