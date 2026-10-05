import { describe, expect, it } from "vitest";

import { appEventsBetween } from "./chat-app-changes";

describe("appEventsBetween", () => {
  it.each([
    [
      "an app taken away",
      { slack: { connected: true, name: "Slack" } },
      {},
      [{ event: "removed", name: "Slack", slug: "slack" }],
    ],
    [
      "a connection lost",
      { linear: { connected: true, name: "Linear" } },
      { linear: { connected: false, name: "Linear" } },
      [{ event: "disconnected", name: "Linear", slug: "linear" }],
    ],
    [
      "a web app signed in",
      {
        drive: {
          connected: false,
          name: "Drive",
          web: "https://drive.google.com",
        },
      },
      {
        drive: {
          connected: true,
          name: "Drive",
          web: "https://drive.google.com",
        },
      },
      [
        {
          event: "connected",
          name: "Drive",
          slug: "drive",
          web: "https://drive.google.com",
        },
      ],
    ],
    // Set up by the conversation and still waiting on the user: its own doing.
    [
      "an app set up, not yet connected",
      {},
      { notion: { connected: false, name: "Notion" } },
      [],
    ],
    [
      "nothing",
      { a: { connected: true, name: "A" } },
      { a: { connected: true, name: "A" } },
      [],
    ],
  ])("tells %s", (_case, before, after, expected) => {
    expect(appEventsBetween(before, after)).toEqual(expected);
  });
});
