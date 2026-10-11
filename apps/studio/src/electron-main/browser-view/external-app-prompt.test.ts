import { describe, expect, it } from "vitest";

import { questionOf } from "./external-app-prompt";

describe("asking before a page opens another app", () => {
  it("names the app and the site, and offers to remember it", () => {
    expect(questionOf("Slack", "app.slack.com")).toMatchInlineSnapshot(`
      {
        "buttons": [
          "Cancel",
          "Open Slack",
        ],
        "cancelId": 0,
        "checkboxLabel": "Always let app.slack.com open links in Slack",
        "defaultId": 1,
        "detail": "app.slack.com wants to open this link in Slack.",
        "message": "Open Slack?",
        "noLink": true,
      }
    `);
  });

  it("asks a page with no site each time", () => {
    expect(questionOf("Slack.app", null)).toMatchInlineSnapshot(`
      {
        "buttons": [
          "Cancel",
          "Open Slack",
        ],
        "cancelId": 0,
        "defaultId": 1,
        "detail": "This page wants to open this link in Slack.",
        "message": "Open Slack?",
        "noLink": true,
      }
    `);
  });

  it("asks nothing when no app opens the link", () => {
    expect(questionOf("", "app.slack.com")).toBeNull();
  });
});
