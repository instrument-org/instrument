import { describe, expect, it } from "vitest";

import { createTabRouter } from "./tab-router";

describe("createTabRouter", () => {
  it.each([
    ["the start", 0, "/orchestrator"],
    ["the middle", 1, "/orchestrator/apps"],
    ["the end", 2, "/orchestrator/ideas"],
  ])("comes back at %s of a saved history", (_case, index, pathname) => {
    const router = createTabRouter({
      history: {
        entries: ["/orchestrator", "/orchestrator/apps", "/orchestrator/ideas"],
        index,
      },
      pathname: "/orchestrator",
    });
    expect(router.history.location.pathname).toBe(pathname);
  });
});
