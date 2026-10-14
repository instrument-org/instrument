import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { folderHref } from "@/shared/computer-href";

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

// The router reads a value as JSON when it can, so a file whose name reads
// as a number, a boolean or a quoted string has to be written so it comes
// back as the name.
describe("a folder's address with a file to select", () => {
  it.each(["2024", "true", "null", '"draft"', "[1]", "-1", "1e3", "notes.txt"])(
    "selects %s",
    (name) => {
      expect(searchAt(folderHref("/Users/casey", { select: name }))).toEqual({
        error: undefined,
        search: { path: "", root: "/Users/casey", select: name },
      });
    },
  );

  // An address written before, kept in a tab's history.
  it.each([
    ["2024", "2024"],
    ["true", "true"],
    ["null", "null"],
    ["%5B1%5D", undefined],
  ])("opens an older address that selects %s", (written, select) => {
    expect(
      searchAt(`/files?path=&root=%2FUsers%2Fcasey&select=${written}`),
    ).toEqual({
      error: undefined,
      search: { path: "", root: "/Users/casey", select },
    });
  });
});
