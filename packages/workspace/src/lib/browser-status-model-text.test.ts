import { describe, expect, it } from "vitest";

import { browserStatusModelNote } from "./browser-status-model-text";

describe("browserStatusModelNote", () => {
  it("when a tab is live", () => {
    expect(
      browserStatusModelNote({
        hasLiveView: true,
        pageTitle: "Example",
        pageUrl: "https://example.com",
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      \`agent-browser\` already has a live in-app browser tab for this chat session. Current URL: https://example.com. Page title: Example.
      </instrument-system-note>"
    `);
  });

  it("when no tab", () => {
    expect(browserStatusModelNote({ hasLiveView: false }))
      .toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      No \`agent-browser\` in-app browser tab is open for this chat session yet.
      </instrument-system-note>"
    `);
  });
});
