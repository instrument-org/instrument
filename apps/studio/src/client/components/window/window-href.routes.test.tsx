import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "../../routeTree.gen";
import { matchScreen, type Screen, SCREEN_ROUTES } from "./window-href";

const router = createRouter({
  context: { queryClient: new QueryClient() },
  history: createMemoryHistory({ initialEntries: ["/"] }),
  routeTree,
});

/** The route the router itself puts an address at, by its full path. */
function routeOf(href: string) {
  const [, , found] = router.getMatchedRoutes(
    new URL(href, "http://tabs").pathname,
  );
  // A route of no particular tree, whose full path the router leaves untyped.
  const path: unknown = found?.fullPath;
  return typeof path === "string" ? path : undefined;
}

const ROUTE_OF_KIND: Partial<Record<Screen["kind"], string>> = {
  ...SCREEN_ROUTES,
  // A chat's address is the chat route however its segment reads.
  chatLink: SCREEN_ROUTES.chat,
  chatOfSession: SCREEN_ROUTES.chat,
};

describe("matchScreen against the route tree", () => {
  it.each([
    "/new-tab",
    "/browser",
    "/files?path=&root=~",
    "/apps",
    "/apps/",
    "/apps/gmail",
    "/chats",
    "/chats/2026-10-02-trip",
    "/chats/2026-10-02-trip/",
    "/chats/ses_01JAAAAAAAAAAAAAAAAAAAAAAA",
    "/chats/2026-10",
    "/sites/abc",
    "/tasks?chat=2026-10-02-trip",
    "/tasks/ses_01JAAAAAAAAAAAAAAAAAAAAAAA?chat=2026-10-02-trip",
    "/release-notes",
  ])("puts %s where the router does", (href) => {
    const route = ROUTE_OF_KIND[matchScreen(href).kind];
    expect(route?.replace(/\/$/, "")).toBe(routeOf(href)?.replace(/\/$/, ""));
  });
});
