import { describe, expect, it } from "vitest";

import { appEventsBetween } from "./chat-app-changes";

describe("appEventsBetween", () => {
  it.each([
    [
      "an app taken away",
      { slack: { connected: true, fingerprint: "a", name: "Slack" } },
      {},
      [{ event: "removed", name: "Slack", slug: "slack" }],
    ],
    [
      "a connection lost",
      { linear: { connected: true, fingerprint: "a", name: "Linear" } },
      { linear: { connected: false, fingerprint: "a", name: "Linear" } },
      [{ event: "disconnected", name: "Linear", slug: "linear" }],
    ],
    [
      "a web app signed in",
      {
        drive: {
          connected: false,
          fingerprint: "a",
          name: "Drive",
          web: "https://drive.google.com",
        },
      },
      {
        drive: {
          connected: true,
          fingerprint: "a",
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
    // The conversation's own turns are told already (`appsToldByTurn`), so
    // one that turns up here was set up elsewhere.
    [
      "an app set up, not yet connected",
      {},
      { notion: { connected: false, fingerprint: "a", name: "Notion" } },
      [{ event: "added", name: "Notion", slug: "notion" }],
    ],
    [
      "an app whose folder changed",
      { linear: { connected: true, fingerprint: "a", name: "Linear" } },
      { linear: { connected: true, fingerprint: "b", name: "Linear" } },
      [{ event: "changed", name: "Linear", slug: "linear" }],
    ],
    [
      "nothing",
      { a: { connected: true, fingerprint: "a", name: "A" } },
      { a: { connected: true, fingerprint: "a", name: "A" } },
      [],
    ],
  ])("tells %s", (_case, before, after, expected) => {
    expect(appEventsBetween(before, after)).toEqual(expected);
  });
});
