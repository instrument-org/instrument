import { describe, expect, it } from "vitest";

import { createTabRouter } from "./tab-router";

describe("createTabRouter", () => {
  it.each([
    ["the start", 0, "/chats"],
    ["the middle", 1, "/apps"],
    ["the end", 2, "/release-notes"],
  ])("comes back at %s of a saved history", (_case, index, pathname) => {
    const router = createTabRouter({
      history: {
        entries: ["/chats", "/apps", "/release-notes"],
        index,
      },
      pathname: "/chats",
    });
    expect(router.history.location.pathname).toBe(pathname);
  });
});
