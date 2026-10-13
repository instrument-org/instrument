import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "./routeTree.gen";

const router = createRouter({
  context: { queryClient: new QueryClient() },
  history: createMemoryHistory({ initialEntries: ["/"] }),
  routeTree,
});

/** The search the router hands the deepest route at an address, and whether it refused it. */
function searchAt(href: string) {
  const { location } = createMemoryHistory({ initialEntries: [href] });
  const match = router.matchRoutes(router.parseLocation(location)).at(-1);
  return { error: match?.searchError, search: match?.search };
}

describe("an address with a value its route no longer knows", () => {
  it.each([
    ["/files?root=~&path=&view=grid", { path: "", root: "~" }],
    ["/files?root=~&path=&source=yes", { path: "", root: "~" }],
    [
      "/files?root=~&path=Documents%2F&view=list",
      { path: "Documents/", root: "~", view: "list" },
    ],
    ["/onboarding/theme?success=maybe", {}],
  ])("opens %s at the default", (href, search) => {
    expect(searchAt(href)).toEqual({ error: undefined, search });
  });
});
