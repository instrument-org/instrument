import { describe, expect, it } from "vitest";

import { accountInTitles } from "./web-sign-in-account";

describe("accountInTitles", () => {
  it.each([
    {
      claimed: [],
      titles: ["Inbox - jeremy@finalpoint.co - Finalpoint Mail"],
      want: "jeremy@finalpoint.co",
    },
    {
      claimed: ["jeremy@finalpoint.co"],
      titles: [
        "Inbox - jeremy@finalpoint.co - Finalpoint Mail",
        "Inbox (3) - Jeremy@Example.com - Gmail",
      ],
      want: "jeremy@example.com",
    },
    { claimed: [], titles: ["Gmail"], want: undefined },
    {
      claimed: [],
      titles: [
        "Inbox - a@example.com - Gmail",
        "Inbox - b@example.com - Gmail",
      ],
      want: undefined,
    },
  ])("reads $titles as $want", ({ claimed, titles, want }) => {
    expect(accountInTitles(titles, new Set(claimed))).toBe(want);
  });
});
