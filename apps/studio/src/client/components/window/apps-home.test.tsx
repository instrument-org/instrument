import { renderWithProviders } from "@/tests/render";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CatalogTile } from "./apps-home";

vi.mock("@/client/hooks/use-open-external-link", () => ({
  useOpenExternalLink: () => () => undefined,
}));
vi.mock("@/client/rpc/client", () => ({ rpcClient: {} }));

const figma: Parameters<typeof CatalogTile>[0]["entry"] = {
  authMethods: [],
  category: "design",
  description: "",
  domain: "figma.com",
  icon: undefined,
  interfaces: [],
  name: "Figma",
  slug: "figma",
  tagline: "Design files, components, and variables.",
  tier: "featured",
};

describe("CatalogTile", () => {
  it.each([
    ["one not here by its tagline", [], figma.tagline],
    ["a connected one as signed in", ["connected"], "Signed in"],
    // A first run set Figma up, its test failed at once, and the tile still
    // read as connected.
    ["a failed one as not connected", ["failed"], "Could not connect"],
    ["several by how many", ["connected", "failed"], "2 accounts"],
  ] as const)("says %s, and opens its page", (_, statuses, line) => {
    const onOpen = vi.fn();
    renderWithProviders(
      <CatalogTile
        entry={figma}
        mine={statuses.map((status) => ({
          authKind: "oauth",
          slug: "figma",
          status,
          type: "mcp",
        }))}
        onOpen={onOpen}
      />,
    );
    expect(screen.getByText(line)).toBeTruthy();
    const tile = screen.getAllByRole("button");
    expect(tile).toHaveLength(1);
    fireEvent.click(tile[0]!);
    expect(onOpen).toHaveBeenCalledWith("figma");
  });
});
